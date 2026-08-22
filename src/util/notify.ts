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
