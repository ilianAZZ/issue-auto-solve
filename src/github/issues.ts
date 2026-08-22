import type { RepoAccess } from './client.js';

export interface IssueSummary {
  number: number;
  title: string;
  url: string;
  labels: string[];
  updatedAt: string;
  isPullRequest: boolean;
}

export interface IssueDetail extends IssueSummary {
  body: string;
  comments: Array<{ id: number; author: string; createdAt: string; body: string }>;
}

export async function listUpdatedIssues(access: RepoAccess, since: string | null): Promise<IssueSummary[]> {
  const pages = await access.octokit.paginate(access.octokit.issues.listForRepo, {
    owner: access.owner,
    repo: access.name,
    state: 'open',
    sort: 'updated',
    direction: 'desc',
    per_page: 100,
    ...(since ? { since } : {}),
  });
  return pages
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      labels: (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
      updatedAt: issue.updated_at,
      isPullRequest: false,
    }));
}

export async function getIssue(access: RepoAccess, number: number): Promise<IssueDetail> {
  const [issue, comments] = await Promise.all([
    access.octokit.issues.get({ owner: access.owner, repo: access.name, issue_number: number }),
    access.octokit.paginate(access.octokit.issues.listComments, {
      owner: access.owner,
      repo: access.name,
      issue_number: number,
      per_page: 100,
    }),
  ]);
  return {
    number,
    title: issue.data.title,
    url: issue.data.html_url,
    body: issue.data.body ?? '',
    labels: (issue.data.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
    updatedAt: issue.data.updated_at,
    isPullRequest: Boolean(issue.data.pull_request),
    comments: comments.map((c) => ({
      id: c.id,
      author: c.user?.login ?? 'unknown',
      createdAt: c.created_at,
      body: c.body ?? '',
    })),
  };
}

/**
 * A question is answered when a comment posted after it comes from anyone but the agent.
 * No marker, no label bookkeeping, no guessing from timestamps alone.
 */
export async function answerAfter(
  access: RepoAccess,
  number: number,
  questionCommentId: number | null,
  botLogin: string,
): Promise<{ id: number; author: string; createdAt: string; body: string } | null> {
  const { comments } = await getIssue(access, number);
  const index = questionCommentId ? comments.findIndex((c) => c.id === questionCommentId) : -1;
  const after = index === -1 ? comments : comments.slice(index + 1);
  return after.find((c) => c.author !== botLogin) ?? null;
}

export async function lastCommentBy(access: RepoAccess, number: number, login: string) {
  const { comments } = await getIssue(access, number);
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const comment = comments[i];
    if (comment && comment.author === login) return comment;
  }
  return null;
}

export async function existingWork(
  access: RepoAccess,
  number: number,
  branch: string,
): Promise<{ branch: boolean; pullRequest: string | null }> {
  const branchExists = await access.octokit.repos
    .getBranch({ owner: access.owner, repo: access.name, branch })
    .then(() => true)
    .catch(() => false);

  const search = await access.octokit.pulls.list({
    owner: access.owner,
    repo: access.name,
    state: 'all',
    head: `${access.owner}:${branch}`,
    per_page: 5,
  });
  return { branch: branchExists, pullRequest: search.data[0]?.html_url ?? null };
}

export async function comment(access: RepoAccess, number: number, body: string): Promise<number> {
  const { data } = await access.octokit.issues.createComment({
    owner: access.owner,
    repo: access.name,
    issue_number: number,
    body,
  });
  return data.id;
}

export async function setLabel(access: RepoAccess, number: number, label: string, present: boolean): Promise<void> {
  if (!label) return;
  const call = present
    ? access.octokit.issues.addLabels({ owner: access.owner, repo: access.name, issue_number: number, labels: [label] })
    : access.octokit.issues.removeLabel({ owner: access.owner, repo: access.name, issue_number: number, name: label });
  await call.catch(() => undefined);
}

export async function fetchRepoFile(access: RepoAccess, path: string, ref?: string): Promise<string | null> {
  try {
    const { data } = await access.octokit.repos.getContent({
      owner: access.owner,
      repo: access.name,
      path,
      ...(ref ? { ref } : {}),
    });
    if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return null;
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch {
    return null;
  }
}
