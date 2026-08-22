import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const schema = z
  .object({
    GITHUB_AUTH_MODE: z.enum(['app', 'token']).default('app'),
    GITHUB_APP_ID: z.string().optional(),
    GITHUB_APP_PRIVATE_KEY_FILE: z.string().optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().optional(),
    GITHUB_WEBHOOK_SECRET: z.string().optional(),
    GITHUB_TOKEN: z.string().optional(),
    CLAUDE_CODE_OAUTH_TOKEN: z.string().min(1, 'CLAUDE_CODE_OAUTH_TOKEN is required'),
    PORT: z.coerce.number().int().positive().default(8420),
    PUBLIC_URL: z.string().default('http://localhost:8420'),
    CONFIG_FILE: z.string().default('./config/agentloop.yml'),
    STATE_DIR: z.string().default('./state'),
    WORKSPACE_DIR: z.string().default('./workspaces'),
    LOG_DIR: z.string().default('./logs'),
    HOST_STATE_DIR: z.string().optional(),
    HOST_WORKSPACE_DIR: z.string().optional(),
    DISCORD_WEBHOOK_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.GITHUB_AUTH_MODE === 'token' && !env.GITHUB_TOKEN) {
      ctx.addIssue({ code: 'custom', message: 'GITHUB_TOKEN is required when GITHUB_AUTH_MODE=token' });
    }
    if (env.GITHUB_AUTH_MODE === 'app' && !env.GITHUB_APP_ID) {
      ctx.addIssue({ code: 'custom', message: 'GITHUB_APP_ID is required when GITHUB_AUTH_MODE=app' });
    }
  });

export type Env = z.infer<typeof schema> & { githubAppPrivateKey?: string };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`invalid environment:\n${details.join('\n')}`);
  }
  const env = parsed.data as Env;
  if (env.GITHUB_AUTH_MODE === 'app') {
    env.githubAppPrivateKey =
      env.GITHUB_APP_PRIVATE_KEY ??
      (env.GITHUB_APP_PRIVATE_KEY_FILE ? readFileSync(resolve(env.GITHUB_APP_PRIVATE_KEY_FILE), 'utf8') : undefined);
    if (!env.githubAppPrivateKey) {
      throw new Error('GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_FILE is required when GITHUB_AUTH_MODE=app');
    }
  }
  return env;
}
