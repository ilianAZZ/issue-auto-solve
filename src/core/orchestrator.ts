import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env, GlobalConfig, RepoSettings } from '../config/index.js';
import type { Credentials } from './credentials.js';
import { builtinDefaults, resolveRepoSettings } from '../config/index.js';
import type { Store, TaskRow } from '../db/store.js';
import { GitHub, type RepoAccess } from '../github/client.js';
import { answerAfter, fetchRepoFile, existingWork, getIssue, lastCommentBy, listUpdatedIssues, setLabel } from '../github/issues.js';
import { render } from '../prompt/render.js';
import { runContainer } from '../runner/docker.js';
import { prepareWorkspace, discardWorkspace } from '../runner/workspace.js';
import { logger } from '../util/log.js';
import { notifier, sendToTarget, type Notify } from '../util/notify.js';
import { now } from '../util/time.js';
import { parseRunUsage, type RunUsage } from '../util/usage.js';
import { matchingTargets } from './notifications.js';
import type { TaskState } from './states.js';

const log = logger('orchestrator');
const here = dirname(fileURLToPath(import.meta.url));

// Claude Code prints this and exits before doing anything else, so it always shows up
// near the end of a short log — a tail read is enough and keeps this cheap on big logs.
const CLAUDE_AUTH_ERROR_MARKER = 'OAuth access token is invalid';
// Printed when the account's Claude usage limit is hit, followed by the unix seconds the
// limit resets at, e.g. "Claude AI usage limit reached|1735056000".
const CLAUDE_USAGE_LIMIT_PATTERN = /Claude AI usage limit reached\|(\d+)/i;
// Newer Claude Code releases report the same condition as a `stream-json` result line
// instead, e.g. `{"type":"result","subtype":"success","api_error_status":429,
// "result":"You've hit your session limit · resets 7:20pm (UTC)",...}` — no epoch, just
// this phrase in the free-text result.
const CLAUDE_USAGE_LIMIT_TEXT_PATTERN = /\b(usage|session)\s+limit\b/i;
// A run that hits the limit without a parseable reset time still shouldn't be retried
// immediately — fall back to a fixed cooldown.
const DEFAULT_USAGE_LIMIT_RETRY_MS = 30 * 60_000;
const LOG_TAIL_BYTES = 65_536;

