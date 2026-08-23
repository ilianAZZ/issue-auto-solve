import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
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
import { notifier, type Notify } from '../util/notify.js';
import { now } from '../util/time.js';
import { parseRunUsage, type RunUsage } from '../util/usage.js';

const log = logger('orchestrator');
const here = dirname(fileURLToPath(import.meta.url));

// Claude Code prints this and exits before doing anything else, so it always shows up
// near the end of a short log — a tail read is enough and keeps this cheap on big logs.
const CLAUDE_AUTH_ERROR_MARKER = 'OAuth access token is invalid';
const LOG_TAIL_BYTES = 65_536;

function logTailContains(logPath: string, marker: string): boolean {
  if (!existsSync(logPath)) return false;
  const size = statSync(logPath).size;
  const length = Math.min(size, LOG_TAIL_BYTES);
  if (length === 0) return false;
  const buffer = Buffer.alloc(length);
  const fd = openSync(logPath, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString('utf8').includes(marker);
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
        const settings = resolveRepoSettings(this.config, overrides, file);
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
      const access = await this.gh().access(context.fullName);
      const answer = await answerAfter(access, task.number, task.waiting_comment_id, this.botLogin);
      if (!answer) continue;
      await setLabel(access, task.number, context.settings.labels.waiting, false);
      this.store.transition(task.id, 'discovered', {}, `answered by ${answer.author}`);
      log.info(`#${task.number} on ${context.fullName} was answered, back in the queue`);
      await this.notify(`💬 ${context.fullName}#${task.number} answered by ${answer.author}, picking it back up`);
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
   * makes the label itself the gate; trusted_associations narrows it further by who opened
   * the issue.
   */
  private approvalGate(context: RepoContext, labels: string[], authorAssociation: string): string | null {
    const { require_label: required, trusted_associations: trusted } = context.settings.selection;
    if (required && !labels.includes(required)) return `waiting for a maintainer to add the "${required}" label`;
    if (trusted.length && !trusted.includes(authorAssociation)) return `opened by ${authorAssociation}, not a trusted author`;
    return null;
  }

  /**
   * Labels are the human's remote control: excluding one takes the issue out of the queue,
   * the waiting label parks it. Adopting a repository that was already using the waiting
   * label must not re-run work that is genuinely waiting for an answer.
   */
  private async reconcileLabels(
    context: RepoContext,
    access: RepoAccess,
    task: TaskRow,
    issue: { labels: string[]; authorAssociation: string },
  ): Promise<void> {
    const labels = issue.labels;
    const excluded = labels.some((label) => context.settings.labels.exclude.includes(label));
    const waitingLabel = context.settings.labels.waiting;
    const parked = Boolean(waitingLabel) && labels.includes(waitingLabel);
    const gate = this.approvalGate(context, labels, issue.authorAssociation);

    if (task.state === 'discovered' && excluded) {
      const label = labels.find((l) => context.settings.labels.exclude.includes(l));
      this.store.transition(task.id, 'skipped', { reason: `excluded by label "${label}"` });
      return;
    }
    if (task.state === 'skipped' && !excluded && (task.reason ?? '').startsWith('excluded by label')) {
      this.store.transition(task.id, 'discovered', {}, 'exclusion label removed');
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
        const claimed = await this.claim(context, candidate);
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

  private async claim(context: RepoContext, task: TaskRow): Promise<TaskRow | null> {
    const branch = render(context.settings.branch_pattern, { number: task.number });
    const access = await this.gh().access(context.fullName);
    const work = await existingWork(access, task.number, branch);
    if (work.pullRequest) {
      this.store.transition(task.id, 'skipped', { pr_url: work.pullRequest, reason: 'a pull request already exists' });
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
        },
        log,
      );

      if (result.status === 'succeeded') {
        this.store.setMeta('claude_token_invalid', '0');
      } else if (logTailContains(logPath, CLAUDE_AUTH_ERROR_MARKER)) {
        this.store.setMeta('claude_token_invalid', '1');
        log.error(`${context.fullName}#${task.number}: the Claude Code token was rejected`);
      }

      const usage = parseRunUsage(logPath);
      await this.settle(context, task, run.id, result.status, result.exitCode, branch, workspace.path, usage);
    } catch (error) {
      this.store.finishRun(run.id, 'failed', null, String(error));
      this.store.transition(task.id, 'failed', { reason: String(error) }, 'run crashed');
      log.error(`run failed for ${context.fullName}#${task.number}`, { error: String(error) });
      await this.notify(`❌ ${context.fullName}#${task.number} failed: ${String(error).slice(0, 300)}`);
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
  ): Promise<void> {
    const access = await this.gh().access(context.fullName);
    const run = this.store.run(runId);
    const work = await existingWork(access, task.number, branch);

    if (work.pullRequest) {
      this.store.finishRun(runId, 'succeeded', exitCode, null, usage);
      this.store.transition(task.id, 'pr_open', { pr_url: work.pullRequest, branch }, `pull request opened`);
      discardWorkspace(workspacePath);
      await this.notify(`✅ ${context.fullName}#${task.number} → ${work.pullRequest}`);
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
      await this.notify(`❓ ${context.fullName}#${task.number} needs an answer: ${question.body.slice(0, 200)}`);
      return;
    }

    const reason = status === 'timeout' ? `timed out after ${context.settings.limits.timeout_minutes}m` : `agent exited with code ${exitCode ?? '?'} without opening a pull request`;
    this.store.finishRun(runId, status === 'timeout' ? 'timeout' : 'failed', exitCode, reason, usage);
    this.store.transition(task.id, 'failed', { branch, reason }, reason);
    await this.notify(`⚠️ ${context.fullName}#${task.number}: ${reason}`);
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

  private gh(): GitHub {
    const github = this.client();
    if (!github) throw new Error('GitHub is not configured yet');
    return github;
  }

  private contextFor(task: TaskRow): RepoContext | undefined {
    return [...this.contexts.values()].find((context) => context.id === task.repo_id);
  }
}
