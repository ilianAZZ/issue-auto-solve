import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { Octokit } from '@octokit/rest';
import { repoSettingsPartial, type Env, type RepoSettingsInput } from '../config/index.js';
import type { Credentials } from '../core/credentials.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type { Store } from '../db/store.js';
import { logger } from '../util/log.js';

const log = logger('setup');
const pending = new Set<string>();

// GitHub's fixed author_association values — not repository data, so nothing to fetch;
// listed here purely so the dashboard can offer them as "groups" alongside real labels
// and users.
const AUTHOR_ASSOCIATIONS = [
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
  'CONTRIBUTOR',
  'FIRST_TIME_CONTRIBUTOR',
  'FIRST_TIMER',
  'MANNEQUIN',
  'NONE',
];

const reachableByGitHub = (url: string) => !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url);

// The subset of a repository's stored settings the dashboard's add/configure form edits —
// filled in with the same empty defaults the form itself starts from, so a repository added
// before a field existed (or seeded from config.yml without it) still opens with a fully
// formed, editable shape rather than `undefined`.
function formSettings(settingsJson: string): {
  selection: RepoSettingsInput['selection'];
  prompt: { file: string; variables: Record<string, string> };
} {
  const raw = JSON.parse(settingsJson || '{}') as RepoSettingsInput;
  return {
    selection: {
      trusted_associations: raw.selection?.trusted_associations ?? [],
      whitelist_users: raw.selection?.whitelist_users ?? [],
      blacklist_users: raw.selection?.blacklist_users ?? [],
      check_tags: raw.selection?.check_tags ?? false,
      whitelist_tags: raw.selection?.whitelist_tags ?? [],
      blacklist_tags: raw.selection?.blacklist_tags ?? [],
    },
    prompt: {
      file: raw.prompt?.file ?? '',
      variables: raw.prompt?.variables ?? {},
    },
  };
}

const manifestFor = (publicUrl: string, name: string) => ({
  name,
  url: publicUrl,
  redirect_url: `${publicUrl}/setup/github/callback`,
  // GitHub rejects the whole manifest — "Hook url is not supported… (localhost)" — the
  // moment hook_attributes.url isn't publicly reachable, regardless of `active`. So a
  // local or tunnelled public URL must omit hook_attributes entirely rather than send it
  // with active:false. Polling covers everything the webhook would have delivered.
  ...(reachableByGitHub(publicUrl)
    ? { hook_attributes: { url: `${publicUrl}/webhooks/github`, active: true } }
    : {}),
  public: false,
  default_permissions: { issues: 'write', pull_requests: 'write', contents: 'write', metadata: 'read' },
  default_events: ['issues', 'issue_comment', 'pull_request'],
});

// Lets each user point the manifest at the URL they actually reach the dashboard on —
// PUBLIC_URL is one fixed value for the whole deployment, but a tunnel (ssh -L, ngrok,
// cloudflared) gives a different host per person running it, and there's no way to know
// that ahead of time. Falls back to PUBLIC_URL when the field is left blank.
function resolvePublicUrl(raw: string | undefined, fallback: string): { url: string } | { error: string } {
  const trimmed = raw?.trim();
  if (!trimmed) return { url: fallback };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: 'invalid public url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: 'invalid public url' };
  return { url: parsed.toString().replace(/\/$/, '') };
}

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
  app.get<{ Querystring: { org?: string; name?: string; url?: string } }>('/setup/github/new', async (request, reply) => {
    const name = request.query.name?.trim() || 'issue-auto-solve';
    const resolved = resolvePublicUrl(request.query.url, env.PUBLIC_URL);
    if ('error' in resolved) return reply.code(400).send(resolved.error);
    const nonce = randomBytes(16).toString('hex');
    pending.add(nonce);
    const action = request.query.org
      ? `https://github.com/organizations/${request.query.org}/settings/apps/new`
      : 'https://github.com/settings/apps/new';
    const manifest = JSON.stringify(manifestFor(resolved.url, name)).replace(/"/g, '&quot;');
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
    store.setMeta('claude_token_invalid', '0');
    return { ok: true };
  });

  // Feeds the repo picker in "add a repository" and the notification rule editor with real
  // repositories the configured credentials can see, instead of a free-text "owner/name" field.
  app.get('/api/github/repos', async (_request, reply) => {
    if (!credentials.github()) return [];
    try {
      return await orchestrator.listRepos();
    } catch (error) {
      return reply.code(502).send({ error: String(error) });
    }
  });

  app.get('/api/repos', async () =>
    store.repos().map((repo) => ({
      full_name: repo.full_name,
      enabled: Boolean(repo.enabled),
      last_sync_at: repo.last_sync_at,
      last_error: repo.last_error,
      active: store.countActive(repo.id),
      bootstrap: store.lastBootstrap(repo.id) ?? null,
      settings: formSettings(repo.settings_json),
    })),
  );

  // Also used to update the who-can-trigger / prompt settings of a repository already
  // watched (the dashboard's "Configure" button) — upsertRepo is an insert-or-update, and
  // merging onto whatever settings_json already holds keeps fields the dashboard form
  // doesn't expose (limits, runtime, checks, …), which may have been seeded from
  // config.yml, from being wiped out by an edit that only touches selection/prompt.
  app.post<{ Body: { repo: string; settings?: unknown } }>('/api/repos', async (request, reply) => {
    const full = request.body?.repo?.trim();
    if (!full || !/^[^/\s]+\/[^/\s]+$/.test(full)) return reply.code(400).send({ error: 'expected "owner/name"' });
    const parsed = repoSettingsPartial.safeParse(request.body?.settings ?? {});
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return reply.code(400).send({ error: `invalid settings: ${details.join(', ')}` });
    }
    const existing = store.repoByName(full);
    const base = existing ? (JSON.parse(existing.settings_json || '{}') as Record<string, unknown>) : {};
    store.upsertRepo(full, true, { ...base, ...parsed.data });
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

  // Feeds the "selection" conditions in .issue-auto-solve.yml (require_label,
  // trusted_associations, whitelist_users, blacklist_users, whitelist_tags,
  // blacklist_tags): real labels and collaborators for this repository, plus GitHub's
  // fixed association groups. Deliberately not gated on the repository already being
  // watched — the dashboard calls this while a repository is still being added, so its
  // config panel can be filled from what actually exists instead of guessed at.
  app.get<{ Params: { owner: string; name: string } }>('/api/repos/:owner/:name/conditions', async (request, reply) => {
    const full = `${request.params.owner}/${request.params.name}`;
    try {
      const access = await orchestrator.repoAccess(full);
      const [labels, collaborators] = await Promise.all([
        access.octokit.paginate(access.octokit.issues.listLabelsForRepo, {
          owner: access.owner,
          repo: access.name,
          per_page: 100,
        }),
        access.octokit.paginate(access.octokit.repos.listCollaborators, {
          owner: access.owner,
          repo: access.name,
          per_page: 100,
        }).catch(() => []),
      ]);
      return {
        labels: labels.map((label) => label.name).sort(),
        users: collaborators.map((user) => user.login).sort(),
        groups: AUTHOR_ASSOCIATIONS,
      };
    } catch (error) {
      return reply.code(502).send({ error: String(error) });
    }
  });
}