function readLogTail(logPath: string): string | null {
  if (!existsSync(logPath)) return null;
  const size = statSync(logPath).size;
  const length = Math.min(size, LOG_TAIL_BYTES);
  if (length === 0) return null;
  const buffer = Buffer.alloc(length);
  const fd = openSync(logPath, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString('utf8');
}

function logTailContains(logPath: string, marker: string): boolean {
  return (readLogTail(logPath) ?? '').includes(marker);
}

/** Whether the last `stream-json` result line in the log reports the Claude usage limit was hit. */
function jsonResultHitUsageLimit(tail: string): boolean {
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim();
    if (!line.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    if (record.type !== 'result') continue;
    const result = typeof record.result === 'string' ? record.result : '';
    return CLAUDE_USAGE_LIMIT_TEXT_PATTERN.test(result);
  }
  return false;
}

/** Null unless the run's log shows the Claude usage limit was hit, in which case it's when to retry. */
function usageLimitRetryAt(logPath: string): Date | null {
  const tail = readLogTail(logPath);
  if (!tail) return null;
  const match = tail.match(CLAUDE_USAGE_LIMIT_PATTERN);
  if (match) {
    const resetEpochSeconds = Number(match[1]);
    return Number.isFinite(resetEpochSeconds) ? new Date(resetEpochSeconds * 1000) : new Date(Date.now() + DEFAULT_USAGE_LIMIT_RETRY_MS);
  }
  if (jsonResultHitUsageLimit(tail)) return new Date(Date.now() + DEFAULT_USAGE_LIMIT_RETRY_MS);
  return null;
}

interface RepoContext {
  id: number;
  fullName: string;
  settings: RepoSettings;
}

export class Orchestrator {
  private github: GitHub | null = null;
  private readonly notify: Notify;
  private readonly contexts = new Map<string, RepoContext>();
  private readonly inflight = new Set<number>();
  private timer: NodeJS.Timeout | null = null;
  private signature = '';
  private identityResolved = false;
  private ticking = false;
  private botLogin = 'issue-auto-solve[bot]';
  private paused: boolean;
  /**
   * `failed`/`skipped` tasks are re-checked against GitHub on `reconcile_terminal_interval_seconds`
   * rather than on every tick: re-checking the whole failed/skipped backlog every tick scales
   * with total task history instead of active work, and was enough on its own to permanently
   * exhaust the GitHub rate limit once the backlog grew past ~80 tasks.
   */
  private readonly terminalCheckedAt = new Map<number, number>();

  constructor(
    private readonly env: Env,
    private readonly config: GlobalConfig,
    private readonly store: Store,
    private readonly credentials: Credentials,
  ) {
    this.notify = notifier(env.DISCORD_WEBHOOK_URL, log);
    this.paused = store.meta('dispatch_paused') === '1';
  }

  /** Credentials can arrive from the dashboard long after boot, so the client is built per tick. */
  private client(): GitHub | null {
    const creds = this.credentials.github();
    if (!creds) return null;
    const signature = JSON.stringify([creds.mode, creds.appId, creds.token?.slice(-8)]);
    if (!this.github || this.signature !== signature) {
      this.signature = signature;
      this.github = new GitHub(creds);
      this.contexts.clear();
      this.identityResolved = false;
    }
    return this.github;
  }

  /** Called when the dashboard saves new credentials or adds a repository. */
  reload(): void {
    this.contexts.clear();
    void this.tick();
  }

  get configured(): boolean {
    return Boolean(this.credentials.github()) && Boolean(this.credentials.claudeToken());
  }

  async start(): Promise<void> {
    this.recoverInterrupted();
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.config.poll_interval_seconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get busy(): number {
    return this.inflight.size;
  }

  get capacity(): number {
    return this.config.max_concurrent_runs;
  }

  get dispatching(): boolean {
    return this.config.dispatch_enabled && !this.paused;
  }

  /** Pausing stops new claims from being picked up; runs already in flight finish on their own. */
  pause(): void {
    this.paused = true;
    this.store.setMeta('dispatch_paused', '1');
  }

  resume(): void {
    this.paused = false;
    this.store.setMeta('dispatch_paused', '0');
    void this.tick();
  }

  private recoverInterrupted(): void {
    for (const state of ['claimed', 'running'] as const) {
      for (const task of this.store.byState(state)) {
        this.store.transition(task.id, 'discovered', {}, 'orchestrator restarted mid-run, task released');
      }
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const github = this.client();
      if (!github) {
        log.debug('no GitHub credentials yet, waiting for the setup to complete');
        return;
      }
      if (!this.identityResolved) {
        this.botLogin = await github.botIdentity();
        this.identityResolved = true;
        log.info(`agent identity: ${this.botLogin}`);
      }
      await this.loadRepositories();
      await this.resumeAnswered();
      this.resumeRetries();
      await this.syncPullRequests();
      await this.syncIssues();
      await this.dispatch();
      this.store.setMeta('last_tick_at', now());
    } catch (error) {
      log.error('tick failed', { error: String(error) });
    } finally {
      this.ticking = false;
    }
  }

  seedRepositories(): void {
    for (const entry of this.config.repositories) {
      if (this.store.repoByName(entry.repo)) continue;
      this.store.upsertRepo(entry.repo, entry.enabled, entry.settings ?? {});
    }
  }

  private async loadRepositories(): Promise<void> {
    for (const row of this.store.repos()) {
      if (!row.enabled) {
        this.contexts.delete(row.full_name);
        continue;
      }
      if (this.contexts.has(row.full_name)) continue;
      const overrides = JSON.parse(row.settings_json || '{}') as { config_path?: string };
      try {
        const access = await this.gh().access(row.full_name);
        if (access.installationId) this.store.setInstallation(row.id, access.installationId);
        const configPath = overrides.config_path ?? this.config.defaults.config_path ?? '.issue-auto-solve.yml';
        const file = await fetchRepoFile(access, configPath);
        const settings = resolveRepoSettings(this.config, overrides, file, row.full_name);
        this.contexts.set(row.full_name, { id: row.id, fullName: row.full_name, settings });
        this.store.setRepoError(row.id, null);
        log.info(`watching ${row.full_name}`, { base: settings.base_branch, configured: Boolean(file) });
      } catch (error) {
        this.store.setRepoError(row.id, String(error));
        log.error(`cannot watch ${row.full_name}`, { error: String(error) });
      }
    }
  }

  private async resumeAnswered(): Promise<void> {
    for (const task of this.store.byState('waiting_human')) {
      const context = this.contextFor(task);
      if (!context) continue;
      try {
        const access = await this.gh().access(context.fullName);
        const answer = await answerAfter(access, task.number, task.waiting_comment_id, this.botLogin);
        if (!answer) continue;
        await setLabel(access, task.number, context.settings.labels.waiting, false);
        this.store.transition(task.id, 'discovered', {}, `answered by ${answer.author}`);
        log.info(`#${task.number} on ${context.fullName} was answered, back in the queue`);
        const message = `💬 ${context.fullName}#${task.number} answered by ${answer.author}, picking it back up`;
        await this.notify(message);
        await this.fireRuleNotifications(context.fullName, 'discovered', message);
      } catch (error) {
        log.error(`resume check failed for ${context.fullName}#${task.number}`, { error: String(error) });
      }
    }
  }

  /** Tasks parked in `failed` after hitting the Claude usage limit, back in the queue once their delay has passed. */
  private resumeRetries(): void {
    for (const task of this.store.dueForRetry()) {
      const context = this.contextFor(task);
      const label = context ? context.fullName : `repo ${task.repo_id}`;
      this.terminalCheckedAt.delete(task.id);
      this.store.transition(task.id, 'discovered', {}, 'usage limit delay passed, retrying');
      log.info(`#${task.number} on ${label} is retrying after the usage limit delay`);
    }
  }

  /**
   * A pull request is merged (or closed, or reopened) on GitHub itself, never through this
   * app, so a task that stopped at pr_open — or was marked skipped/failed after a branch
   * was pushed — can silently drift out of date. Anything that once had a branch is
   * re-checked against GitHub so the dashboard reflects what actually happened instead of
   * freezing at whatever the last run concluded.
   */
  private async syncPullRequests(): Promise<void> {
    const dueAt = Date.now() - this.config.reconcile_terminal_interval_seconds * 1000;
    const openEnded = this.store.byState('pr_open');
    const due = (['skipped', 'failed'] as const)
      .flatMap((state) => this.store.byState(state))
      .filter((task) => (this.terminalCheckedAt.get(task.id) ?? 0) <= dueAt);
    const candidates = [...openEnded, ...due];
    for (const task of candidates) {
      if (!task.branch) continue;
      const context = this.contextFor(task);
      if (!context) continue;
      try {
        const access = await this.gh().access(context.fullName);
        const work = await existingWork(access, task.number, task.branch);
        if (work.pullRequestMerged && task.state !== 'merged') {
          this.store.transition(task.id, 'merged', { pr_url: work.pullRequest, branch: task.branch }, 'pull request merged');
          log.info(`#${task.number} on ${context.fullName} merged -> ${work.pullRequest}`);
          const message = `🎉 ${context.fullName}#${task.number} merged → ${work.pullRequest}`;
          await this.notify(message);
          await this.fireRuleNotifications(context.fullName, 'merged', message);
        } else if (work.pullRequestOpen && task.state !== 'pr_open') {
          this.store.transition(
            task.id,
            'pr_open',
            { pr_url: work.pullRequest, branch: task.branch },
            'pull request found open on GitHub',
          );
          log.info(`#${task.number} on ${context.fullName} actually has an open pull request -> ${work.pullRequest}`);
        }
        if (task.state === 'skipped' || task.state === 'failed') this.terminalCheckedAt.set(task.id, Date.now());
      } catch (error) {
        log.error(`pull request check failed for ${context.fullName}#${task.number}`, { error: String(error) });
      }
    }
  }

  private async syncIssues(): Promise<void> {
    for (const context of this.contexts.values()) {
      const repo = this.store.repos().find((r) => r.id === context.id);
      const cursor = now();
      try {
        const access = await this.gh().access(context.fullName);
        const issues = await listUpdatedIssues(access, repo?.last_sync_at ?? null);
        for (const issue of issues) {
          const known = this.store.taskByNumber(context.id, issue.number);
          const task = this.store.observeIssue({ repoId: context.id, ...issue });
          if (!known) this.store.event(task.id, null, 'discovered', `#${issue.number} ${issue.title}`);
          await this.reconcileLabels(context, access, task, issue);
        }
        this.store.setRepoSynced(context.id, cursor);
        log.debug(`${context.fullName}: ${issues.length} issue(s) seen since ${repo?.last_sync_at ?? 'the beginning'}`);
      } catch (error) {
        this.store.setRepoError(context.id, String(error));
        log.error(`sync failed for ${context.fullName}`, { error: String(error) });
      }
    }
  }

  /**
   * On a public repository anybody can open an issue, so nothing is worked on until a
   * maintainer approves it. Applying a label already requires triage permission, which
   * makes the label itself the gate; trusted_associations and whitelist_users narrow it
   * further by who opened the issue — either one is enough to pass, since together they
   * form a single whitelist expressed as groups or as individual logins. When check_tags
   * is on and whitelist_tags is non-empty, the issue must also carry one of those tags —
   * an independent gate on top of who opened it.
   */
  private approvalGate(context: RepoContext, labels: string[], author: string, authorAssociation: string): string | null {
    const { require_label: required, trusted_associations: trusted, whitelist_users: whitelisted } = context.settings.selection;
    const { check_tags: checkTags, whitelist_tags: whitelistedTags } = context.settings.selection;
    if (required && !labels.includes(required)) return `waiting for a maintainer to add the "${required}" label`;
    if ((trusted.length || whitelisted.length) && !trusted.includes(authorAssociation) && !whitelisted.includes(author)) {
      return `opened by ${author} (${authorAssociation}), not on the trusted list`;
    }
    if (checkTags && whitelistedTags.length && !labels.some((label) => whitelistedTags.includes(label))) {
      return `not tagged with one of the allowed tags (${whitelistedTags.join(', ')})`;
    }
    return null;
  }

  /**
   * Labels and users are the human's remote control: excluding a label or blacklisting a
   * user takes the issue out of the queue, the waiting label parks it. Adopting a
   * repository that was already using the waiting label must not re-run work that is
   * genuinely waiting for an answer.
   */
  private async reconcileLabels(
    context: RepoContext,
    access: RepoAccess,
    task: TaskRow,
    issue: { labels: string[]; author: string; authorAssociation: string },
  ): Promise<void> {
    const labels = issue.labels;
    const { check_tags: checkTags, blacklist_tags: blacklistedTags } = context.settings.selection;
    const excludedLabel = labels.find((label) => context.settings.labels.exclude.includes(label)) ?? null;
    const blacklistedUser = context.settings.selection.blacklist_users.includes(issue.author) ? issue.author : null;
    const blacklistedTag = checkTags ? (labels.find((label) => blacklistedTags.includes(label)) ?? null) : null;
    const excluded = Boolean(excludedLabel || blacklistedUser || blacklistedTag);
    const waitingLabel = context.settings.labels.waiting;
    const parked = Boolean(waitingLabel) && labels.includes(waitingLabel);
    const gate = this.approvalGate(context, labels, issue.author, issue.authorAssociation);

    if (task.state === 'discovered' && excluded) {
      const reason = excludedLabel
        ? `excluded by label "${excludedLabel}"`
        : blacklistedUser
          ? `blacklisted user "${blacklistedUser}"`
          : `blacklisted tag "${blacklistedTag}"`;
      this.store.transition(task.id, 'skipped', { reason });
      return;
    }
    if (
      task.state === 'skipped' &&
      !excluded &&
      ((task.reason ?? '').startsWith('excluded by label') ||
        (task.reason ?? '').startsWith('blacklisted user') ||
        (task.reason ?? '').startsWith('blacklisted tag'))
    ) {
      this.terminalCheckedAt.delete(task.id);
      this.store.transition(task.id, 'discovered', {}, 'exclusion removed');
      return;
    }
    if (gate && task.state === 'discovered') {
      this.store.transition(task.id, 'needs_approval', { reason: gate }, gate);
      return;
    }
    if (!gate && task.state === 'needs_approval') {
      this.store.transition(task.id, 'discovered', {}, 'approved');
      return;
    }
    if (task.state === 'discovered' && parked && task.run_count === 0) {
      const issue = await getIssue(access, task.number);
      const question = [...issue.comments].reverse().find((c) => c.author === this.botLogin) ?? issue.comments.at(-1) ?? null;
      this.store.transition(
        task.id,
        'waiting_human',
        {
          waiting_comment_id: question?.id ?? null,
          waiting_since: question?.createdAt ?? now(),
          reason: 'adopted: already carried the waiting label',
        },
        'adopted an issue that was already waiting for an answer',
      );
      return;
    }
    if (task.state === 'waiting_human' && waitingLabel && !parked) {
      this.store.transition(task.id, 'discovered', {}, 'waiting label removed by hand');
    }
  }

  private async dispatch(): Promise<void> {
    if (!this.dispatching) return;
    for (const context of this.contexts.values()) {
      while (this.inflight.size < this.config.max_concurrent_runs) {
        if (this.store.countActive(context.id) >= context.settings.limits.max_concurrent_runs) break;
        const candidate = this.store
          .claimable(
            context.id,
            context.settings.labels.exclude,
            context.settings.selection.order,
            context.settings.selection.priority_labels,
          )
          .find((task) => task.run_count < context.settings.limits.max_runs_per_task);
        if (!candidate) break;
        let claimed: TaskRow | null;
        try {
          claimed = await this.claim(context, candidate);
        } catch (error) {
          log.error(`claim failed for ${context.fullName}#${candidate.number}`, { error: String(error) });
          break;
        }
        if (!claimed) continue;
        void this.execute(context, claimed);
      }
    }
  }

  /**
   * Manual override from the dashboard: run this task right now, bypassing the approval
   * gate, exclude labels, the waiting-human park, the dispatch pause, and every concurrency
   * limit. It still refuses to clobber a task that is already claimed or running, and still
   * backs off if a branch or pull request already exists for it.
   */
  async forceRun(taskId: number): Promise<{ ok: true } | { ok: false; error: string }> {
    let task = this.store.task(taskId);
    if (!task) return { ok: false, error: 'unknown task' };
    if (this.inflight.has(task.id) || task.state === 'claimed' || task.state === 'running') {
      return { ok: false, error: 'already running' };
    }
    const context = this.contextFor(task);
    if (!context) return { ok: false, error: 'repository is not configured' };
    if (task.state !== 'discovered') {
      task = this.store.transition(task.id, 'discovered', {}, 'forced from the dashboard');
    }
    const claimed = await this.claim(context, task);
    if (!claimed) {
      const fresh = this.store.task(taskId);
      return { ok: false, error: fresh?.reason ?? 'a branch or pull request already exists' };
    }
    void this.execute(context, claimed);
    return { ok: true };
  }

  /**
   * Manual override from the dashboard: discard a failed task's persisted Claude Code session
   * so its next run starts a brand-new conversation instead of resuming the one that failed.
   */
  resetSession(taskId: number): void {
    this.discardSession(taskId);
    this.store.clearSessionId(taskId);
  }

  private async claim(context: RepoContext, task: TaskRow): Promise<TaskRow | null> {
    const branch = render(context.settings.branch_pattern, { number: task.number });
    const access = await this.gh().access(context.fullName);
    const work = await existingWork(access, task.number, branch);
    if (work.pullRequestMerged) {
      this.store.transition(
        task.id,
        'merged',
        { pr_url: work.pullRequest, branch, reason: 'a pull request already exists and was merged' },
        'a pull request for this issue was already merged',
      );
      return null;
    }
    if (work.pullRequest) {
      this.store.transition(
        task.id,
        'pr_open',
        { pr_url: work.pullRequest, branch, reason: 'a pull request already exists' },
        'a pull request already exists',
      );
      return null;
    }
    if (work.branch) {
      this.store.transition(task.id, 'skipped', { branch, reason: 'branch already exists on the remote' });
      return null;
    }
    return this.store.transition(task.id, 'claimed', { branch, phase: 'claimed' }, `claimed as ${branch}`);
  }

  private async execute(context: RepoContext, task: TaskRow): Promise<void> {
    this.inflight.add(task.id);
    const logPath = join(resolve(this.env.LOG_DIR), `task-${context.id}-${task.number}-${Date.now()}.log`);
    mkdirSync(dirname(logPath), { recursive: true });
    const run = this.store.startRun(task.id, logPath);
    this.store.transition(task.id, 'running', { branch: task.branch, phase: 'workspace' }, 'run started');

    const sessionId = task.session_id ?? randomUUID();
    if (!task.session_id) this.store.setSessionId(task.id, sessionId);
    const sessionPath = this.sessionPath(task.id);
    mkdirSync(sessionPath, { recursive: true });

    try {
      const access = await this.gh().access(context.fullName);
      const issue = await getIssue(access, task.number);
      const branch = task.branch ?? render(context.settings.branch_pattern, { number: task.number });

      const workspace = await prepareWorkspace({
        root: resolve(this.env.WORKSPACE_DIR),
        fullName: context.fullName,
        token: access.token,
        baseBranch: context.settings.base_branch,
        branch,
        actor: { name: this.botLogin, email: `${this.botLogin}@users.noreply.github.com` },
      });

      this.store.setPhase(task.id, 'agent');
      const controlPath = join(resolve(this.env.STATE_DIR), 'control', String(run.id));
      const prompt = await this.buildPrompt(access, context, task, issue, branch);

      const result = await runContainer(
        {
          runId: run.id,
          image: context.settings.runtime.image,
          settings: context.settings,
          workspacePath: workspace.path,
          hostWorkspacePath: this.hostPath(workspace.path, this.env.WORKSPACE_DIR, this.env.HOST_WORKSPACE_DIR),
          controlPath,
          hostControlPath: this.hostPath(controlPath, this.env.STATE_DIR, this.env.HOST_STATE_DIR),
          logPath,
          prompt,
          env: this.containerEnv(context, access),
          secrets: [access.token, this.credentials.claudeToken() ?? ''],
          timeoutMinutes: context.settings.limits.timeout_minutes,
          sessionId,
          hostSessionPath: this.hostPath(sessionPath, this.env.STATE_DIR, this.env.HOST_STATE_DIR),
        },
        log,
      );

      if (result.status === 'succeeded') {
        this.store.setMeta('claude_token_invalid', '0');
        this.store.setMeta('usage_limit_active', '0');
      } else if (logTailContains(logPath, CLAUDE_AUTH_ERROR_MARKER)) {
        this.store.setMeta('claude_token_invalid', '1');
        log.error(`${context.fullName}#${task.number}: the Claude Code token was rejected`);
      }

      const usage = parseRunUsage(logPath);
      await this.settle(context, task, run.id, result.status, result.exitCode, branch, workspace.path, usage, logPath);
    } catch (error) {
      this.store.finishRun(run.id, 'failed', null, String(error));
      this.store.transition(task.id, 'failed', { reason: String(error) }, 'run crashed');
      log.error(`run failed for ${context.fullName}#${task.number}`, { error: String(error) });
      const message = `❌ ${context.fullName}#${task.number} failed: ${String(error).slice(0, 300)}`;
      await this.notify(message);
      await this.fireRuleNotifications(context.fullName, 'failed', message);
    } finally {
      this.inflight.delete(task.id);
    }
  }

  private async settle(
    context: RepoContext,
    task: TaskRow,
    runId: number,
    status: 'succeeded' | 'failed' | 'timeout',
    exitCode: number | null,
    branch: string,
    workspacePath: string,
    usage: RunUsage | null,
    logPath: string,
  ): Promise<void> {
    const access = await this.gh().access(context.fullName);
    const run = this.store.run(runId);
    const work = await existingWork(access, task.number, branch);

    if (work.pullRequestMerged) {
      this.store.finishRun(runId, 'succeeded', exitCode, null, usage);
      this.store.transition(task.id, 'merged', { pr_url: work.pullRequest, branch }, 'pull request opened and merged');
      discardWorkspace(workspacePath);
      this.discardSession(task.id);
      const message = `🎉 ${context.fullName}#${task.number} → ${work.pullRequest} (merged)`;
      await this.notify(message);
      await this.fireRuleNotifications(context.fullName, 'merged', message);
      return;
    }

    if (work.pullRequest) {
      this.store.finishRun(runId, 'succeeded', exitCode, null, usage);
      this.store.transition(task.id, 'pr_open', { pr_url: work.pullRequest, branch }, `pull request opened`);
      discardWorkspace(workspacePath);
      this.discardSession(task.id);
      const message = `✅ ${context.fullName}#${task.number} → ${work.pullRequest}`;
      await this.notify(message);
      await this.fireRuleNotifications(context.fullName, 'pr_open', message);
      return;
    }

    const question = await lastCommentBy(access, task.number, this.botLogin);
    const askedDuringRun = question && run && new Date(question.createdAt).getTime() >= new Date(run.started_at).getTime();
    if (askedDuringRun) {
      this.store.finishRun(runId, 'succeeded', exitCode, null, usage);
      await setLabel(access, task.number, context.settings.labels.waiting, true);
      this.store.transition(
        task.id,
        'waiting_human',
        { branch, waiting_comment_id: question.id, waiting_since: now(), reason: question.body.slice(0, 280) },
        'question posted, waiting for an answer',
      );
      discardWorkspace(workspacePath);
      const message = `❓ ${context.fullName}#${task.number} needs an answer: ${question.body.slice(0, 200)}`;
      await this.notify(message);
      await this.fireRuleNotifications(context.fullName, 'waiting_human', message);
      return;
    }

    const retryAt = status !== 'timeout' ? usageLimitRetryAt(logPath) : null;
    if (retryAt) {
      this.store.setMeta('usage_limit_active', '1');
      this.store.setMeta('usage_limit_retry_at', retryAt.toISOString());
    }
    const reason = status === 'timeout'
      ? `timed out after ${context.settings.limits.timeout_minutes}m`
      : retryAt
        ? `Claude usage limit reached, retrying at ${retryAt.toISOString()}`
        : `agent exited with code ${exitCode ?? '?'} without opening a pull request`;
    this.store.finishRun(runId, status === 'timeout' ? 'timeout' : 'failed', exitCode, reason, usage);
    this.store.transition(task.id, 'failed', { branch, reason, retry_at: retryAt?.toISOString() ?? null }, reason);
    const message = `⚠️ ${context.fullName}#${task.number}: ${reason}`;
    await this.notify(message);
    await this.fireRuleNotifications(context.fullName, 'failed', message);
  }

  private async buildPrompt(
    access: RepoAccess,
    context: RepoContext,
    task: TaskRow,
    issue: Awaited<ReturnType<typeof getIssue>>,
    branch: string,
  ): Promise<string> {
    const custom = context.settings.prompt.file ? await fetchRepoFile(access, context.settings.prompt.file) : null;
    const template = custom ?? readFileSync(join(here, '..', '..', 'prompts', 'default.md'), 'utf8');
    const checks = context.settings.checks.length
      ? context.settings.checks.map((c) => `- **${c.name}**: \`${c.run}\`${c.when ? ` (when \`${c.when}\` changed)` : ''}`).join('\n')
      : '- No check is configured for this repository. Run whatever the project uses and say what you ran.';

    return render(template, {
      repo: context.fullName,
      issue_number: task.number,
      issue_title: issue.title,
      issue_body: issue.body,
      issue_comments: issue.comments
        .slice(-10)
        .map((c) => `**${c.author}** (${c.createdAt}):\n${c.body}`)
        .join('\n\n---\n\n'),
      resumed: task.run_count > 1,
      branch,
      base_branch: context.settings.base_branch,
      checks,
      waiting_label: context.settings.labels.waiting,
      ...context.settings.prompt.variables,
    });
  }

  private containerEnv(context: RepoContext, access: RepoAccess): Record<string, string> {
    const env: Record<string, string> = {
      CLAUDE_CODE_OAUTH_TOKEN: this.credentials.claudeToken() ?? '',
      GH_TOKEN: access.token,
      GITHUB_TOKEN: access.token,
    };
    for (const key of context.settings.runtime.env) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    return env;
  }

  /** Volumes are mounted by the host daemon, so paths must be host paths when issue-auto-solve itself runs in a container. */
  private hostPath(local: string, localRoot: string, hostRoot?: string): string {
    return hostRoot ? join(hostRoot, relative(resolve(localRoot), local)) : local;
  }

  /** Where a task's Claude Code session (`~/.claude`) is persisted, so a retry can resume it instead of starting cold. */
  private sessionPath(taskId: number): string {
    return join(resolve(this.env.STATE_DIR), 'sessions', String(taskId));
  }

  /** Drops a finished task's persisted session — nothing will ever resume it again. */
  private discardSession(taskId: number): void {
    rmSync(this.sessionPath(taskId), { recursive: true, force: true });
  }

  /** Generates .issue-auto-solve.yml for a repository by reading it, and opens a pull request. */
  async bootstrap(fullName: string, instructions: string): Promise<void> {
    const row = this.store.repoByName(fullName);
    if (!row) throw new Error(`unknown repository ${fullName}`);
    const logPath = join(resolve(this.env.LOG_DIR), `bootstrap-${row.id}-${Date.now()}.log`);
    mkdirSync(dirname(logPath), { recursive: true });
    const id = this.store.startBootstrap(row.id, instructions, logPath);

    try {
      const access = await this.gh().access(fullName);
      const repo = await access.octokit.repos.get({ owner: access.owner, repo: access.name });
      const baseBranch = repo.data.default_branch;
      const settings: RepoSettings = {
        ...builtinDefaults,
        base_branch: baseBranch,
        runtime: { ...builtinDefaults.runtime, image: this.config.bootstrap.image, setup: this.config.bootstrap.setup },
      };

      const workspace = await prepareWorkspace({
        root: resolve(this.env.WORKSPACE_DIR),
        fullName,
        token: access.token,
        baseBranch,
        branch: 'issue-auto-solve/config',
        actor: { name: this.botLogin, email: `${this.botLogin}@users.noreply.github.com` },
      });

      const template = readFileSync(join(here, '..', '..', 'prompts', 'bootstrap.md'), 'utf8');
      const prompt = render(template, {
        repo: fullName,
        base_branch: baseBranch,
        instructions: instructions.trim() || 'Nothing specific — infer everything from the repository.',
      });
      const controlPath = join(resolve(this.env.STATE_DIR), 'control', `bootstrap-${id}`);

      const result = await runContainer(
        {
          runId: id,
          image: settings.runtime.image,
          settings,
          workspacePath: workspace.path,
          hostWorkspacePath: this.hostPath(workspace.path, this.env.WORKSPACE_DIR, this.env.HOST_WORKSPACE_DIR),
          controlPath,
          hostControlPath: this.hostPath(controlPath, this.env.STATE_DIR, this.env.HOST_STATE_DIR),
          logPath,
          prompt,
          env: {
            CLAUDE_CODE_OAUTH_TOKEN: this.credentials.claudeToken() ?? '',
            GH_TOKEN: access.token,
            GITHUB_TOKEN: access.token,
          },
          secrets: [access.token, this.credentials.claudeToken() ?? ''],
          timeoutMinutes: 20,
        },
        log,
      );

      if (result.status === 'succeeded') {
        this.store.setMeta('claude_token_invalid', '0');
      } else if (logTailContains(logPath, CLAUDE_AUTH_ERROR_MARKER)) {
        this.store.setMeta('claude_token_invalid', '1');
        log.error(`${fullName}: the Claude Code token was rejected`);
      }

      const work = await existingWork(access, 0, 'issue-auto-solve/config');
      this.store.finishBootstrap(
        id,
        work.pullRequest ? 'succeeded' : 'failed',
        work.pullRequest ?? `no pull request opened (container ${result.status})`,
        parseRunUsage(logPath),
      );
      discardWorkspace(workspace.path);
      if (work.pullRequest) await this.notify(`⚙️ ${fullName}: configuration proposed → ${work.pullRequest}`);
    } catch (error) {
      this.store.finishBootstrap(id, 'failed', String(error));
      log.error(`bootstrap failed for ${fullName}`, { error: String(error) });
    }
  }

  /**
   * Configurable alerts, distinct from the single operator-wide `notify` above: a rule
   * scopes itself to a set of repositories and statuses (either left empty means "any")
   * and lists the Discord/webhook targets that should hear about it.
   */
  private async fireRuleNotifications(fullName: string, state: TaskState, message: string): Promise<void> {
    const rules = this.store.notificationRules().map((row) => ({
      id: row.id,
      name: row.name,
      enabled: Boolean(row.enabled),
      repos: JSON.parse(row.repos_json) as string[],
      statuses: JSON.parse(row.statuses_json) as TaskState[],
      targets: JSON.parse(row.targets_json) as { type: 'discord' | 'webhook'; url: string }[],
    }));
    const targets = matchingTargets(rules, fullName, state);
    await Promise.all(targets.map((target) => sendToTarget(target, message, { repo: fullName, status: state }, log)));
  }

  private gh(): GitHub {
    const github = this.client();
    if (!github) throw new Error('GitHub is not configured yet');
    return github;
  }

  /** Exposes repo-scoped GitHub access to the dashboard API, e.g. to list real labels and users. */
  async repoAccess(fullName: string): Promise<RepoAccess> {
    return this.gh().access(fullName);
  }

  private contextFor(task: TaskRow): RepoContext | undefined {
    return [...this.contexts.values()].find((context) => context.id === task.repo_id);
  }
}
