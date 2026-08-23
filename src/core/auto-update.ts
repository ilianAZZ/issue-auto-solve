import { spawn } from 'node:child_process';
import type { Store } from '../db/store.js';
import { shellQuote } from '../runner/docker.js';
import { logger } from '../util/log.js';
import { now } from '../util/time.js';

const log = logger('auto-update');

interface PortBinding {
  HostIp?: string;
  HostPort?: string;
}

interface SelfInspect {
  Name: string;
  Config: { Env?: string[] };
  HostConfig: {
    Binds?: string[];
    PortBindings?: Record<string, PortBinding[] | null>;
    RestartPolicy?: { Name?: string; MaximumRetryCount?: number };
    NetworkMode?: string;
  };
}

interface DockerResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Promise<DockerResult> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => resolve({ code: null, stdout, stderr: String(error) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function inspectField(target: string, format: string): Promise<string | null> {
  const result = await run(['inspect', '--format', format, target]);
  return result.code === 0 ? result.stdout.trim() : null;
}

/**
 * Reproduces the flags the running container was created with, so the replacement keeps
 * the same volumes, ports, restart policy and environment. PATH is dropped so the new
 * image's own PATH wins rather than the old one's.
 */
export function buildRunArgs(inspect: SelfInspect, image: string, name: string): string[] {
  const args = ['run', '-d', '--name', name];

  const restart = inspect.HostConfig.RestartPolicy;
  if (restart?.Name && restart.Name !== 'no') {
    args.push('--restart', restart.Name === 'on-failure' && restart.MaximumRetryCount ? `on-failure:${restart.MaximumRetryCount}` : restart.Name);
  }
  if (inspect.HostConfig.NetworkMode && !['default', 'bridge'].includes(inspect.HostConfig.NetworkMode)) {
    args.push('--network', inspect.HostConfig.NetworkMode);
  }
  for (const bind of inspect.HostConfig.Binds ?? []) args.push('-v', bind);
  for (const [portProto, bindings] of Object.entries(inspect.HostConfig.PortBindings ?? {})) {
    for (const binding of bindings ?? []) {
      const host = binding.HostIp ? `${binding.HostIp}:${binding.HostPort}` : (binding.HostPort ?? '');
      args.push('-p', `${host}:${portProto}`);
    }
  }
  for (const env of inspect.Config.Env ?? []) {
    if (env.startsWith('PATH=')) continue;
    args.push('-e', env);
  }
  args.push(image);
  return args;
}

export interface AutoUpdateStatus {
  enabled: boolean;
  checking: boolean;
  last_checked_at: string | null;
  update_available: boolean;
  current_image: string | null;
  last_error: string | null;
}

/**
 * Self-update for the orchestrator's own container. A container cannot recreate itself in
 * place — stopping it to free the name/port kills the process doing the work — so the swap
 * is handed off to a short-lived sibling container (same trick Watchtower uses): it stops
 * and removes the old container, then starts a new one from the freshly pulled image with
 * the same run configuration. The existing SIGTERM handler in index.ts shuts this process
 * down cleanly when that "docker stop" lands.
 */
export class AutoUpdater {
  private enabled: boolean;
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  private lastCheckedAt: string | null = null;
  private updateAvailable = false;
  private currentImage: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly store: Store,
    private readonly checkIntervalHours: number,
    private readonly isBusy: () => boolean,
    configDefaultEnabled: boolean,
  ) {
    const stored = store.meta('auto_update_enabled');
    this.enabled = stored === null ? configDefaultEnabled : stored === '1';
  }

  status(): AutoUpdateStatus {
    return {
      enabled: this.enabled,
      checking: this.checking,
      last_checked_at: this.lastCheckedAt,
      update_available: this.updateAvailable,
      current_image: this.currentImage,
      last_error: this.lastError,
    };
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.store.setMeta('auto_update_enabled', on ? '1' : '0');
    if (on) void this.check();
  }

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), this.checkIntervalHours * 3_600_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      if (!this.enabled) return;
      const containerId = process.env.HOSTNAME;
      if (!containerId) {
        this.lastError = 'cannot determine the running container id (HOSTNAME is unset)';
        log.warn(this.lastError);
        return;
      }

      const image = await inspectField(containerId, '{{.Config.Image}}');
      const currentImageId = await inspectField(containerId, '{{.Image}}');
      if (!image || !currentImageId) {
        this.lastError = `cannot inspect container ${containerId} — is /var/run/docker.sock mounted?`;
        log.warn(this.lastError);
        return;
      }
      this.currentImage = image;

      const pull = await run(['pull', image]);
      if (pull.code !== 0) {
        this.lastError = `docker pull ${image} failed: ${pull.stderr.trim().slice(0, 300)}`;
        log.warn(this.lastError);
        return;
      }

      const latestImageId = await inspectField(image, '{{.Id}}');
      this.lastError = null;
      this.lastCheckedAt = now();
      this.updateAvailable = Boolean(latestImageId) && latestImageId !== currentImageId;
      if (!this.updateAvailable) return;

      log.info(`new image available for ${image}`);
      if (this.isBusy()) {
        log.info('a run is in flight, deferring the update to the next check');
        return;
      }
      await this.perform(containerId, image);
    } finally {
      this.checking = false;
    }
  }

  private async perform(containerId: string, image: string): Promise<void> {
    const raw = await run(['inspect', containerId]);
    if (raw.code !== 0) {
      this.lastError = `could not inspect ${containerId} before updating: ${raw.stderr.trim().slice(0, 300)}`;
      log.error(this.lastError);
      return;
    }
    let inspect: SelfInspect | undefined;
    try {
      inspect = (JSON.parse(raw.stdout) as SelfInspect[])[0];
    } catch {
      // fall through to the "no inspect" error below
    }
    if (!inspect) {
      this.lastError = 'could not parse docker inspect output';
      log.error(this.lastError);
      return;
    }
    const name = (inspect.Name ?? '').replace(/^\//, '');
    if (!name) {
      this.lastError = 'container has no name, refusing to update';
      log.error(this.lastError);
      return;
    }

    const runArgs = buildRunArgs(inspect, image, name);
    const script = [
      'set -e',
      `docker stop ${shellQuote(containerId)}`,
      `docker rm ${shellQuote(containerId)}`,
      `docker ${runArgs.map(shellQuote).join(' ')}`,
    ].join('\n');

    log.info(`starting the update helper for ${name}`);
    const helper = await run([
      'run',
      '-d',
      '--rm',
      '--name',
      `${name}-updater-${Date.now()}`,
      '-v',
      '/var/run/docker.sock:/var/run/docker.sock',
      image,
      'sh',
      '-c',
      script,
    ]);
    if (helper.code !== 0) {
      this.lastError = `could not start the update helper: ${helper.stderr.trim().slice(0, 300)}`;
      log.error(this.lastError);
      return;
    }
    log.info(`update helper started, ${name} will restart on the new image shortly`);
  }
}
