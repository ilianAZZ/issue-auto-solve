import { useOverview } from '../api/queries';
import { cost, tokens } from '../lib/format';
import type { TaskFilters, TaskState } from '../types';

// Maps a stat card to the task state(s) it represents. `claimed` has no chip
// of its own in FilterBar (it's folded into "Working"), so the Working card
// sets both. Cards without an entry here (Repositories, Claude cost/tokens)
// aren't task-state filters and stay non-interactive.
const CARD_STATES: Partial<Record<string, TaskState[]>> = {
  Working: ['running', 'claimed'],
  'Waiting on you': ['waiting_human'],
  'Needs approval': ['needs_approval'],
  Queued: ['discovered'],
  'PRs open': ['pr_open'],
  Merged: ['merged'],
  Failed: ['failed'],
};

export function StatsGrid({ filters, onChange }: { filters: TaskFilters; onChange: (next: TaskFilters) => void }) {
  const { data } = useOverview();
  if (!data) return null;

  const cards = [
    { key: 'Working', n: data.counts.running + data.counts.claimed, alert: false },
    { key: 'Waiting on you', n: data.counts.waiting_human, alert: data.counts.waiting_human > 0 },
    { key: 'Needs approval', n: data.counts.needs_approval, alert: data.counts.needs_approval > 0 },
    { key: 'Queued', n: data.counts.discovered, alert: false },
    { key: 'PRs open', n: data.counts.pr_open, alert: false },
    { key: 'Merged', n: data.counts.merged, alert: false },
    { key: 'Failed', n: data.counts.failed, alert: false },
    { key: 'Repositories', n: data.repos.filter((r) => r.enabled).length, alert: false },
    { key: 'Claude cost', n: cost(data.usage.cost_usd), alert: false },
    { key: 'Claude tokens', n: tokens(data.usage.input_tokens + data.usage.output_tokens), alert: false },
  ];

  function setStates(states: TaskState[]) {
    const isActive = states.length === filters.states.size && states.every((s) => filters.states.has(s));
    onChange({ ...filters, states: isActive ? new Set() : new Set(states) });
  }

  return (
    <section className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
      {cards.map((card) => {
        const states = CARD_STATES[card.key];
        const active = !!states && states.length === filters.states.size && states.every((s) => filters.states.has(s));
        return (
          <button
            key={card.key}
            type="button"
            disabled={!states}
            aria-pressed={states ? active : undefined}
            onClick={states ? () => setStates(states) : undefined}
            className={`rounded-xl border px-4 py-3.5 text-left transition-colors ${
              active ? 'border-accent/35 bg-accent-soft' : 'border-border bg-panel'
            } ${states ? 'cursor-pointer hover:border-accent/35' : 'cursor-default'}`}
          >
            <div className={`text-[26px] font-semibold tracking-tight ${card.alert ? 'text-amber' : ''}`}>{card.n}</div>
            <div className="text-xs tracking-wide text-muted uppercase">{card.key}</div>
          </button>
        );
      })}
    </section>
  );
}
