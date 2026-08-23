import type { Db } from './index.js';
import { canTransition, InvalidTransition, type TaskState } from '../core/states.js';
import { now } from '../util/time.js';
import type { RunUsage } from '../util/usage.js';

export interface RepoRow {
  id: number;
  full_name: string;
  enabled: number;
  settings_json: string;
  installation_id: number | null;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface TaskRow {
  id: number;
  repo_id: number;
  number: number;
  title: string;
  url: string;
  labels_json: string;
  state: TaskState;
  phase: string | null;
  branch: string | null;
  pr_url: string | null;
  reason: string | null;
  waiting_comment_id: number | null;
  waiting_since: string | null;
  run_count: number;
  issue_updated_at: string | null;
  entered_state_at: string;
  created_at: string;
  updated_at: string;
}

export interface RunRow {
  id: number;
  task_id: number;
  status: 'running' | 'succeeded' | 'failed' | 'timeout' | 'cancelled';
  phase: string | null;
  log_path: string;
  exit_code: number | null;
  error: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  num_turns: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  started_at: string;
  ended_at: string | null;
}

export interface UsageTotals {
  run_count: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  duration_ms: number;
}

export interface EventRow {
  id: number;
  task_id: number | null;
  run_id: number | null;
  kind: string;
  message: string;
  created_at: string;
}

export interface BootstrapRow {
  id: number;
  repo_id: number;
  status: string;
  instructions: string;
  log_path: string;
  result: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  started_at: string;
  ended_at: string | null;
}

export class Store {
  constructor(private readonly db: Db) {}

  upsertRepo(fullName: string, enabled: boolean, settings: unknown): RepoRow {
    this.db
      .prepare(
        `INSERT INTO repos (full_name, enabled, settings_json) VALUES (?, ?, ?)
         ON CONFLICT (full_name) DO UPDATE SET enabled = excluded.enabled, settings_json = excluded.settings_json`,
      )
      .run(fullName, enabled ? 1 : 0, JSON.stringify(settings ?? {}));
    return this.repoByName(fullName)!;
  }

  removeRepo(fullName: string): void {
    this.db.prepare('DELETE FROM repos WHERE full_name = ?').run(fullName);
  }

  repoByName(fullName: string): RepoRow | undefined {
    return this.db.prepare('SELECT * FROM repos WHERE full_name = ?').get(fullName) as RepoRow | undefined;
  }

  repos(): RepoRow[] {
    return this.db.prepare('SELECT * FROM repos ORDER BY full_name').all() as unknown as RepoRow[];
  }

  setRepoSynced(id: number, at: string): void {
    this.db.prepare('UPDATE repos SET last_sync_at = ?, last_error = NULL WHERE id = ?').run(at, id);
  }

  setRepoError(id: number, error: string | null): void {
    this.db.prepare('UPDATE repos SET last_error = ? WHERE id = ?').run(error, id);
  }

  setInstallation(id: number, installationId: number): void {
    this.db.prepare('UPDATE repos SET installation_id = ? WHERE id = ?').run(installationId, id);
  }

  task(id: number): TaskRow | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  }

