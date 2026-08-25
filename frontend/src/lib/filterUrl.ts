import { DEFAULT_STATE_FILTERS, LABELS } from './constants';
import type { TaskFilters, TaskState } from '../types';

const ALL_STATES = Object.keys(LABELS) as TaskState[];
const DEFAULT_STATES = new Set(DEFAULT_STATE_FILTERS);

function sameStates(a: Set<TaskState>, b: Set<TaskState>): boolean {
  return a.size === b.size && [...a].every((state) => b.has(state));
}

// No `state` param means "default chips"; an explicit (possibly empty) one means the
// user picked exactly that set, including none, so a reload or shared link reproduces it.
export function filtersFromSearch(search: string): TaskFilters {
  const params = new URLSearchParams(search);
  const stateParam = params.get('state');
  const states =
    stateParam === null
      ? new Set(DEFAULT_STATES)
      : new Set(stateParam.split(',').filter((s): s is TaskState => ALL_STATES.includes(s as TaskState)));
  return { states, repo: params.get('repo') ?? '', q: params.get('q') ?? '' };
}

export function searchFromFilters(filters: TaskFilters): string {
  const params = new URLSearchParams();
  if (!sameStates(filters.states, DEFAULT_STATES)) params.set('state', [...filters.states].join(','));
  if (filters.repo) params.set('repo', filters.repo);
  if (filters.q) params.set('q', filters.q);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
