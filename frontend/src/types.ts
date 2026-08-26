export type TaskState =
  | 'discovered'
  | 'claimed'
  | 'running'
  | 'waiting_human'
  | 'needs_approval'
  | 'pr_open'
  | 'merged'
  | 'failed'
  | 'skipped';

export interface OverviewCounts {
  discovered: number;
  claimed: number;
  running: number;
  waiting_human: number;
  needs_approval: number;
  pr_open: number;
  merged: number;
  failed: number;
  skipped: number;
}

export interface Usage {
  run_count: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  duration_ms: number;
}

export interface RepoOverview {
  full_name: string;
  enabled: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  active: number;
  usage: Usage | null;
}

export interface AutoUpdateStatus {
  enabled: boolean;
  checking: boolean;
  restart_pending: boolean;
  last_checked_at: string | null;
  update_available: boolean;
  current_image: string | null;
  last_error: string | null;
}

export interface Overview {
  status: 'paused' | 'working' | 'idle';
  version: string;
  dispatching: boolean;
  busy: number;
  capacity: number;
  last_tick_at: string | null;
  claude_token_invalid: boolean;
  usage_limit_active: boolean;
  usage_limit_retry_at: string | null;
  auto_update: AutoUpdateStatus;
  counts: OverviewCounts;
  usage: Usage;
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
  usage: Usage;
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

export interface TaskDetail {
  task: Task;
  events: TaskEvent[];
  runs: Run[];
}

export interface BootstrapInfo {
  status: string;
  result: string | null;
  instructions: string;
}

export interface RepoSetup {
  full_name: string;
  enabled: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  active: number;
  bootstrap: BootstrapInfo | null;
  settings: RepoSettingsForm;
}

export interface RepoConditions {
  labels: string[];
  users: string[];
  groups: string[];
}

export interface RepoSelectionSettings {
  trusted_associations: string[];
  whitelist_users: string[];
  blacklist_users: string[];
  check_tags: boolean;
  whitelist_tags: string[];
  blacklist_tags: string[];
}

export interface RepoPromptSettingsForm {
  file: string;
  variables: Record<string, string>;
}

export interface RepoSettingsForm {
  selection: RepoSelectionSettings;
  prompt: RepoPromptSettingsForm;
}

export interface RepoSettingsInput {
  selection: RepoSelectionSettings;
  prompt: { file: string | null; variables: Record<string, string> };
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

export type NotificationTargetType = 'discord' | 'webhook';

export interface NotificationTarget {
  type: NotificationTargetType;
  url: string;
}

export interface NotificationRule {
  id: number;
  name: string;
  enabled: boolean;
  repos: string[];
  statuses: TaskState[];
  targets: NotificationTarget[];
  created_at: string;
  updated_at: string;
}

export interface NotificationRuleInput {
  name: string;
  enabled: boolean;
  repos: string[];
  statuses: TaskState[];
  targets: NotificationTarget[];
}
