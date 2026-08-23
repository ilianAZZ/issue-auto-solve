import { useOverview } from '../api/queries';
import { cost, tokens } from '../lib/format';

export function UsageByRepo() {
  const { data } = useOverview();
  if (!data || data.usage.run_count === 0) return null;

  const rows = data.repos
    .filter((repo) => (repo.usage?.run_count ?? 0) > 0)
    .sort((a, b) => (b.usage?.cost_usd ?? 0) - (a.usage?.cost_usd ?? 0));
  if (rows.length === 0) return null;

  const totalCost = data.usage.cost_usd;

  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-border bg-panel">
      <h3 className="border-b border-border bg-panel-2 px-4 py-2.5 text-[11.5px] font-semibold tracking-wide text-muted uppercase">
        Claude usage by repository
      </h3>
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((repo) => {
            const usage = repo.usage!;
            const pct = totalCost > 0 ? (usage.cost_usd / totalCost) * 100 : 0;
            return (
              <tr key={repo.full_name} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 align-middle whitespace-nowrap">{repo.full_name}</td>
                <td className="w-full px-4 py-2.5 align-middle">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right align-middle font-[tabular-nums] text-muted whitespace-nowrap">
                  {pct.toFixed(0)}%
                </td>
                <td className="px-4 py-2.5 text-right align-middle font-[tabular-nums] whitespace-nowrap">{cost(usage.cost_usd)}</td>
                <td className="px-4 py-2.5 text-right align-middle font-[tabular-nums] text-muted whitespace-nowrap">
                  {tokens(usage.input_tokens + usage.output_tokens)} tok
                </td>
                <td className="px-4 py-2.5 text-right align-middle font-[tabular-nums] text-muted whitespace-nowrap">
                  {usage.run_count} run{usage.run_count === 1 ? '' : 's'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
