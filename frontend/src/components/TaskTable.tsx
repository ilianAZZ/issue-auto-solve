import { useTasks } from '../api/queries';
import { ago } from '../lib/format';
import { Pill } from './Pill';
import type { TaskFilters } from '../types';

export function TaskTable({ filters, onOpenTask }: { filters: TaskFilters; onOpenTask: (id: number) => void }) {
  const { data: tasks } = useTasks(filters);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-panel shadow-[0_1px_2px_rgba(16,16,24,.06),0_8px_24px_rgba(16,16,24,.06)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr>
              <th className="w-[100px] border-b border-border bg-panel-2 px-3 py-2.5 text-left text-[11.5px] font-semibold tracking-wide text-muted uppercase sm:w-[130px] sm:px-4">
                State
              </th>
              <th className="w-[64px] border-b border-border bg-panel-2 px-3 py-2.5 text-left text-[11.5px] font-semibold tracking-wide text-muted uppercase sm:w-[84px] sm:px-4">
                Issue
              </th>
              <th className="border-b border-border bg-panel-2 px-3 py-2.5 text-left text-[11.5px] font-semibold tracking-wide text-muted uppercase sm:px-4">
                Title
              </th>
              <th className="w-[170px] border-b border-border bg-panel-2 px-4 py-2.5 text-left text-[11.5px] font-semibold tracking-wide text-muted uppercase max-[720px]:hidden">
                Repository
              </th>
              <th className="w-[170px] border-b border-border bg-panel-2 px-4 py-2.5 text-left text-[11.5px] font-semibold tracking-wide text-muted uppercase max-[720px]:hidden">
                For
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks?.map((task) => (
              <tr
                key={task.id}
                onClick={() => onOpenTask(task.id)}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-panel-2"
              >
                <td className="px-3 py-3 align-middle sm:px-4">
                  <Pill state={task.state} />
                </td>
                <td className="px-3 py-3 align-middle font-[tabular-nums] text-muted sm:px-4">#{task.number}</td>
                <td className="px-3 py-3 align-middle font-medium sm:px-4">
                  {task.title}
                  {task.reason && <small className="block font-normal text-muted">{task.reason.slice(0, 120)}</small>}
                </td>
                <td className="px-4 py-3 align-middle whitespace-nowrap text-muted max-[720px]:hidden">{task.repo}</td>
                <td className="px-4 py-3 align-middle whitespace-nowrap text-muted max-[720px]:hidden">
                  {ago(task.entered_state_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tasks && tasks.length === 0 && (
        <p className="p-10 text-center text-muted">Nothing here yet. issue-auto-solve picks up issues on its next tick.</p>
      )}
    </section>
  );
}
