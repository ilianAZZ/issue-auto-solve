import { useState } from 'react';
import { useAvailableRepos } from '../api/queries';
import { LABELS, STATES } from '../lib/constants';
import type { NotificationRule, NotificationRuleInput, NotificationTarget, NotificationTargetType, TaskState } from '../types';
import { Button } from './ui/Button';
import { ChipList } from './ui/ChipList';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[12.5px] font-medium">{label}</div>
      {hint && <p className="mt-0 mb-1.5 text-[11.5px] text-muted">{hint}</p>}
      {children}
    </div>
  );
}

function emptyInput(): NotificationRuleInput {
  return { name: '', enabled: true, repos: [], statuses: [], targets: [] };
}

export function NotificationRuleModal({
  initial,
  onCancel,
  onConfirm,
  pending,
}: {
  initial?: NotificationRule;
  onCancel: () => void;
  onConfirm: (input: NotificationRuleInput) => void;
  pending: boolean;
}) {
  const [input, setInput] = useState<NotificationRuleInput>(
    initial
      ? { name: initial.name, enabled: initial.enabled, repos: initial.repos, statuses: initial.statuses, targets: initial.targets }
      : emptyInput(),
  );
  const [targetType, setTargetType] = useState<NotificationTargetType>('discord');
  const [targetUrl, setTargetUrl] = useState('');
  const availableRepos = useAvailableRepos();

  function toggleStatus(state: TaskState) {
    const next = input.statuses.includes(state) ? input.statuses.filter((s) => s !== state) : [...input.statuses, state];
    setInput((s) => ({ ...s, statuses: next }));
  }

  function addTarget() {
    const url = targetUrl.trim();
    if (!url) return;
    const target: NotificationTarget = { type: targetType, url };
    setInput((s) => ({ ...s, targets: [...s.targets, target] }));
    setTargetUrl('');
  }

  function removeTarget(index: number) {
    setInput((s) => ({ ...s, targets: s.targets.filter((_, i) => i !== index) }));
  }

  const valid = input.name.trim().length > 0 && input.targets.length > 0;

  function submit() {
    if (!valid || pending) return;
    onConfirm({ ...input, name: input.name.trim() });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-auto overscroll-contain rounded-xl border border-border bg-panel p-4 shadow-[0_1px_2px_rgba(16,16,24,.06),0_8px_24px_rgba(16,16,24,.06)] sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mt-0 mb-1.5 text-[15px] font-semibold">{initial ? 'Edit notification' : 'Add a notification'}</h2>
        <p className="mt-0 mb-4 text-[13px] text-muted">
          Fires to every target below when a watched task's status changes to one of the statuses picked here, for
          one of the repositories picked here. Leave either list empty to match all of them.
        </p>

        <Field label="Name">
          <input
            autoFocus
            value={input.name}
            onChange={(e) => setInput((s) => ({ ...s, name: e.target.value }))}
            placeholder="e.g. PR opened alerts"
            className="w-full rounded-lg border border-border bg-panel-2 p-2 text-[13px] text-text"
          />
        </Field>

        <Field label="Enabled">
          <label className="flex items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={input.enabled}
              onChange={(e) => setInput((s) => ({ ...s, enabled: e.target.checked }))}
            />
            Send notifications for this rule
          </label>
        </Field>

        <Field label="Repositories" hint="Empty matches every watched repository.">
          <ChipList
            value={input.repos}
            onChange={(repos) => setInput((s) => ({ ...s, repos }))}
            suggestions={availableRepos.data}
            placeholder="owner/name"
          />
        </Field>

        <Field label="Statuses" hint="Empty matches every status.">
          <div className="flex flex-wrap gap-1.5">
            {STATES.map((state) => (
              <button
                key={state}
                type="button"
                onClick={() => toggleStatus(state)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] ${
                  input.statuses.includes(state) ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-panel-2 text-muted'
                }`}
              >
                {LABELS[state]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Targets" hint="At least one Discord webhook URL or generic webhook URL.">
          {input.targets.length > 0 && (
            <ul className="mb-1.5 list-none p-0">
              {input.targets.map((target, index) => (
                <li key={`${target.type}-${target.url}-${index}`} className="mb-1 flex items-center gap-1.5 text-[12.5px]">
                  <code className="rounded-[5px] border border-border bg-panel-2 px-1.5 py-0.5 text-[11.5px]">{target.type}</code>
                  <span className="flex-1 truncate text-muted">{target.url}</span>
                  <button type="button" onClick={() => removeTarget(index)} className="text-muted hover:text-text">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-1.5">
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as NotificationTargetType)}
              className="rounded-lg border border-border bg-panel-2 p-1.5 text-[12.5px] text-text"
            >
              <option value="discord">Discord</option>
              <option value="webhook">Webhook</option>
            </select>
            <input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://…"
              className="flex-1 rounded-lg border border-border bg-panel-2 p-1.5 text-[12.5px] text-text"
            />
            <Button onClick={addTarget} disabled={!targetUrl.trim()}>
              Add
            </Button>
          </div>
        </Field>

        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!valid || pending}>
            {initial ? 'Save' : 'Add notification'}
          </Button>
        </div>
      </div>
    </div>
  );
}
