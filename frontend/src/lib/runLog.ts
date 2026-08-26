// Parses a run log into structured entries for the "pretty" view. The log is whatever
// `claude -p --output-format stream-json --verbose` wrote to stdout/stderr, prefixed by
// the docker command line we ran it with (see runContainer in src/runner/docker.ts) —
// so most lines are JSON, but not all of them.
type LogEntryData =
  | { kind: 'command'; text: string }
  | { kind: 'info'; text: string }
  | { kind: 'alert'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; name: string; input: unknown }
  | { kind: 'tool_result'; text: string; isError: boolean }
  | { kind: 'result'; text: string; isError: boolean };

export type LogEntry = LogEntryData & { id: number };

const ERROR_HINT = /\b(error|exception|failed|fatal|traceback)\b/i;

export function parseRunLog(raw: string): LogEntry[] {
  const entries: LogEntry[] = [];
  let nextId = 0;
  const push = (entry: LogEntryData) => entries.push({ ...entry, id: nextId++ });

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('$ ')) {
      push({ kind: 'command', text: line.slice(2) });
      continue;
    }
    if (line.startsWith('{')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        parsed = undefined;
      }
      if (parsed && typeof parsed === 'object') {
        pushEvent(push, parsed as Record<string, unknown>);
        continue;
      }
    }
    push({ kind: ERROR_HINT.test(line) ? 'alert' : 'info', text: line });
  }
  return entries;
}

function pushEvent(push: (entry: LogEntryData) => void, record: Record<string, unknown>): void {
  const type = record.type;
  if (type === 'system') {
    const model = typeof record.model === 'string' ? ` · ${record.model}` : '';
    push({ kind: 'info', text: `session ${String(record.subtype ?? 'started')}${model}` });
    return;
  }
  if (type === 'assistant' || type === 'user') {
    const message = record.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const block of content) {
      if (block && typeof block === 'object') pushBlock(push, block as Record<string, unknown>);
    }
    return;
  }
  if (type === 'result') {
    const text = typeof record.result === 'string' && record.result ? record.result : 'Run finished.';
    push({ kind: 'result', text, isError: Boolean(record.is_error) || record.subtype !== 'success' });
    return;
  }
  push({ kind: 'info', text: JSON.stringify(record) });
}

function pushBlock(push: (entry: LogEntryData) => void, block: Record<string, unknown>): void {
  const type = block.type;
  if (type === 'text') {
    push({ kind: 'text', text: String(block.text ?? '') });
  } else if (type === 'thinking') {
    push({ kind: 'thinking', text: String(block.thinking ?? '') });
  } else if (type === 'tool_use') {
    push({ kind: 'tool_use', name: String(block.name ?? 'tool'), input: block.input });
  } else if (type === 'tool_result') {
    push({ kind: 'tool_result', text: toolResultText(block.content), isError: Boolean(block.is_error) });
  }
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}
