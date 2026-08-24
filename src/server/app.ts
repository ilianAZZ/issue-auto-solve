import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from '../config/index.js';
import type { Store, TaskRow } from '../db/store.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type { AutoUpdater } from '../core/auto-update.js';
import { TASK_STATES } from '../core/states.js';
import { logger } from '../util/log.js';
import { appVersion } from '../util/version.js';
import { interpret, verifySignature } from './webhook.js';
import { registerSetup } from './setup.js';
import { registerAuth } from './auth.js';
import type { Credentials } from '../core/credentials.js';

const log = logger('server');
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'dist');

const decorate = (store: Store) => (task: TaskRow) => {
  const repo = store.repos().find((r) => r.id === task.repo_id);
  return {
    ...task,
    labels: JSON.parse(task.labels_json) as string[],
    repo: repo?.full_name ?? 'unknown',
    last_run: store.runsFor(task.id, 1)[0] ?? null,
    usage: store.taskUsage(task.id),
  };
};

export async function createServer(
  env: Env,
  store: Store,
  orchestrator: Orchestrator,
  credentials: Credentials,
  dashboardToken: string,
  autoUpdater: AutoUpdater,
) {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
  const view = decorate(store);

  // The webhook signature is computed over the exact bytes GitHub sent, so the raw body is
  // kept alongside the parsed one instead of replacing it.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    (request as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body === '' ? {} : JSON.parse(body as string));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  // `logger: false` above keeps output on our own format, but it also means an uncaught
  // route error would otherwise only ever reach the browser — never `docker logs`.
  app.setErrorHandler((error: Error, request, reply) => {
    log.error(`${request.method} ${request.url} -> ${error.message}`, { stack: error.stack });
    reply.send(error);
  });

  registerAuth(app, dashboardToken, env.PUBLIC_URL.startsWith('https://'));
  await app.register(fastifyStatic, { root: webRoot, prefix: '/' });
  registerSetup(app, env, store, credentials, orchestrator);

  app.get('/api/overview', async () => {
    const tasks = TASK_STATES.flatMap((state) => store.byState(state));
    const counts = Object.fromEntries(TASK_STATES.map((state) => [state, store.byState(state).length]));
    const usageByRepo = store.usageByRepo();
    return {
      status: !orchestrator.dispatching ? 'paused' : orchestrator.busy > 0 ? 'working' : 'idle',
      version: appVersion(),
      dispatching: orchestrator.dispatching,
      busy: orchestrator.busy,
      capacity: orchestrator.capacity,
      last_tick_at: store.meta('last_tick_at'),
      claude_token_invalid: store.meta('claude_token_invalid') === '1',
      auto_update: autoUpdater.status(),
      counts,
      usage: store.usageSummary(),
      repos: store.repos().map((repo) => ({
        full_name: repo.full_name,
        enabled: Boolean(repo.enabled),
        last_sync_at: repo.last_sync_at,
        last_error: repo.last_error,
        active: store.countActive(repo.id),
        usage: usageByRepo.find((u) => u.repo_id === repo.id) ?? null,
      })),
      running: tasks.filter((t) => t.state === 'running' || t.state === 'claimed').map(view),
    };
  });

  app.get<{ Querystring: { repo?: string; state?: string; q?: string; limit?: string } }>('/api/tasks', async (request) => {
    const { repo, state, q, limit } = request.query;
    const states = state ? state.split(',') : TASK_STATES;
    const rows = states
      .flatMap((s) => (TASK_STATES.includes(s as never) ? store.byState(s as never) : []))
      .map(view)
      .filter((task) => (repo ? task.repo === repo : true))
      .filter((task) => (q ? `${task.number} ${task.title}`.toLowerCase().includes(q.toLowerCase()) : true))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return rows.slice(0, Number(limit ?? 200));
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const task = store.task(Number(request.params.id));
    if (!task) return reply.code(404).send({ error: 'unknown task' });
    return { task: view(task), events: store.eventsFor(task.id), runs: store.runsFor(task.id) };
  });

  app.post<{ Params: { id: string; action: string } }>('/api/tasks/:id/:action', async (request, reply) => {
    const task = store.task(Number(request.params.id));
    if (!task) return reply.code(404).send({ error: 'unknown task' });
    const { action } = request.params;
    if (action === 'force') {
      const result = await orchestrator.forceRun(task.id);
      if (!result.ok) return reply.code(409).send({ error: result.error });
      return { ok: true };
    }
    if (action === 'requeue') store.transition(task.id, 'discovered', {}, 'requeued from the dashboard');
    else if (action === 'restart') {
      orchestrator.resetSession(task.id);
      store.transition(task.id, 'discovered', {}, 'restarted from the dashboard with a new session');
    } else if (action === 'skip') store.transition(task.id, 'skipped', { reason: 'skipped from the dashboard' });
    else return reply.code(400).send({ error: 'unknown action' });
    void orchestrator.tick();
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { tail?: string } }>('/api/runs/:id/log', async (request, reply) => {
    const run = store.run(Number(request.params.id));
    if (!run || !existsSync(run.log_path)) return reply.code(404).send({ error: 'no log' });
    const size = statSync(run.log_path).size;
    const tail = Number(request.query.tail ?? 200_000);
    reply.type('text/plain; charset=utf-8');
    return createReadStream(run.log_path, { start: Math.max(0, size - tail) });
  });

  app.post('/webhooks/github', async (request, reply) => {
    const raw = (request as { rawBody?: string }).rawBody ?? '';
    const secret = credentials.webhookSecret();
    if (secret) {
      const signature = request.headers['x-hub-signature-256'] as string | undefined;
      if (!verifySignature(secret, raw, signature)) {
        return reply.code(401).send({ error: 'bad signature' });
      }
    }
    const event = request.headers['x-github-event'] as string;
    const hint = interpret(event, (request.body ?? {}) as Record<string, unknown>);
    if (hint) {
      log.info(`webhook ${hint.kind} on ${hint.repo}${hint.number ? `#${hint.number}` : ''}`);
      void orchestrator.tick();
    }
    return { ok: true };
  });

  app.post<{ Params: { action: string } }>('/api/dispatch/:action', async (request, reply) => {
    const { action } = request.params;
    if (action === 'pause') orchestrator.pause();
    else if (action === 'resume') orchestrator.resume();
    else return reply.code(400).send({ error: 'unknown action' });
    return { ok: true, dispatching: orchestrator.dispatching };
  });

  app.post<{ Params: { action: string } }>('/api/auto-update/:action', async (request, reply) => {
    const { action } = request.params;
    if (action === 'enable') autoUpdater.setEnabled(true);
    else if (action === 'disable') autoUpdater.setEnabled(false);
    else if (action === 'check') void autoUpdater.check();
    else return reply.code(400).send({ error: 'unknown action' });
    return { ok: true, auto_update: autoUpdater.status() };
  });

  app.get('/api/health', async () => ({ ok: true }));

  return app;
}
