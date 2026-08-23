import { Button } from './ui/Button';

export function ClaudeTokenAlert({ onOpenSetup }: { onOpenSetup: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-3 border-b border-amber/30 bg-amber-soft px-4 py-2.5 text-center text-[13px] text-amber"
    >
      <span>Claude Code's token was rejected — runs are failing before they even start.</span>
      <Button variant="primary" onClick={onOpenSetup}>
        Fix in Setup
      </Button>
    </div>
  );
}
