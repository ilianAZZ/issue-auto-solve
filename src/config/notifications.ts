import { z } from 'zod';
import { TASK_STATES } from '../core/states.js';

export const notificationTarget = z.object({
  type: z.enum(['discord', 'webhook']),
  url: z.string().url(),
});

/**
 * A rule fires for a task whose repository and new status both match — empty lists mean
 * "any repository" / "any status", so the widest rule is just a name and a list of targets.
 */
export const notificationRuleInput = z.object({
  name: z.string().min(1, 'name is required'),
  enabled: z.boolean().default(true),
  repos: z.array(z.string()).default([]),
  statuses: z.array(z.enum(TASK_STATES)).default([]),
  targets: z.array(notificationTarget).min(1, 'at least one target is required'),
});

export type NotificationTarget = z.infer<typeof notificationTarget>;
export type NotificationRuleInput = z.infer<typeof notificationRuleInput>;
