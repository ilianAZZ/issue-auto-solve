import { useMemo, useState } from 'react';
import { useAvailableRepos, useRepoConditions } from '../api/queries';
import { AUTHOR_ASSOCIATIONS } from '../lib/constants';
import type { RepoSettingsForm } from '../types';
import { Button } from './ui/Button';
import { ChipList } from './ui/ChipList';
import { Combobox } from './ui/Combobox';

const emptySettings: RepoSettingsForm = {
  selection: {
    trusted_associations: [],
    whitelist_users: [],
    blacklist_users: [],
    check_tags: false,
    whitelist_tags: [],
    blacklist_tags: [],
  },
  prompt: { file: '', variables: {} },
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[12.5px] font-medium">{label}</div>
      {hint && <p className="mt-0 mb-1.5 text-[11.5px] text-muted">{hint}</p>}
      {children}
    </div>
  );
}

export function AddRepoModal({
  onCancel,
  onConfirm,
  pending,
}: {
  onCancel: () => void;
  onConfirm: (repo: string, settings: RepoSettingsForm) => void;
  pending: boolean;
}) {
  const [repo, setRepo] = useState('');
  const [settings, setSettings] = useState<RepoSettingsForm>(emptySettings);
  const [varKey, setVarKey] = useState('');
  const [varValue, setVarValue] = useState('');

  const trimmed = repo.trim();
  const repoValid = /^[^/\s]+\/[^/\s]+$/.test(trimmed);
  const conditions = useRepoConditions(repoValid ? trimmed : '');
  const groups = conditions.data?.groups ?? AUTHOR_ASSOCIATIONS;
  const availableRepos = useAvailableRepos();

  const { selection, prompt } = settings;

  function patchSelection(patch: Partial<RepoSettingsForm['selection']>) {
    setSettings((s) => ({ ...s, selection: { ...s.selection, ...patch } }));
  }

  function toggleGroup(group: string) {
    const next = selection.trusted_associations.includes(group)
      ? selection.trusted_associations.filter((g) => g !== group)
      : [...selection.trusted_associations, group];
    patchSelection({ trusted_associations: next });
  }

  function addVariable() {
    const key = varKey.trim();
    if (!key) return;
    setSettings((s) => ({ ...s, prompt: { ...s.prompt, variables: { ...s.prompt.variables, [key]: varValue } } }));
    setVarKey('');
    setVarValue('');
  }

  function removeVariable(key: string) {
    setSettings((s) => {
      const variables = { ...s.prompt.variables };
      delete variables[key];
      return { ...s, prompt: { ...s.prompt, variables } };
    });
  }

  const variableEntries = useMemo(() => Object.entries(prompt.variables), [prompt.variables]);

  function submit() {
    if (!repoValid || pending) return;
    onConfirm(trimmed, settings);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl border border-border bg-panel p-5 shadow-[0_1px_2px_rgba(16,16,24,.06),0_8px_24px_rgba(16,16,24,.06)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mt-0 mb-1.5 text-[15px] font-semibold">Add a repository</h2>
        <p className="mt-0 mb-4 text-[13px] text-muted">
          Who can trigger the agent and which tags gate it — set once here, per repository. Anything left empty
          keeps the default, open behaviour.
        </p>

        <Field label="Repository" hint='Pick from what the app can see, or type "owner/name" by hand.'>
          <Combobox
            autoFocus
            value={repo}
            onChange={setRepo}
            options={availableRepos.data ?? []}
            loading={availableRepos.isLoading}
            placeholder="owner/name"
          />
          {availableRepos.isError && (
            <p className="mt-1 text-[11.5px] text-muted">
              Could not list your repositories — type the repository below instead.
            </p>
          )}
          {repoValid && conditions.isError && (
            <p className="mt-1 text-[11.5px] text-muted">
              Could not read labels/collaborators yet — the GitHub App may not be installed on it. You can still
              type values by hand below.
            </p>
          )}
        </Field>

        <Field label="Trusted groups" hint="Issues opened by one of these GitHub associations skip the approval gate.">
          <div className="flex flex-wrap gap-1.5">
            {groups.map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => toggleGroup(group)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] ${
                  selection.trusted_associations.includes(group)
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border bg-panel-2 text-muted'
                }`}
              >
                {group}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Whitelisted users" hint="Individual logins trusted even without a matching association.">
          <ChipList
            value={selection.whitelist_users}
            onChange={(whitelist_users) => patchSelection({ whitelist_users })}
            suggestions={conditions.data?.users}
            placeholder="github login"
          />
        </Field>

        <Field label="Blacklisted users" hint="Issues opened by these logins are skipped outright.">
          <ChipList
            value={selection.blacklist_users}
            onChange={(blacklist_users) => patchSelection({ blacklist_users })}
            suggestions={conditions.data?.users}
            placeholder="github login"
          />
        </Field>

        <Field label="Check tags" hint="Gate issues by label in addition to who opened them.">
          <label className="flex items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={selection.check_tags}
              onChange={(e) => patchSelection({ check_tags: e.target.checked })}
            />
            Only work issues that match a tag rule below
          </label>
        </Field>

        {selection.check_tags && (
          <>
            <Field label="Whitelisted tags" hint="Issue must carry at least one of these labels to be worked.">
              <ChipList
                value={selection.whitelist_tags}
                onChange={(whitelist_tags) => patchSelection({ whitelist_tags })}
                suggestions={conditions.data?.labels}
                placeholder="label"
              />
            </Field>
            <Field label="Blacklisted tags" hint="Issues carrying any of these labels are skipped outright.">
              <ChipList
                value={selection.blacklist_tags}
                onChange={(blacklist_tags) => patchSelection({ blacklist_tags })}
                suggestions={conditions.data?.labels}
                placeholder="label"
              />
            </Field>
          </>
        )}

        <Field label="Prompt file" hint="Path in the repository that replaces the built-in prompt. Leave empty to use the default.">
          <input
            value={prompt.file}
            onChange={(e) => setSettings((s) => ({ ...s, prompt: { ...s.prompt, file: e.target.value } }))}
            placeholder=".issue-auto-solve/prompt.md"
            className="w-full rounded-lg border border-border bg-panel-2 p-2 text-[13px] text-text"
          />
        </Field>

        <Field label="Prompt variables" hint="Injected into the prompt template alongside the built-in ones.">
          {variableEntries.length > 0 && (
            <ul className="mb-1.5 list-none p-0">
              {variableEntries.map(([key, value]) => (
                <li key={key} className="mb-1 flex items-center gap-1.5 text-[12.5px]">
                  <code className="rounded-[5px] border border-border bg-panel-2 px-1.5 py-0.5 text-[11.5px]">{key}</code>
                  <span className="flex-1 truncate text-muted">{value}</span>
                  <button type="button" onClick={() => removeVariable(key)} className="text-muted hover:text-text">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-1.5">
            <input
              value={varKey}
              onChange={(e) => setVarKey(e.target.value)}
              placeholder="name"
              className="w-[120px] rounded-lg border border-border bg-panel-2 p-1.5 text-[12.5px] text-text"
            />
            <input
              value={varValue}
              onChange={(e) => setVarValue(e.target.value)}
              placeholder="value"
              className="flex-1 rounded-lg border border-border bg-panel-2 p-1.5 text-[12.5px] text-text"
            />
            <Button onClick={addVariable} disabled={!varKey.trim()}>
              Add
            </Button>
          </div>
        </Field>

        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!repoValid || pending}>
            Add repository
          </Button>
        </div>
      </div>
    </div>
  );
}
