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

export const globalConfig = z.object({
  poll_interval_seconds: z.number().int().positive().default(120),
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
          'apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates',
          'npm install -g @anthropic-ai/claude-code',
        ]),
    })
    .default({}),
  defaults: deepPartial.default({}),
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
