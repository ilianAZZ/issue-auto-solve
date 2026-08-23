import { LABELS, PILL_CLASSES } from '../lib/constants';
import type { TaskState } from '../types';

export function Pill({ state }: { state: TaskState }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${PILL_CLASSES[state]}`}>
      {LABELS[state] ?? state}
    </span>
  );
}
