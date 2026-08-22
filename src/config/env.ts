import { existsSync, readFileSync } from 'node:fs';
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
    CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
    PORT: z.coerce.number().int().positive().default(8420),
    PUBLIC_URL: z.string().default('http://localhost:8420'),
    CONFIG_FILE: z.string().default('./config/issue-auto-solve.yml'),
    STATE_DIR: z.string().default('./state'),
    WORKSPACE_DIR: z.string().default('./workspaces'),
    LOG_DIR: z.string().default('./logs'),
    HOST_STATE_DIR: z.string().optional(),
    HOST_WORKSPACE_DIR: z.string().optional(),
    DISCORD_WEBHOOK_URL: z.string().optional(),
  })
  .transform((env) => env);

export type Env = z.infer<typeof schema> & { githubAppPrivateKey?: string };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`invalid environment:\n${details.join('\n')}`);
  }
  const env = parsed.data as Env;
  const keyFile = env.GITHUB_APP_PRIVATE_KEY_FILE;
  env.githubAppPrivateKey =
    env.GITHUB_APP_PRIVATE_KEY ?? (keyFile && existsSync(resolve(keyFile)) ? readFileSync(resolve(keyFile), 'utf8') : undefined);
  return env;
}
