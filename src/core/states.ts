export const TASK_STATES = [
  'discovered',
  'needs_approval',
  'claimed',
  'running',
  'waiting_human',
  'pr_open',
  'merged',
  'skipped',
  'failed',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

// A pull request can be merged, closed, or reopened straight on GitHub, entirely outside
// this app's control — so tasks that already reached a branch (pr_open, or skipped/failed
// after an attempt) can be reconciled into pr_open or merged whenever GitHub disagrees
// with the last known state, not just moved forward through a fixed pipeline.
const transitions: Record<TaskState, TaskState[]> = {
  discovered: ['claimed', 'skipped', 'waiting_human', 'needs_approval', 'pr_open', 'merged'],
  needs_approval: ['discovered', 'skipped'],
  claimed: ['running', 'discovered', 'failed'],
  running: ['pr_open', 'waiting_human', 'failed', 'skipped', 'discovered', 'merged'],
  waiting_human: ['discovered', 'skipped', 'failed'],
  pr_open: ['discovered', 'merged'],
  merged: ['discovered'],
  skipped: ['discovered', 'pr_open', 'merged'],
  failed: ['discovered', 'skipped', 'pr_open', 'merged'],
};

export const ACTIVE_STATES: TaskState[] = ['claimed', 'running'];
export const TERMINAL_STATES: TaskState[] = ['pr_open', 'merged', 'skipped'];

export function canTransition(from: TaskState, to: TaskState): boolean {
  return from === to || (transitions[from]?.includes(to) ?? false);
}

export class InvalidTransition extends Error {
  constructor(from: TaskState, to: TaskState) {
    super(`illegal transition ${from} -> ${to}`);
  }
}
