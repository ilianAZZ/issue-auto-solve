import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoSettings } from '../config/schema.js';
import type { Logger } from '../util/log.js';
import { redactStream } from '../util/redact.js';

export interface RunRequest {
  runId: number;
  image: string;
  settings: RepoSettings;
  workspacePath: string;
  hostWorkspacePath: string;
  controlPath: string;
  hostControlPath: string;
  logPath: string;
  prompt: string;
  env: Record<string, string>;
  timeoutMinutes: number;
  secrets: string[];
  /** Claude Code session id this task's runs share. Omit to run a stateless one-off (e.g. bootstrap). */
  sessionId?: string;
  /** Host path bind-mounted to `/session`, persisting the session across the container's `--rm` lifecycle. */
  hostSessionPath?: string;
}

export interface RunResult {
  status: 'succeeded' | 'failed' | 'timeout';
  exitCode: number | null;
}

export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

function entrypoint(settings: RepoSettings, sessionId?: string): string {
  const lines = ['#!/bin/sh', 'set -eu', 'cd /workspace', ''];
  for (const command of settings.runtime.setup) lines.push(command);
  if (settings.preflight.length) {
    lines.push('', '{');
    for (const command of settings.preflight) lines.push(`  echo "+ ${command}"`, `  ${command}`);
    lines.push('} 2>&1 | tee /control/preflight.log', '');
  }
  lines.push(
    '',
    '# claude refuses --dangerously-skip-permissions as root, so hand off to a',
    "# non-root user first, reusing the image's \"node\" user when present.",
    'if id -u node >/dev/null 2>&1; then',
    '  run_user=node',
    'else',
    '  getent group agent >/dev/null 2>&1 || groupadd agent 2>/dev/null || addgroup agent',
    '  id -u agent >/dev/null 2>&1 || useradd -g agent -m -s /bin/sh agent 2>/dev/null || adduser -D -G agent -s /bin/sh agent',
    '  run_user=agent',
    'fi',
    'chown -R "$run_user" /workspace',
  );
  if (sessionId) lines.push('chown -R "$run_user" /session');
  lines.push('su -s /bin/sh "$run_user" -c \'', '  git config --global --add safe.directory /workspace');
  if (sessionId) {
    // A fresh task has no transcript yet, so a plain --resume would fail; --session-id starts
    // one under that id instead. Once it exists, --resume continues the same conversation.
    lines.push(
      `  SESSION_ID=${sessionId}`,
      '  RESUME_FLAG="--session-id $SESSION_ID"',
      '  if find /session/projects -name "$SESSION_ID.jsonl" 2>/dev/null | grep -q .; then',
      '    RESUME_FLAG="--resume $SESSION_ID"',
      '  fi',
    );
  }
  lines.push('  claude -p "$(cat /control/prompt.md)" \\', '    --dangerously-skip-permissions \\');
  lines.push(sessionId ? '    --output-format stream-json --verbose \\' : '    --output-format stream-json --verbose');
  if (sessionId) lines.push('    $RESUME_FLAG');
  lines.push("'");
  return `${lines.join('\n')}\n`;
}

export function writeControlFiles(request: RunRequest): void {
  mkdirSync(request.controlPath, { recursive: true });
  writeFileSync(join(request.controlPath, 'prompt.md'), request.prompt);
  writeFileSync(join(request.controlPath, 'run.sh'), entrypoint(request.settings, request.sessionId), { mode: 0o755 });
}

export function dockerArgs(request: RunRequest): string[] {
  const args = [
    'run',
    '--rm',
    '--name',
    `issue-auto-solve-run-${request.runId}`,
    '-v',
    `${request.hostWorkspacePath}:/workspace`,
    '-v',
    `${request.hostControlPath}:/control`,
    '-w',
    '/workspace',
  ];
  if (request.settings.runtime.docker_socket) {
    args.push('-v', '/var/run/docker.sock:/var/run/docker.sock');
    args.push('--add-host', 'host.docker.internal:host-gateway');
    args.push('-e', 'TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal');
  }
  if (request.hostSessionPath) {
    args.push('-v', `${request.hostSessionPath}:/session`, '-e', 'CLAUDE_CONFIG_DIR=/session');
  }
  for (const [key, value] of Object.entries(request.env)) args.push('-e', `${key}=${value}`);
  args.push(request.image, 'sh', '/control/run.sh');
  return args;
}

export function shellPreview(request: RunRequest): string {
  return ['docker', ...dockerArgs(request).map((a) => (/[^\w@%+=:,./-]/.test(a) ? shellQuote(a) : a))].join(' ');
}

export async function runContainer(request: RunRequest, log: Logger): Promise<RunResult> {
  writeControlFiles(request);
  const output = createWriteStream(request.logPath, { flags: 'a' });
  output.write(`$ ${shellPreview({ ...request, env: maskEnv(request.env) })}\n\n`);

  const child = spawn('docker', dockerArgs(request), { stdio: ['ignore', 'pipe', 'pipe'] });
  const scrubbed = redactStream(request.secrets);
  scrubbed.pipe(output, { end: false });
  child.stdout.pipe(scrubbed, { end: false });
  child.stderr.pipe(scrubbed, { end: false });

  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      log.warn(`run ${request.runId} exceeded ${request.timeoutMinutes}m, stopping container`);
      spawn('docker', ['kill', `issue-auto-solve-run-${request.runId}`], { stdio: 'ignore' });
    },
    request.timeoutMinutes * 60_000,
  );

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('error', (error) => {
      output.write(`\nissue-auto-solve: failed to start docker: ${error.message}\n`);
      resolve(null);
    });
    child.on('close', (code) => resolve(code));
  });

  clearTimeout(timer);
  scrubbed.end();
  output.end();
  if (timedOut) return { status: 'timeout', exitCode };
  return { status: exitCode === 0 ? 'succeeded' : 'failed', exitCode };
}

function maskEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(env).map((key) => [key, '***']));
}
