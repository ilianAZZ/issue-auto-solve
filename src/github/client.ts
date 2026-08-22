import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import type { Env } from '../config/env.js';

export interface RepoAccess {
  octokit: Octokit;
  token: string;
  owner: string;
  name: string;
  fullName: string;
  installationId: number | null;
}

export class GitHub {
  private readonly app: Octokit;
  private identity: string | null = null;

  constructor(private readonly env: Env) {
    this.app =
      env.GITHUB_AUTH_MODE === 'app'
        ? new Octokit({
            authStrategy: createAppAuth,
            auth: { appId: env.GITHUB_APP_ID, privateKey: env.githubAppPrivateKey },
          })
        : new Octokit({ auth: env.GITHUB_TOKEN });
  }

  /** Login the agent writes under. Comparing against it is how a human reply is detected. */
  async botIdentity(): Promise<string> {
    if (this.identity) return this.identity;
    if (this.env.GITHUB_AUTH_MODE === 'app') {
      const { data } = await this.app.apps.getAuthenticated();
      this.identity = `${data?.slug ?? 'issue-auto-solve'}[bot]`;
    } else {
      const { data } = await this.app.users.getAuthenticated();
      this.identity = data.login;
    }
    return this.identity;
  }

  async access(fullName: string): Promise<RepoAccess> {
    const [owner, name] = fullName.split('/');
    if (!owner || !name) throw new Error(`invalid repository "${fullName}", expected "owner/name"`);

    if (this.env.GITHUB_AUTH_MODE === 'token') {
      return { octokit: this.app, token: this.env.GITHUB_TOKEN!, owner, name, fullName, installationId: null };
    }

    const installation = await this.app.apps.getRepoInstallation({ owner, repo: name });
    const { data } = await this.app.apps.createInstallationAccessToken({ installation_id: installation.data.id });
    return {
      octokit: new Octokit({ auth: data.token }),
      token: data.token,
      owner,
      name,
      fullName,
      installationId: installation.data.id,
    };
  }
}
