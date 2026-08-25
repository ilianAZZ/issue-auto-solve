import type { NotificationTarget } from '../config/notifications.js';
import type { Logger } from './log.js';

export function notifier(webhookUrl: string | undefined, log: Logger) {
  return async (content: string): Promise<void> => {
    if (!webhookUrl) return;
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    } catch (error) {
      log.warn('notification failed', { error: String(error) });
    }
  };
}

export type Notify = ReturnType<typeof notifier>;

/**
 * A Discord webhook renders whatever is in `content`; a generic webhook gets the same
 * field plus the repo/status that triggered it, so it can be routed without parsing text.
 */
export async function sendToTarget(
  target: NotificationTarget,
  content: string,
  context: { repo: string; status: string },
  log: Logger,
): Promise<void> {
  try {
    await fetch(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, ...context }),
    });
  } catch (error) {
    log.warn('rule notification failed', { error: String(error), url: target.url, type: target.type });
  }
}
