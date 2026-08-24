import type { TaskState } from '../types';

// Order the filter chips are rendered in. `claimed` is folded into "Working"
// everywhere it's shown, so it has no chip of its own.
export const STATES: TaskState[] = [
  'running',
  'waiting_human',
  'needs_approval',
  'discovered',
  'pr_open',
  'merged',
  'failed',
  'skipped',
];

export const LABELS: Record<TaskState, string> = {
  running: 'Working',
  claimed: 'Claimed',
  waiting_human: 'Waiting on you',
  discovered: 'Queued',
  needs_approval: 'Needs approval',
  pr_open: 'PR open',
  merged: 'Merged',
  failed: 'Failed',
  skipped: 'Skipped',
};

export const PILL_CLASSES: Record<TaskState, string> = {
  discovered: 'bg-panel-2 text-muted border border-border',
  claimed: 'bg-accent-soft text-accent',
  running: 'bg-accent-soft text-accent',
  waiting_human: 'bg-amber-soft text-amber',
  needs_approval: 'bg-blue-soft text-blue',
  pr_open: 'bg-green-soft text-green',
  merged: 'bg-green-soft text-green',
  failed: 'bg-red-soft text-red',
  skipped: 'bg-panel-2 text-muted border border-border',
};

export const DEFAULT_STATE_FILTERS: TaskState[] = ['running', 'waiting_human', 'discovered', 'failed'];

// GitHub's fixed author_association values, mirrored from the server so the "trusted
// groups" picker still renders before /conditions has resolved (or if it never does,
// e.g. a repository the GitHub App isn't installed on yet).
export const AUTHOR_ASSOCIATIONS = [
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
  'CONTRIBUTOR',
  'FIRST_TIME_CONTRIBUTOR',
  'FIRST_TIMER',
  'MANNEQUIN',
  'NONE',
];
