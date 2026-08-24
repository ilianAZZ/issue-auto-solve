import { useEffect } from 'react';
import { useRunLog, useTask, useTaskAction } from '../api/queries';
import { ago, cost, duration, tokens } from '../lib/format';
import { Pill } from './Pill';
import { Button, LinkButton } from './ui/Button';

export function TaskDrawer({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const { data } = useTask(taskId);
  const run = data?.runs[0];
  const { data: log, isError: logFailed } = useRunLog(run?.id ?? null);
  const action = useTaskAction();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function act(kind: 'requeue' | 'restart' | 'skip') {
    action.mutate({ id: taskId, action: kind }, { onSuccess: onClose });
  }

  function forceRun() {
    action.mutate({ id: taskId, action: 'force' });
  }

  const active = data?.task.state === 'claimed' || data?.task.state === 'running';
  const failed = data?.task.state === 'failed';

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="animate-[slide-in_0.16s_ease-out] fixed top-0 right-0 bottom-0 z-50 flex w-[min(680px,92vw)] flex-col border-l border-border bg-panel shadow-[0_1px_2px_rgba(16,16,24,.06),0_8px_24px_rgba(16,16,24,.06)]">
        <div className="flex items-start justify-between gap-4 px-5 pt-4.5 pb-3">
          <div>
            <div className="text-[16px] font-semibold tracking-tight">
              {data ? `#${data.task.number} ${data.task.title}` : '–'}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
              {data ? (
                <>
                  <Pill state={data.task.state} />
                  <span className="opacity-40">·</span>
                  <span>{data.task.repo}</span>
                  <span className="opacity-40">·</span>
                  <span>{data.task.branch ?? 'no branch'}</span>
                  <span className="opacity-40">·</span>
                  <span>{ago(data.task.entered_state_at)} in this state</span>
                </>
              ) : (
                '–'
              )}
            </div>
          </div>
          <Button variant="ghost" aria-label="Close" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-border px-5 pb-3.5">
          {data && (
            <>
              <LinkButton href={data.task.url} target="_blank" rel="noreferrer">
                Open issue
              </LinkButton>
              {data.task.pr_url && (
                <LinkButton href={data.task.pr_url} target="_blank" rel="noreferrer">
                  Pull request
                </LinkButton>
              )}
              <Button variant="primary" onClick={forceRun} disabled={action.isPending || active}>
                Force run
              </Button>
              {failed ? (
                <>
                  <Button
                    onClick={() => act('requeue')}
                    disabled={action.isPending}
                    title="Resume the same Claude conversation where it left off"
                  >
                    Continue
                  </Button>
                  <Button
                    onClick={() => act('restart')}
                    disabled={action.isPending}
                    title="Discard the conversation so far and start a brand-new one"
                  >
                    Restart
                  </Button>
                </>
              ) : (
                <Button onClick={() => act('requeue')} disabled={action.isPending}>
                  Requeue
                </Button>
              )}
              <Button onClick={() => act('skip')} disabled={action.isPending}>
                Skip
              </Button>
            </>
          )}
        </div>
        <div className="overflow-auto px-5 pt-4 pb-7">
          <h3 className="mt-0 mb-2 text-[11.5px] font-semibold tracking-wide text-muted uppercase">Timeline</h3>
          <ol className="m-0 border-l border-border p-0 pl-3.5">
            {data?.events.map((event) => (
              <li key={event.id} className="relative pb-3 pl-3.5 text-[13px] before:absolute before:top-1.5 before:-left-[19px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-border">
                <time className="block font-[tabular-nums] text-[11.5px] text-muted">
                  {new Date(event.created_at).toLocaleString()}
                </time>
                {event.message}
              </li>
            ))}
          </ol>
          {data && data.task.usage.run_count > 0 && (
            <>
              <h3 className="mt-4.5 mb-2 text-[11.5px] font-semibold tracking-wide text-muted uppercase">Claude usage</h3>
              <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
                <span>
                  <strong className="text-text font-semibold">{cost(data.task.usage.cost_usd)}</strong> total
                </span>
                <span>{tokens(data.task.usage.input_tokens + data.task.usage.output_tokens)} tokens</span>
                <span>{duration(data.task.usage.duration_ms)} compute time</span>
                <span>
                  {data.task.usage.run_count} run{data.task.usage.run_count === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="m-0 mb-2 list-none p-0 text-[12.5px] text-muted">
                {data.runs
                  .filter((r) => r.cost_usd != null)
                  .map((r) => (
                    <li key={r.id} className="flex justify-between border-b border-border py-1 last:border-0">
                      <span>{new Date(r.started_at).toLocaleString()}</span>
                      <span>
                        {cost(r.cost_usd ?? 0)} · {tokens((r.input_tokens ?? 0) + (r.output_tokens ?? 0))} tok
                        {r.duration_ms != null ? ` · ${duration(r.duration_ms)}` : ''}
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          )}
          <h3 className="mt-4.5 mb-2 text-[11.5px] font-semibold tracking-wide text-muted uppercase">Last run</h3>
          <pre className="max-h-[46vh] overflow-auto rounded-[10px] border border-border bg-panel-2 p-3.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-muted">
            {run ? (logFailed ? 'Log not available.' : (log ?? 'Loading…')) : 'No run yet.'}
          </pre>
        </div>
      </aside>
    </>
  );
}
