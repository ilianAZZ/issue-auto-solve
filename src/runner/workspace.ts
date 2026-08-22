import { execFile } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { slug } from '../util/time.js';

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

export interface Workspace {
  path: string;
  branch: string;
}

export async function prepareWorkspace(input: {
  root: string;
  fullName: string;
  token: string;
  baseBranch: string;
  branch: string;
  actor: { name: string; email: string };
}): Promise<Workspace> {
  const mirrorRoot = join(input.root, '.mirrors');
  const mirror = join(mirrorRoot, `${slug(input.fullName)}.git`);
  const target = join(input.root, slug(input.fullName), input.branch.replace(/\//g, '-'));
  const remote = `https://x-access-token:${input.token}@github.com/${input.fullName}.git`;

  mkdirSync(mirrorRoot, { recursive: true });
  await exec('git', ['-c', 'credential.helper=', 'ls-remote', mirror])
    .then(() => git(mirror, ['remote', 'set-url', 'origin', remote]).then(() => git(mirror, ['remote', 'update', '--prune'])))
    .catch(() => exec('git', ['clone', '--mirror', remote, mirror]).then(() => undefined));

  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  await exec('git', ['clone', '--reference-if-able', mirror, '--dissociate', '--branch', input.baseBranch, remote, target]);

  await git(target, ['config', 'user.name', input.actor.name]);
  await git(target, ['config', 'user.email', input.actor.email]);
  await git(target, ['checkout', '-B', input.branch, `origin/${input.baseBranch}`]);

  return { path: target, branch: input.branch };
}

export async function pushedBranchExists(workspace: string, branch: string): Promise<boolean> {
  return git(workspace, ['ls-remote', '--heads', 'origin', branch])
    .then((out) => out.length > 0)
    .catch(() => false);
}

export function discardWorkspace(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
