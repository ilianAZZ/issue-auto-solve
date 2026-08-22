import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySignature(secret: string, payload: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface WebhookHint {
  repo: string;
  number: number | null;
  kind: string;
}

export function interpret(event: string, body: Record<string, any>): WebhookHint | null {
  const repo = body?.repository?.full_name;
  if (!repo) return null;
  if (event === 'issue_comment' && body.action === 'created') {
    return { repo, number: body.issue?.number ?? null, kind: 'comment' };
  }
  if (event === 'issues' && ['opened', 'reopened', 'labeled', 'unlabeled', 'edited'].includes(body.action)) {
    return { repo, number: body.issue?.number ?? null, kind: `issue.${body.action}` };
  }
  if (event === 'pull_request' && ['closed', 'opened'].includes(body.action)) {
    return { repo, number: null, kind: `pull_request.${body.action}` };
  }
  return null;
}
