import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from '../config/index.js';
import type { Store, TaskRow } from '../db/store.js';
import type { Orchestrator } from '../core/orchestrator.js';
import { TASK_STATES } from '../core/states.js';
import { logger } from '../util/log.js';
import { interpret, verifySignature } from './webhook.js';

const log = logger('server');
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');

const decorate = (store: Store) => (task: TaskRow) => {
  const repo = store.repos().find((r) => r.id === task.repo_id);
  return {
    ...task,
    labels: JSON.parse(task.labels_json) as string[],
    repo: repo?.full_name ?? 'unknown',
    last_run: store.runsFor(task.id, 1)[0] ?? null,
  };
};

export async function createServer(env: Env, store: Store, orchestrator: Orchestrator) {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
  const view = decorate(store);

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, { raw: body as string, parsed: JSON.parse(body as string) });
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  await app.register(fastifyStatic, { root: webRoot, prefix: '/' });

  app.get('/api/overview', async () => {
    const tasks = TASK_STATES.flatMap((state) => store.byState(state));
    const counts = Object.fromEntries(TASK_STATES.map((state) => [state, store.byState(state).length]));
    return {
      status: !orchestrator.dispatching ? 'paused' : orchestrator.busy > 0 ? 'working' : 'idle',
      dispatching: orchestrator.dispatching,
      busy: orchestrator.busy,
      capacity: orchestrator.capacity,
      last_tick_at: store.meta('last_tick_at'),
      counts,
      repos: store.repos().map((repo) => ({
        full_name: repo.full_name,
        enabled: Boolean(repo.enabled),
        last_sync_at: repo.last_sync_at,
        last_error: repo.last_error,
        active: store.countActive(repo.id),
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
    if (action === 'requeue') store.transition(task.id, 'discovered', {}, 'requeued from the dashboard');
    else if (action === 'skip') store.transition(task.id, 'skipped', { reason: 'skipped from the dashboard' });
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
    const body = request.body as { raw: string; parsed: Record<string, unknown> };
    if (env.GITHUB_WEBHOOK_SECRET) {
      const signature = request.headers['x-hub-signature-256'] as string | undefined;
      if (!verifySignature(env.GITHUB_WEBHOOK_SECRET, body.raw, signature)) {
        return reply.code(401).send({ error: 'bad signature' });
      }
    }
    const event = request.headers['x-github-event'] as string;
    const hint = interpret(event, body.parsed);
    if (hint) {
      log.info(`webhook ${hint.kind} on ${hint.repo}${hint.number ? `#${hint.number}` : ''}`);
      void orchestrator.tick();
    }
    return { ok: true };
  });

  app.get('/api/health', async () => ({ ok: true, last_tick_at: store.meta('last_tick_at') }));

  return app;
}
