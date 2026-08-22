import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { Octokit } from '@octokit/rest';
import type { Env } from '../config/index.js';
import type { Credentials } from '../core/credentials.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type { Store } from '../db/store.js';
import { logger } from '../util/log.js';

const log = logger('setup');
const pending = new Set<string>();

const reachableByGitHub = (url: string) => !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url);

const manifestFor = (publicUrl: string, name: string) => ({
  name,
  url: publicUrl,
  redirect_url: `${publicUrl}/setup/github/callback`,
  // GitHub cannot reach a tunnelled dashboard, and a webhook that always fails is noise.
  // Polling covers everything it would have delivered.
  hook_attributes: { url: `${publicUrl}/webhooks/github`, active: reachableByGitHub(publicUrl) },
  public: false,
  default_permissions: { issues: 'write', pull_requests: 'write', contents: 'write', metadata: 'read' },
  default_events: ['issues', 'issue_comment', 'pull_request'],
});

export function registerSetup(
  app: FastifyInstance,
  env: Env,
  store: Store,
  credentials: Credentials,
  orchestrator: Orchestrator,
): void {
  app.get('/api/setup/status', async () => {
    const github = credentials.github();
    return {
      github: github ? { mode: github.mode, slug: github.slug ?? null } : null,
      claude: Boolean(credentials.claudeToken()),
      locked: credentials.locked(),
      repositories: store.repos().length,
      public_url: env.PUBLIC_URL,
      complete: Boolean(github) && Boolean(credentials.claudeToken()) && store.repos().length > 0,
    };
  });

  // A browser form is the only way into GitHub's App manifest flow: it creates the App
  // with the right permissions and events, then hands the credentials back once.
  app.get<{ Querystring: { org?: string; name?: string } }>('/setup/github/new', async (request, reply) => {
    const name = request.query.name?.trim() || 'issue-auto-solve';
    const nonce = randomBytes(16).toString('hex');
    pending.add(nonce);
    const action = request.query.org
      ? `https://github.com/organizations/${request.query.org}/settings/apps/new`
      : 'https://github.com/settings/apps/new';
    const manifest = JSON.stringify(manifestFor(env.PUBLIC_URL, name)).replace(/"/g, '&quot;');
    reply.type('text/html');
    return `<!doctype html><meta charset="utf-8"><title>Creating the GitHub App…</title>
<body style="font:14px system-ui;padding:40px">
<p>Sending you to GitHub to create the <b>${name}</b> App…</p>
<form id="f" method="post" action="${action}?state=${nonce}"><input type="hidden" name="manifest" value="${manifest}"></form>
<noscript><button form="f">Continue to GitHub</button></noscript>
<script>document.getElementById('f').submit()</script></body>`;
  });

  app.get<{ Querystring: { code?: string; state?: string } }>('/setup/github/callback', async (request, reply) => {
    const code = request.query.code;
    if (!code) return reply.code(400).send('missing code');
    if (!request.query.state || !pending.delete(request.query.state)) {
      return reply.code(400).send('unknown or already used setup request');
    }
    try {
      const { data } = await new Octokit().request('POST /app-manifests/{code}/conversions', { code });
      credentials.saveGitHubApp({
        appId: String(data.id),
        privateKey: data.pem,
        webhookSecret: data.webhook_secret ?? undefined,
        slug: data.slug,
      });
      orchestrator.reload();
      log.info(`GitHub App ${data.slug} created and stored`);
      return reply.redirect(`https://github.com/apps/${data.slug}/installations/new`);
    } catch (error) {
      log.error('manifest conversion failed', { error: String(error) });
      return reply.code(500).send(`could not convert the manifest: ${String(error)}`);
    }
  });

  app.post<{ Body: { token: string } }>('/api/setup/github/token', async (request, reply) => {
    const token = request.body?.token?.trim();
    if (!token) return reply.code(400).send({ error: 'empty token' });
    try {
      await new Octokit({ auth: token }).users.getAuthenticated();
    } catch {
      return reply.code(400).send({ error: 'GitHub rejected this token' });
    }
    credentials.saveGitHubToken(token);
    orchestrator.reload();
    return { ok: true };
  });

  app.post<{ Body: { token: string } }>('/api/setup/claude', async (request, reply) => {
    const token = request.body?.token?.trim();
    if (!token) return reply.code(400).send({ error: 'empty token' });
    credentials.saveClaudeToken(token);
    return { ok: true };
  });

  app.get('/api/repos', async () =>
    store.repos().map((repo) => ({
      full_name: repo.full_name,
      enabled: Boolean(repo.enabled),
      last_sync_at: repo.last_sync_at,
      last_error: repo.last_error,
      active: store.countActive(repo.id),
      bootstrap: store.lastBootstrap(repo.id) ?? null,
    })),
  );

  app.post<{ Body: { repo: string } }>('/api/repos', async (request, reply) => {
    const full = request.body?.repo?.trim();
    if (!full || !/^[^/\s]+\/[^/\s]+$/.test(full)) return reply.code(400).send({ error: 'expected "owner/name"' });
    store.upsertRepo(full, true, {});
    orchestrator.reload();
    return { ok: true };
  });

  app.delete<{ Params: { owner: string; name: string } }>('/api/repos/:owner/:name', async (request) => {
    store.removeRepo(`${request.params.owner}/${request.params.name}`);
    orchestrator.reload();
    return { ok: true };
  });

  app.post<{ Params: { owner: string; name: string }; Body: { instructions?: string } }>(
    '/api/repos/:owner/:name/bootstrap',
    async (request, reply) => {
      const full = `${request.params.owner}/${request.params.name}`;
      if (!store.repoByName(full)) return reply.code(404).send({ error: 'unknown repository' });
      void orchestrator.bootstrap(full, request.body?.instructions ?? '');
      return reply.code(202).send({ ok: true });
    },
  );
}
