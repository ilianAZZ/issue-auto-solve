import { useState } from 'react';
import { Button } from './ui/Button';

export function BootstrapModal({
  repo,
  onCancel,
  onConfirm,
}: {
  repo: string;
  onCancel: () => void;
  onConfirm: (instructions: string) => void;
}) {
  const [instructions, setInstructions] = useState('');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-panel p-5 shadow-[0_1px_2px_rgba(16,16,24,.06),0_8px_24px_rgba(16,16,24,.06)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mt-0 mb-1.5 text-[15px] font-semibold">Generate config for {repo}</h2>
        <p className="mt-0 mb-3 text-[13px] text-muted">
          Anything the agent should know? For example: "pull requests target dev", "tests need a Docker daemon",
          "never touch anything labelled legal".
        </p>
        <textarea
          autoFocus
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          className="mb-3 w-full resize-y rounded-lg border border-border bg-panel-2 p-2.5 text-[13px] text-text focus:outline-2 focus:outline-accent/45"
        />
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onConfirm(instructions)}>
            Generate
          </Button>
        </div>
      </div>
    </div>
  );
}
