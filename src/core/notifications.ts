import type { NotificationTarget } from '../config/notifications.js';
import type { TaskState } from './states.js';

export interface NotificationRule {
  id: number;
  name: string;
  enabled: boolean;
  repos: string[];
  statuses: TaskState[];
  targets: NotificationTarget[];
}

/**
 * Targets for every enabled rule whose repo list and status list both match — an empty
 * list on either side means "any". A target reachable through more than one matching rule
 * is only returned once, so one webhook never gets the same event twice.
 */
export function matchingTargets(rules: NotificationRule[], repo: string, state: TaskState): NotificationTarget[] {
  const matched = rules
    .filter((rule) => rule.enabled)
    .filter((rule) => rule.repos.length === 0 || rule.repos.includes(repo))
    .filter((rule) => rule.statuses.length === 0 || rule.statuses.includes(state))
    .flatMap((rule) => rule.targets);

  const seen = new Set<string>();
  return matched.filter((target) => {
    const key = `${target.type}:${target.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
