import { useState } from 'react';
import {
  useAddRepo,
  useAutoUpdateAction,
  useBootstrapRepo,
  useOverview,
  useRemoveRepo,
  useRepos,
  useSaveClaudeToken,
  useSaveGithubToken,
  useSetupStatus,
} from '../api/queries';
import { ago } from '../lib/format';
import { Button } from './ui/Button';
import { BootstrapModal } from './BootstrapModal';

function Badge({ text, ok }: { text: string; ok: boolean }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${
        ok ? 'border-transparent bg-green-soft text-green' : 'border-border text-muted'
      }`}
    >
      {text}
    </span>
  );
}

export function SetupOverlay({ onClose }: { onClose: () => void }) {
  const status = useSetupStatus();
  const repos = useRepos(true);
  const overview = useOverview();
  const saveGithubToken = useSaveGithubToken();
  const saveClaudeToken = useSaveClaudeToken();
  const addRepo = useAddRepo();
  const removeRepo = useRemoveRepo();
  const bootstrapRepo = useBootstrapRepo();
  const autoUpdateAction = useAutoUpdateAction();
  const autoUpdate = overview.data?.auto_update;

  const [ghAppName, setGhAppName] = useState('issue-auto-solve');
  const [ghOrg, setGhOrg] = useState('');
  const [ghToken, setGhToken] = useState('');
  const [clToken, setClToken] = useState('');
  const [repoInput, setRepoInput] = useState('');
  const [bootstrapTarget, setBootstrapTarget] = useState<string | null>(null);

  const githubLocked = status.data?.locked.github ?? false;
  const claudeLocked = status.data?.locked.claude ?? false;

  function createGithubApp() {
    const params = new URLSearchParams({ name: ghAppName.trim() });
    if (ghOrg.trim()) params.set('org', ghOrg.trim());
    window.location.href = `/setup/github/new?${params}`;
  }

  async function saveToken() {
    try {
      await saveGithubToken.mutateAsync(ghToken);
      setGhToken('');
    } catch {
      // surfaced by the global error banner
    }
  }

  function addRepoNow() {
    const repo = repoInput.trim();
    if (!repo) return;
    addRepo.mutate(repo, { onSuccess: () => setRepoInput('') });
  }

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-bg">
      <div className="mx-auto max-w-[760px] px-6 pt-12 pb-16">
        <h1 className="mt-0 mb-1 text-2xl tracking-tight">Set up issue-auto-solve</h1>
        <p className="mt-0 mb-7 text-muted">Three things, once. Nothing here needs a text editor.</p>

        <article className="mb-4 rounded-xl border border-border bg-panel p-5 shadow-[0_1px_2px_rgba(16,16,24,.06),0_8px_24px_rgba(16,16,24,.06)]">
          <header className="mb-2.5 flex items-center gap-2.5">
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
              1
            </span>
            <h2 className="m-0 flex-1 text-[15px]">GitHub</h2>
            <Badge text={status.data?.github ? `connected (${status.data.github.slug ?? status.data.github.mode})` : 'not connected'} ok={Boolean(status.data?.github)} />
          </header>
          {githubLocked ? (
            <Badge text="set in the environment" ok />
          ) : (
            <>
              <p className="mt-0 mb-3 text-[13px] text-muted">
                Create the App from your browser: GitHub asks you to confirm, sets the four permissions and three
                events itself, and hands the credentials back here.
              </p>
              <div className="mb-2 flex flex-wrap gap-2">
                <input
                  value={ghAppName}
                  onChange={(e) => setGhAppName(e.target.value)}
                  placeholder="App name (must be unique on GitHub)"
                  className="min-w-[180px] flex-1 rounded-lg border border-border bg-panel-2 p-2 text-[13px] text-text"
                />
                <input
                  value={ghOrg}
                  onChange={(e) => setGhOrg(e.target.value)}
                  placeholder="Organisation (optional)"
                  className="min-w-[180px] flex-1 rounded-lg border border-border bg-panel-2 p-2 text-[13px] text-text"
                />
                <Button variant="primary" onClick={createGithubApp}>
                  Create the GitHub App
                </Button>
              </div>
              <details className="mt-2.5">
                <summary className="cursor-pointer text-[13px] text-muted">Or paste a personal token instead</summary>
                <p className="text-[12.5px] text-muted">
                  Quicker, but the agent then writes under your own login, and telling its questions from your
                  answers becomes guesswork.
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="password"
                    value={ghToken}
                    onChange={(e) => setGhToken(e.target.value)}
                    placeholder="ghp_… or gho_…"
                    className="min-w-[180px] flex-1 rounded-lg border border-border bg-panel-2 p-2 text-[13px] text-text"
                  />
                  <Button onClick={saveToken} disabled={saveGithubToken.isPending}>
                    Save token
                  </Button>
                </div>
              </details>
            </>
          )}
        </article>

        <article className="mb-4 rounded-xl border border-border bg-panel p-5 shadow-[0_1px_2px_rgba(16,16,24,.06),0_8px_24px_rgba(16,16,24,.06)]">
          <header className="mb-2.5 flex items-center gap-2.5">
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
              2
            </span>
            <h2 className="m-0 flex-1 text-[15px]">Claude</h2>
            <Badge text={status.data?.claude ? 'connected' : 'not connected'} ok={Boolean(status.data?.claude)} />
          </header>
          {claudeLocked ? (
            <Badge text="set in the environment" ok />
          ) : (
            <>
              <p className="mt-0 mb-3 text-[13px] text-muted">
                Claude Code has no browser flow for third parties, so this one step happens in a terminal. Run{' '}
                <code className="rounded-[5px] border border-border bg-panel-2 px-1.5 py-0.5 text-xs">
                  claude setup-token
                </code>{' '}
                and paste what it prints.
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="password"
                  value={clToken}
                  onChange={(e) => setClToken(e.target.value)}
                  placeholder="Token from `claude setup-token`"
                  className="min-w-[180px] flex-1 rounded-lg border border-border bg-panel-2 p-2 text-[13px] text-text"
                />
                <Button
                  variant="primary"
                  onClick={() => saveClaudeToken.mutate(clToken, { onSuccess: () => setClToken('') })}
                  disabled={saveClaudeToken.isPending}
                >
                  Save
                </Button>
              </div>
            </>
          )}
        </article>

        <article className="mb-4 rounded-xl border border-border bg-panel p-5 shadow-[0_1px_2px_rgba(16,16,24,.06),0_8px_24px_rgba(16,16,24,.06)]">
          <header className="mb-2.5 flex items-center gap-2.5">
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
              3
            </span>
            <h2 className="m-0 flex-1 text-[15px]">Repositories</h2>
            <Badge text={repos.data?.length ? `${repos.data.length} watched` : 'none'} ok={Boolean(repos.data?.length)} />
          </header>
          <div className="mb-2 flex flex-wrap gap-2">
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addRepoNow()}
              placeholder="owner/name"
              className="min-w-[180px] flex-1 rounded-lg border border-border bg-panel-2 p-2 text-[13px] text-text"
            />
            <Button variant="primary" onClick={addRepoNow} disabled={addRepo.isPending}>
              Add
            </Button>
          </div>
          <ul className="my-2 mb-3 list-none p-0">
            {repos.data?.length ? (
              repos.data.map((repo) => (
                <li key={repo.full_name} className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] last:border-0">
                  <span className="flex-1 font-medium">{repo.full_name}</span>
                  <span className="text-[11.5px] text-muted">
                    {repo.last_error ? (
                      <span className="text-red">{repo.last_error.slice(0, 60)}</span>
                    ) : repo.bootstrap?.status === 'running' ? (
                      'generating config…'
                    ) : repo.bootstrap?.status === 'succeeded' && repo.bootstrap.result ? (
                      <a href={repo.bootstrap.result} target="_blank" rel="noreferrer" className="text-inherit">
                        config PR opened
                      </a>
                    ) : repo.last_sync_at ? (
                      `synced ${ago(repo.last_sync_at)} ago`
                    ) : (
                      'never synced'
                    )}
                  </span>
                  <Button onClick={() => setBootstrapTarget(repo.full_name)}>Generate config</Button>
                  <Button onClick={() => removeRepo.mutate(repo.full_name)} disabled={removeRepo.isPending}>
                    Remove
                  </Button>
                </li>
              ))
            ) : (
              <li className="text-[12.5px] text-muted">No repository yet.</li>
            )}
          </ul>
          <p className="text-[12.5px] text-muted">
            Adding a repository is enough to start watching it. To let the agent write its own{' '}
            <code className="rounded-[5px] border border-border bg-panel-2 px-1.5 py-0.5 text-xs">
              .issue-auto-solve.yml
            </code>
            , use <b>Generate config</b>: it reads the repository, proposes a configuration and opens a pull request
            with it.
          </p>
        </article>

        <article className="mb-4 rounded-xl border border-border bg-panel p-5 shadow-[0_1px_2px_rgba(16,16,24,.06),0_8px_24px_rgba(16,16,24,.06)]">
          <header className="mb-2.5 flex items-center gap-2.5">
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
              4
            </span>
            <h2 className="m-0 flex-1 text-[15px]">Updates</h2>
            <Badge text={autoUpdate?.enabled ? 'automatic' : 'manual'} ok={Boolean(autoUpdate?.enabled)} />
          </header>
          <p className="mt-0 mb-3 text-[13px] text-muted">
            When on, issue-auto-solve checks the image it was started from for a newer digest and, once nothing is
            running, recreates its own container on it — no <code className="rounded-[5px] border border-border bg-panel-2 px-1.5 py-0.5 text-xs">docker pull &amp; restart</code> by
            hand. State lives outside the container, so an update never touches it.
          </p>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={() => autoUpdateAction.mutate(autoUpdate?.enabled ? 'disable' : 'enable')}
              disabled={!overview.data || autoUpdateAction.isPending}
            >
              {autoUpdate?.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button onClick={() => autoUpdateAction.mutate('check')} disabled={!overview.data || autoUpdateAction.isPending}>
              Check now
            </Button>
            <span className="text-[12.5px] text-muted">
              {autoUpdate?.checking
                ? 'checking…'
                : autoUpdate?.update_available
                  ? 'update available, applying on the next check'
                  : autoUpdate?.current_image
                    ? `up to date (${autoUpdate.current_image})`
                    : 'not checked yet'}
              {autoUpdate?.last_checked_at ? ` · checked ${ago(autoUpdate.last_checked_at)} ago` : ''}
            </span>
          </div>
          {autoUpdate?.last_error && <p className="m-0 text-[12.5px] text-red">{autoUpdate.last_error}</p>}
        </article>

        <Button onClick={onClose}>Back to the dashboard</Button>
      </div>

      {bootstrapTarget && (
        <BootstrapModal
          repo={bootstrapTarget}
          onCancel={() => setBootstrapTarget(null)}
          onConfirm={(instructions) => {
            bootstrapRepo.mutate({ fullName: bootstrapTarget, instructions });
            setBootstrapTarget(null);
          }}
        />
      )}
    </div>
  );
}
