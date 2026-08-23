import { useEffect, useState } from 'react';
import { useOverview } from '../api/queries';
import { LABELS, STATES } from '../lib/constants';
import type { TaskFilters } from '../types';

export function FilterBar({ filters, onChange }: { filters: TaskFilters; onChange: (next: TaskFilters) => void }) {
  const { data } = useOverview();
  const [search, setSearch] = useState(filters.q);

  useEffect(() => setSearch(filters.q), [filters.q]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (search.trim() !== filters.q) onChange({ ...filters, q: search.trim() });
    }, 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function toggleState(state: (typeof STATES)[number]) {
    const states = new Set(filters.states);
    states.has(state) ? states.delete(state) : states.add(state);
    onChange({ ...filters, states });
  }

  return (
    <section className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1.5">
        {STATES.map((state) => {
          const active = filters.states.has(state);
          return (
            <button
              key={state}
              type="button"
              aria-pressed={active}
              onClick={() => toggleState(state)}
              className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
                active
                  ? 'border-accent/35 bg-accent-soft font-medium text-accent'
                  : 'border-border bg-panel text-muted hover:text-text'
              }`}
            >
              {LABELS[state]}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <select
          value={filters.repo}
          onChange={(e) => onChange({ ...filters, repo: e.target.value })}
          className="min-w-[190px] rounded-lg border border-border bg-panel px-2.5 py-1.5 text-[13px] text-text focus:outline-2 focus:outline-accent/45"
        >
          <option value="">All repositories</option>
          {data?.repos.map((repo) => (
            <option key={repo.full_name} value={repo.full_name}>
              {repo.full_name}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by number or title…"
          spellCheck={false}
          className="min-w-[190px] rounded-lg border border-border bg-panel px-2.5 py-1.5 text-[13px] text-text focus:outline-2 focus:outline-accent/45"
        />
      </div>
    </section>
  );
}
