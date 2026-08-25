import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import type { GitHubCredentials } from '../core/credentials.js';

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

  constructor(private readonly credentials: GitHubCredentials) {
    this.app =
      credentials.mode === 'app'
        ? new Octokit({
            authStrategy: createAppAuth,
            auth: { appId: credentials.appId, privateKey: credentials.privateKey },
          })
        : new Octokit({ auth: credentials.token });
  }

  /** Login the agent writes under. Comparing against it is how a human reply is detected. */
  async botIdentity(): Promise<string> {
    if (this.identity) return this.identity;
    if (this.credentials.mode === 'app') {
      const { data } = await this.app.apps.getAuthenticated();
      this.identity = `${data?.slug ?? 'issue-auto-solve'}[bot]`;
    } else {
      const { data } = await this.app.users.getAuthenticated();
      this.identity = data.login;
    }
    return this.identity;
  }

  /** Every repository the current credentials can see — feeds the dashboard's repo picker. */
  async listAccessibleRepos(): Promise<string[]> {
    if (this.credentials.mode === 'token') {
      const repos = await this.app.paginate(this.app.repos.listForAuthenticatedUser, {
        per_page: 100,
        affiliation: 'owner,collaborator,organization_member',
      });
      return repos.map((repo) => repo.full_name).sort();
    }

    const installations = await this.app.paginate(this.app.apps.listInstallations, { per_page: 100 });
    const names = new Set<string>();
    for (const installation of installations) {
      const { data } = await this.app.apps.createInstallationAccessToken({ installation_id: installation.id });
      const installationClient = new Octokit({ auth: data.token });
      const repos = await installationClient.paginate(installationClient.apps.listReposAccessibleToInstallation, {
        per_page: 100,
      });
      for (const repo of repos) names.add(repo.full_name);
    }
    return [...names].sort();
  }

  async access(fullName: string): Promise<RepoAccess> {
    const [owner, name] = fullName.split('/');
    if (!owner || !name) throw new Error(`invalid repository "${fullName}", expected "owner/name"`);

    if (this.credentials.mode === 'token') {
      return { octokit: this.app, token: this.credentials.token!, owner, name, fullName, installationId: null };
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
