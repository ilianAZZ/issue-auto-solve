import { useMemo, useRef, useState } from 'react';
import { parseRunLog, type LogEntry } from '../lib/runLog';

type Tab = 'pretty' | 'raw';

export function RunLogView({ log, hasRun, failed }: { log: string | undefined; hasRun: boolean; failed: boolean }) {
  const [tab, setTab] = useState<Tab>('pretty');
  const scrollRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => (log ? parseRunLog(log) : []), [log]);

  function scrollToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="m-0 text-[11.5px] font-semibold tracking-wide text-muted uppercase">Last run</h3>
        {hasRun && log != null && (
          <div className="flex gap-0.5 rounded-lg border border-border bg-panel-2 p-0.5">
            {(['pretty', 'raw'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={tab === option}
                onClick={() => setTab(option)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] capitalize transition-colors ${
                  tab === option ? 'bg-panel font-medium text-text shadow-sm' : 'text-muted hover:text-text'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <div
          ref={scrollRef}
          className="max-h-[46vh] overflow-auto overscroll-contain rounded-[10px] border border-border bg-panel-2 p-3.5 font-mono text-xs leading-relaxed text-muted"
        >
          {!hasRun ? (
            'No run yet.'
          ) : failed ? (
            'Log not available.'
          ) : log == null ? (
            'Loading…'
          ) : tab === 'raw' ? (
            <pre className="m-0 break-words whitespace-pre-wrap">{log}</pre>
          ) : (
            <PrettyLog entries={entries} />
          )}
        </div>
        {hasRun && !failed && log != null && (
          <button
            type="button"
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
            onClick={scrollToBottom}
            className="absolute right-2.5 bottom-2.5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-panel text-muted shadow-[0_1px_4px_rgba(16,16,24,.12)] hover:text-accent"
          >
            ↓
          </button>
        )}
      </div>
    </div>
  );
}

function PrettyLog({ entries }: { entries: LogEntry[] }) {
  if (!entries.length) return <>No output yet.</>;
  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => (
        <LogEntryRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function LogEntryRow({ entry }: { entry: LogEntry }) {
  switch (entry.kind) {
    case 'text':
      return <p className="m-0 whitespace-pre-wrap text-text">{entry.text}</p>;
    case 'thinking':
      return (
        <p className="m-0 whitespace-pre-wrap text-muted italic">
          <span className="mr-1 font-semibold not-italic">Thinking —</span>
          {entry.text}
        </p>
      );
    case 'tool_use':
      return (
        <div className="rounded-md border border-blue-soft bg-blue-soft/50 px-2.5 py-1.5">
          <div className="font-semibold text-blue">→ {entry.name}</div>
          {entry.input !== undefined && entry.input !== null && (
            <pre className="m-0 mt-1 overflow-auto break-words whitespace-pre-wrap text-muted">{formatToolInput(entry.input)}</pre>
          )}
        </div>
      );
    case 'tool_result':
      return (
        <pre
          className={`m-0 overflow-auto rounded-md border px-2.5 py-1.5 break-words whitespace-pre-wrap ${
            entry.isError ? 'border-red-soft bg-red-soft/50 text-red' : 'border-border bg-panel text-muted'
          }`}
        >
          {entry.text || '(empty result)'}
        </pre>
      );
    case 'result':
      return <p className={`m-0 font-semibold ${entry.isError ? 'text-red' : 'text-green'}`}>{entry.text}</p>;
    case 'alert':
      return <p className="m-0 rounded-md border border-red-soft bg-red-soft/50 px-2.5 py-1.5 text-red">{entry.text}</p>;
    case 'command':
      return <p className="m-0 text-muted">$ {entry.text}</p>;
    case 'info':
      return <p className="m-0 text-muted">{entry.text}</p>;
  }
}

function formatToolInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
