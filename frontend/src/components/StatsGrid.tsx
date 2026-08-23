import { useOverview } from '../api/queries';

export function StatsGrid() {
  const { data } = useOverview();
  if (!data) return null;

  const cards = [
    { key: 'Working', n: data.counts.running + data.counts.claimed, alert: false },
    { key: 'Waiting on you', n: data.counts.waiting_human, alert: data.counts.waiting_human > 0 },
    { key: 'Needs approval', n: data.counts.needs_approval, alert: data.counts.needs_approval > 0 },
    { key: 'Queued', n: data.counts.discovered, alert: false },
    { key: 'PRs open', n: data.counts.pr_open, alert: false },
    { key: 'Failed', n: data.counts.failed, alert: false },
    { key: 'Repositories', n: data.repos.filter((r) => r.enabled).length, alert: false },
  ];

  return (
    <section className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
      {cards.map((card) => (
        <div key={card.key} className="rounded-xl border border-border bg-panel px-4 py-3.5">
          <div className={`text-[26px] font-semibold tracking-tight ${card.alert ? 'text-amber' : ''}`}>{card.n}</div>
          <div className="text-xs tracking-wide text-muted uppercase">{card.key}</div>
        </div>
      ))}
    </section>
  );
}
