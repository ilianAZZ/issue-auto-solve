export type TaskState =
  | 'discovered'
  | 'claimed'
  | 'running'
  | 'waiting_human'
  | 'needs_approval'
  | 'pr_open'
  | 'failed'
  | 'skipped';

export interface OverviewCounts {
  discovered: number;
  claimed: number;
  running: number;
  waiting_human: number;
  needs_approval: number;
  pr_open: number;
  failed: number;
  skipped: number;
}

export interface RepoOverview {
  full_name: string;
  enabled: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  active: number;
}

export interface Overview {
  status: 'paused' | 'working' | 'idle';
  dispatching: boolean;
  busy: number;
  capacity: number;
  last_tick_at: string | null;
  claude_token_invalid: boolean;
  counts: OverviewCounts;
  repos: RepoOverview[];
}

export interface Task {
  id: number;
  repo_id: number;
  number: number;
  title: string;
  url: string;
  labels: string[];
  state: TaskState;
  phase: string | null;
  branch: string | null;
  pr_url: string | null;
  reason: string | null;
  entered_state_at: string;
  updated_at: string;
  repo: string;
}

export interface TaskEvent {
  id: number;
  kind: string;
  message: string;
  created_at: string;
}

export interface Run {
  id: number;
  status: 'running' | 'succeeded' | 'failed' | 'timeout' | 'cancelled';
  started_at: string;
  ended_at: string | null;
}

export interface TaskDetail {
  task: Task;
  events: TaskEvent[];
  runs: Run[];
}

export interface BootstrapInfo {
  status: string;
  result: string | null;
}

export interface RepoSetup {
  full_name: string;
  enabled: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  active: number;
  bootstrap: BootstrapInfo | null;
}

export interface SetupStatus {
  github: { mode: string; slug: string | null } | null;
  claude: boolean;
  locked: { github: boolean; claude: boolean };
  repositories: number;
  public_url: string;
  complete: boolean;
}

export interface TaskFilters {
  states: Set<TaskState>;
  repo: string;
  q: string;
}
