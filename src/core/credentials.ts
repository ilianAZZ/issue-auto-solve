import type { SecretStore } from '../db/secrets.js';
import type { Env } from '../config/env.js';

export interface GitHubCredentials {
  mode: 'app' | 'token';
  appId?: string;
  privateKey?: string;
  webhookSecret?: string;
  token?: string;
  slug?: string;
}

/** The environment wins when set, so an existing .env deployment keeps working untouched. */
export class Credentials {
  constructor(
    private readonly env: Env,
    private readonly secrets: SecretStore,
  ) {}

  github(): GitHubCredentials | null {
    if (this.env.GITHUB_AUTH_MODE === 'token' && this.env.GITHUB_TOKEN) {
      return { mode: 'token', token: this.env.GITHUB_TOKEN };
    }
    if (this.env.GITHUB_APP_ID && this.env.githubAppPrivateKey) {
      return {
        mode: 'app',
        appId: this.env.GITHUB_APP_ID,
        privateKey: this.env.githubAppPrivateKey,
        webhookSecret: this.env.GITHUB_WEBHOOK_SECRET,
      };
    }
    const appId = this.secrets.get('github.app_id');
    const privateKey = this.secrets.get('github.private_key');
    if (appId && privateKey) {
      return {
        mode: 'app',
        appId,
        privateKey,
        webhookSecret: this.secrets.get('github.webhook_secret') ?? undefined,
        slug: this.secrets.get('github.slug') ?? undefined,
      };
    }
    const token = this.secrets.get('github.token');
    return token ? { mode: 'token', token } : null;
  }

  claudeToken(): string | null {
    return this.env.CLAUDE_CODE_OAUTH_TOKEN || this.secrets.get('claude.oauth_token');
  }

  webhookSecret(): string | null {
    return this.env.GITHUB_WEBHOOK_SECRET ?? this.secrets.get('github.webhook_secret');
  }

  saveGitHubApp(app: { appId: string; privateKey: string; webhookSecret?: string; slug?: string }): void {
    this.secrets.set('github.app_id', app.appId);
    this.secrets.set('github.private_key', app.privateKey);
    this.secrets.set('github.webhook_secret', app.webhookSecret ?? null);
    this.secrets.set('github.slug', app.slug ?? null);
    this.secrets.set('github.token', null);
  }

  saveGitHubToken(token: string): void {
    this.secrets.set('github.token', token);
    this.secrets.set('github.app_id', null);
    this.secrets.set('github.private_key', null);
  }

  saveClaudeToken(token: string): void {
    this.secrets.set('claude.oauth_token', token);
  }

  /** Env-provided credentials cannot be edited from the dashboard. */
  locked(): { github: boolean; claude: boolean } {
    return {
      github: Boolean((this.env.GITHUB_AUTH_MODE === 'token' && this.env.GITHUB_TOKEN) || this.env.GITHUB_APP_ID),
      claude: Boolean(this.env.CLAUDE_CODE_OAUTH_TOKEN),
    };
  }
}
