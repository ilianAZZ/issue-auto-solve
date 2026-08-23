import { useDispatchAction, useOverview } from '../api/queries';
import { ago } from '../lib/format';
import { Button } from './ui/Button';

const DOT_CLASSES: Record<string, string> = {
  idle: 'bg-green',
  working: 'bg-accent shadow-[0_0_0_0_var(--color-accent)] animate-ping-once',
  paused: 'bg-amber',
  stale: 'bg-red',
  connecting: 'bg-muted',
};

export function Header({ onOpenSetup }: { onOpenSetup: () => void }) {
  const { data } = useOverview();
  const dispatchAction = useDispatchAction();

  const stale = Boolean(data?.last_tick_at && Date.now() - new Date(data.last_tick_at).getTime() > 15 * 60_000);
  const dotState = !data ? 'connecting' : data.status === 'paused' ? 'paused' : stale ? 'stale' : data.status;
  const statusText = !data ? 'connecting' : stale ? 'no tick in 15m' : data.status;
  const capacityText = data ? `${data.busy}/${data.capacity} slot${data.capacity > 1 ? 's' : ''} busy` : '–';
  const tickText = data ? `last tick ${ago(data.last_tick_at)} ago` : '–';

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border bg-bg/90 px-6 py-3.5 backdrop-blur-md backdrop-saturate-150">
      <div className="flex items-center gap-2.5 font-semibold tracking-tight">
        <span className="text-lg">🔁</span>
        <span>issue-auto-solve</span>
      </div>
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <span className={`h-2 w-2 rounded-full ${DOT_CLASSES[dotState] ?? 'bg-muted'}`} />
        <span>{statusText}</span>
        <span className="opacity-40">·</span>
        <span>{capacityText}</span>
        <span className="opacity-40">·</span>
        <span>{tickText}</span>
        <Button
          onClick={() => dispatchAction.mutate(data?.dispatching ? 'pause' : 'resume')}
          disabled={!data || dispatchAction.isPending}
        >
          {data?.dispatching ? '⏸ Pause' : '▶ Resume'}
        </Button>
        <Button onClick={onOpenSetup}>Setup</Button>
      </div>
    </header>
  );
}
