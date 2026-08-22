export const TASK_STATES = [
  'discovered',
  'claimed',
  'running',
  'waiting_human',
  'pr_open',
  'skipped',
  'failed',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

const transitions: Record<TaskState, TaskState[]> = {
  discovered: ['claimed', 'skipped', 'waiting_human'],
  claimed: ['running', 'discovered', 'failed'],
  running: ['pr_open', 'waiting_human', 'failed', 'skipped'],
  waiting_human: ['discovered', 'skipped', 'failed'],
  pr_open: ['discovered'],
  skipped: ['discovered'],
  failed: ['discovered', 'skipped'],
};

export const ACTIVE_STATES: TaskState[] = ['claimed', 'running'];
export const TERMINAL_STATES: TaskState[] = ['pr_open', 'skipped'];

export function canTransition(from: TaskState, to: TaskState): boolean {
  return from === to || (transitions[from]?.includes(to) ?? false);
}

export class InvalidTransition extends Error {
  constructor(from: TaskState, to: TaskState) {
    super(`illegal transition ${from} -> ${to}`);
  }
}