  taskByNumber(repoId: number, number: number): TaskRow | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE repo_id = ? AND number = ?').get(repoId, number) as
      | TaskRow
      | undefined;
  }

  observeIssue(input: {
    repoId: number;
    number: number;
    title: string;
    url: string;
    labels: string[];
    updatedAt: string;
  }): TaskRow {
    const stamp = now();
    const existing = this.taskByNumber(input.repoId, input.number);
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO tasks (repo_id, number, title, url, labels_json, issue_updated_at, entered_state_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.repoId,
          input.number,
          input.title,
          input.url,
          JSON.stringify(input.labels),
          input.updatedAt,
          stamp,
          stamp,
          stamp,
        );
      return this.taskByNumber(input.repoId, input.number)!;
    }
    this.db
      .prepare('UPDATE tasks SET title = ?, url = ?, labels_json = ?, issue_updated_at = ?, updated_at = ? WHERE id = ?')
      .run(input.title, input.url, JSON.stringify(input.labels), input.updatedAt, stamp, existing.id);
    return this.task(existing.id)!;
  }

  transition(
    taskId: number,
    to: TaskState,
    patch: Partial<Pick<TaskRow, 'phase' | 'branch' | 'pr_url' | 'reason' | 'waiting_comment_id' | 'waiting_since'>> = {},
    message = '',
  ): TaskRow {
    const task = this.task(taskId);
    if (!task) throw new Error(`unknown task ${taskId}`);
    if (!canTransition(task.state, to)) throw new InvalidTransition(task.state, to);
    const stamp = now();
    this.db
      .prepare(
        `UPDATE tasks SET state = ?, phase = ?, branch = ?, pr_url = ?, reason = ?,
           waiting_comment_id = ?, waiting_since = ?,
           entered_state_at = CASE WHEN state = ? THEN entered_state_at ELSE ? END,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        to,
        patch.phase ?? null,
        patch.branch ?? task.branch,
        patch.pr_url ?? task.pr_url,
        patch.reason ?? null,
        patch.waiting_comment_id ?? (to === 'waiting_human' ? task.waiting_comment_id : null),
        patch.waiting_since ?? (to === 'waiting_human' ? task.waiting_since ?? stamp : null),
        to,
        stamp,
        stamp,
        taskId,
      );
    if (task.state !== to) this.event(taskId, null, 'state', message || `${task.state} -> ${to}`);
    return this.task(taskId)!;
  }

  setPhase(taskId: number, phase: string): void {
    this.db.prepare('UPDATE tasks SET phase = ?, updated_at = ? WHERE id = ?').run(phase, now(), taskId);
  }

  claimable(repoId: number, excludeLabels: string[], order: 'oldest' | 'newest' | 'priority_labels', priority: string[]): TaskRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE repo_id = ? AND state = 'discovered' ORDER BY number ASC`)
      .all(repoId) as unknown as TaskRow[];
    const eligible = rows.filter((row) => {
      const labels = JSON.parse(row.labels_json) as string[];
      return !labels.some((label) => excludeLabels.includes(label));
    });
    if (order === 'newest') return eligible.reverse();
    if (order !== 'priority_labels') return eligible;
    const rank = (row: TaskRow) => {
      const labels = JSON.parse(row.labels_json) as string[];
      const index = priority.findIndex((label) => labels.includes(label));
      return index === -1 ? priority.length : index;
    };
    return eligible.sort((a, b) => rank(a) - rank(b) || a.number - b.number);
  }

  byState(state: TaskState): TaskRow[] {
    return this.db.prepare('SELECT * FROM tasks WHERE state = ? ORDER BY entered_state_at ASC').all(state) as unknown as TaskRow[];
  }

  countActive(repoId?: number): number {
    const sql = repoId
      ? `SELECT COUNT(*) AS n FROM tasks WHERE state IN ('claimed','running') AND repo_id = ?`
      : `SELECT COUNT(*) AS n FROM tasks WHERE state IN ('claimed','running')`;
    const row = (repoId ? this.db.prepare(sql).get(repoId) : this.db.prepare(sql).get()) as { n: number };
    return row.n;
  }

  startRun(taskId: number, logPath: string): RunRow {
    const stamp = now();
    this.db
      .prepare('INSERT INTO runs (task_id, log_path, started_at) VALUES (?, ?, ?)')
      .run(taskId, logPath, stamp);
    this.db.prepare('UPDATE tasks SET run_count = run_count + 1 WHERE id = ?').run(taskId);
    return this.db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(taskId) as unknown as RunRow;
  }

  finishRun(runId: number, status: RunRow['status'], exitCode: number | null, error: string | null, usage: RunUsage | null = null): void {
    this.db
      .prepare(
        `UPDATE runs SET status = ?, exit_code = ?, error = ?, ended_at = ?,
           cost_usd = ?, duration_ms = ?, num_turns = ?, input_tokens = ?, output_tokens = ?,
           cache_creation_input_tokens = ?, cache_read_input_tokens = ?
         WHERE id = ?`,
      )
      .run(
        status,
        exitCode,
        error,
        now(),
        usage?.cost_usd ?? null,
        usage?.duration_ms ?? null,
        usage?.num_turns ?? null,
        usage?.input_tokens ?? null,
        usage?.output_tokens ?? null,
        usage?.cache_creation_input_tokens ?? null,
        usage?.cache_read_input_tokens ?? null,
        runId,
      );
  }

  runsFor(taskId: number, limit = 10): RunRow[] {
    return this.db
      .prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY id DESC LIMIT ?')
      .all(taskId, limit) as unknown as RunRow[];
  }

  run(id: number): RunRow | undefined {
    return this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  }

  taskUsage(taskId: number): UsageTotals {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS run_count,
                COALESCE(SUM(cost_usd), 0) AS cost_usd,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
                COALESCE(SUM(cache_read_input_tokens), 0) AS cache_read_input_tokens,
                COALESCE(SUM(duration_ms), 0) AS duration_ms
         FROM runs WHERE task_id = ?`,
      )
      .get(taskId) as unknown as UsageTotals;
  }

  /** Global spend across every task run and repository bootstrap, the two places a container ever calls Claude. */
  usageSummary(): UsageTotals {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS run_count,
                COALESCE(SUM(cost_usd), 0) AS cost_usd,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
                COALESCE(SUM(cache_read_input_tokens), 0) AS cache_read_input_tokens,
                COALESCE(SUM(duration_ms), 0) AS duration_ms
         FROM (
           SELECT cost_usd, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, duration_ms FROM runs
           UNION ALL
           SELECT cost_usd, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, duration_ms FROM bootstrap_runs
         )`,
      )
      .get() as unknown as UsageTotals;
  }

  usageByRepo(): (UsageTotals & { repo_id: number; full_name: string })[] {
    return this.db
      .prepare(
        `SELECT r.id AS repo_id, r.full_name AS full_name,
                COUNT(runs.id) AS run_count,
                COALESCE(SUM(runs.cost_usd), 0) AS cost_usd,
                COALESCE(SUM(runs.input_tokens), 0) AS input_tokens,
                COALESCE(SUM(runs.output_tokens), 0) AS output_tokens,
                COALESCE(SUM(runs.cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
                COALESCE(SUM(runs.cache_read_input_tokens), 0) AS cache_read_input_tokens,
                COALESCE(SUM(runs.duration_ms), 0) AS duration_ms
         FROM repos r
         LEFT JOIN tasks t ON t.repo_id = r.id
         LEFT JOIN runs ON runs.task_id = t.id
         GROUP BY r.id
         ORDER BY cost_usd DESC`,
      )
      .all() as unknown as (UsageTotals & { repo_id: number; full_name: string })[];
  }

  event(taskId: number | null, runId: number | null, kind: string, message: string): void {
    this.db
      .prepare('INSERT INTO events (task_id, run_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(taskId, runId, kind, message, now());
  }

  eventsFor(taskId: number, limit = 50): EventRow[] {
    return this.db
      .prepare('SELECT * FROM events WHERE task_id = ? ORDER BY id DESC LIMIT ?')
      .all(taskId, limit) as unknown as EventRow[];
  }

  startBootstrap(repoId: number, instructions: string, logPath: string): number {
    this.db
      .prepare('INSERT INTO bootstrap_runs (repo_id, instructions, log_path, started_at) VALUES (?, ?, ?, ?)')
      .run(repoId, instructions, logPath, now());
    const row = this.db.prepare('SELECT id FROM bootstrap_runs ORDER BY id DESC LIMIT 1').get() as { id: number };
    return row.id;
  }

  finishBootstrap(id: number, status: string, result: string | null, usage: RunUsage | null = null): void {
    this.db
      .prepare(
        `UPDATE bootstrap_runs SET status = ?, result = ?, ended_at = ?,
           cost_usd = ?, duration_ms = ?, input_tokens = ?, output_tokens = ?,
           cache_creation_input_tokens = ?, cache_read_input_tokens = ?
         WHERE id = ?`,
      )
      .run(
        status,
        result,
        now(),
        usage?.cost_usd ?? null,
        usage?.duration_ms ?? null,
        usage?.input_tokens ?? null,
        usage?.output_tokens ?? null,
        usage?.cache_creation_input_tokens ?? null,
        usage?.cache_read_input_tokens ?? null,
        id,
      );
  }

  lastBootstrap(repoId: number): BootstrapRow | undefined {
    return this.db
      .prepare('SELECT * FROM bootstrap_runs WHERE repo_id = ? ORDER BY id DESC LIMIT 1')
      .get(repoId) as BootstrapRow | undefined;
  }

  meta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }
}
