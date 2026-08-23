import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';

export interface RunUsage {
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

// `claude -p --output-format stream-json` writes one JSON object per line, the last of
// which is `{"type":"result", total_cost_usd, duration_ms, num_turns, usage: {...}}`.
// Stderr and non-JSON lines are interleaved in the log, so this scans backwards for the
// last line that actually parses as a result event instead of assuming a fixed position.
const TAIL_BYTES = 2_000_000;

export function parseRunUsage(logPath: string): RunUsage | null {
  if (!existsSync(logPath)) return null;
  const size = statSync(logPath).size;
  const length = Math.min(size, TAIL_BYTES);
  if (length === 0) return null;
  const buffer = Buffer.alloc(length);
  const fd = openSync(logPath, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }

  const lines = buffer.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim();
    if (!line.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    if (record.type !== 'result') continue;
    const usage = (record.usage ?? {}) as Record<string, unknown>;
    return {
      cost_usd: Number(record.total_cost_usd ?? 0),
      duration_ms: Number(record.duration_ms ?? 0),
      num_turns: Number(record.num_turns ?? 0),
      input_tokens: Number(usage.input_tokens ?? 0),
      output_tokens: Number(usage.output_tokens ?? 0),
      cache_creation_input_tokens: Number(usage.cache_creation_input_tokens ?? 0),
      cache_read_input_tokens: Number(usage.cache_read_input_tokens ?? 0),
    };
  }
  return null;
}
