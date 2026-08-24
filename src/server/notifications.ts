import type { FastifyInstance } from 'fastify';
import { notificationRuleInput } from '../config/notifications.js';
import type { NotificationRuleRow, Store } from '../db/store.js';

const view = (row: NotificationRuleRow) => ({
  id: row.id,
  name: row.name,
  enabled: Boolean(row.enabled),
  repos: JSON.parse(row.repos_json) as string[],
  statuses: JSON.parse(row.statuses_json) as string[],
  targets: JSON.parse(row.targets_json) as { type: string; url: string }[],
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export function registerNotifications(app: FastifyInstance, store: Store): void {
  app.get('/api/notifications', async () => store.notificationRules().map(view));

  app.post<{ Body: unknown }>('/api/notifications', async (request, reply) => {
    const parsed = notificationRuleInput.safeParse(request.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return reply.code(400).send({ error: details.join(', ') });
    }
    return reply.code(201).send(view(store.createNotificationRule(parsed.data)));
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/api/notifications/:id', async (request, reply) => {
    const parsed = notificationRuleInput.safeParse(request.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return reply.code(400).send({ error: details.join(', ') });
    }
    const row = store.updateNotificationRule(Number(request.params.id), parsed.data);
    if (!row) return reply.code(404).send({ error: 'unknown notification rule' });
    return view(row);
  });

  app.delete<{ Params: { id: string } }>('/api/notifications/:id', async (request) => {
    store.deleteNotificationRule(Number(request.params.id));
    return { ok: true };
  });
}
