import { z } from 'zod';

const check = z.object({
  name: z.string(),
  run: z.string(),
  when: z.string().optional(),
});

export const repoSettings = z.object({
  version: z.literal(1).optional(),
  base_branch: z.string(),
  branch_pattern: z.string(),
  config_path: z.string(),
  labels: z.object({
    exclude: z.array(z.string()),
    waiting: z.string(),
  }),
  selection: z.object({
    order: z.enum(['oldest', 'newest', 'priority_labels']),
    priority_labels: z.array(z.string()),
    require_label: z.string().nullable(),
    trusted_associations: z.array(z.string()),
    whitelist_users: z.array(z.string()),
    blacklist_users: z.array(z.string()),
    check_tags: z.boolean(),
    whitelist_tags: z.array(z.string()),
    blacklist_tags: z.array(z.string()),
  }),
  limits: z.object({
    max_concurrent_runs: z.number().int().positive(),
    timeout_minutes: z.number().int().positive(),
    max_runs_per_task: z.number().int().positive(),
  }),
  runtime: z.object({
    image: z.string(),
    docker_socket: z.boolean(),
    env: z.array(z.string()),
    setup: z.array(z.string()),
  }),
  preflight: z.array(z.string()),
  checks: z.array(check),
  prompt: z.object({
    file: z.string().nullable(),
    variables: z.record(z.string()),
  }),
});

export type RepoSettings = z.infer<typeof repoSettings>;
export type Check = z.infer<typeof check>;

const deepPartial = repoSettings.deepPartial();

export const repoSettingsPartial = deepPartial;
export type RepoSettingsInput = z.infer<typeof deepPartial>;

export const globalConfig = z.object({
  poll_interval_seconds: z.number().int().positive().default(120),
  // A pull request for a failed/skipped task can still get merged or closed by hand on
  // GitHub, so those are re-checked periodically — but on this longer interval, not on
  // every poll tick: re-checking the whole failed/skipped backlog every tick scales with
  // total task history instead of active work, and is what exhausted the GitHub rate
  // limit permanently once that backlog grew past ~80 tasks.
  reconcile_terminal_interval_seconds: z.number().int().positive().default(300),
  max_concurrent_runs: z.number().int().positive().default(2),
  dispatch_enabled: z.boolean().default(true),
  // Environment variables a repository may ask for. Empty means none.
  allow_env: z.array(z.string()).default([]),
  bootstrap: z
    .object({
      image: z.string().default('node:24-slim'),
      setup: z
        .array(z.string())
        .default([
          'apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates gnupg',
          'install -d -m 755 /etc/apt/keyrings && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && apt-get update && apt-get install -y --no-install-recommends gh',
          'npm install -g @anthropic-ai/claude-code',
        ]),
    })
    .default({}),
  defaults: deepPartial.default({}),
  // Self-update: issue-auto-solve is itself a container, and a new image published to the
  // registry otherwise sits there until someone runs `docker pull && up -d` by hand. When
  // enabled, it checks the registry on this interval and, if a newer image is found and no
  // run is in flight, recreates itself on it. State lives on bind mounts outside the
  // container, so an update never touches it — see docs/DEPLOY.md.
  auto_update: z
    .object({
      enabled: z.boolean().default(false),
      check_interval_hours: z.number().int().positive().default(24),
    })
    .default({}),
  repositories: z
    .array(
      z.object({
        repo: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/name"'),
        enabled: z.boolean().default(true),
        settings: deepPartial.optional(),
      }),
    )
    .default([]),
});

export type GlobalConfig = z.infer<typeof globalConfig>;
export type RepoEntry = GlobalConfig['repositories'][number];
export type AutoUpdateConfig = GlobalConfig['auto_update'];
