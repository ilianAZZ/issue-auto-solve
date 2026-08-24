import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { interpret, verifySignature } from './webhook.js';

test('interpret returns null when the payload has no repository', () => {
  assert.equal(interpret('issues', {}), null);
});

test('interpret recognizes a new issue comment', () => {
  const hint = interpret('issue_comment', {
    action: 'created',
    repository: { full_name: 'owner/repo' },
    issue: { number: 7 },
  });
  assert.deepEqual(hint, { repo: 'owner/repo', number: 7, kind: 'comment' });
});

test('interpret recognizes a labeled issue', () => {
  const hint = interpret('issues', {
    action: 'labeled',
    repository: { full_name: 'owner/repo' },
    issue: { number: 3 },
  });
  assert.deepEqual(hint, { repo: 'owner/repo', number: 3, kind: 'issue.labeled' });
});

test('interpret ignores unrelated events', () => {
  const hint = interpret('star', {
    action: 'created',
    repository: { full_name: 'owner/repo' },
  });
  assert.equal(hint, null);
});

test('verifySignature rejects a missing signature', () => {
  assert.equal(verifySignature('secret', 'payload', undefined), false);
});

test('verifySignature accepts a matching signature', () => {
  const payload = '{"hello":"world"}';
  const signature = `sha256=${createHmac('sha256', 'secret').update(payload).digest('hex')}`;
  assert.equal(verifySignature('secret', payload, signature), true);
});

test('verifySignature rejects a tampered payload', () => {
  const payload = '{"hello":"world"}';
  const signature = `sha256=${createHmac('sha256', 'secret').update(payload).digest('hex')}`;
  assert.equal(verifySignature('secret', '{"hello":"tampered"}', signature), false);
});
