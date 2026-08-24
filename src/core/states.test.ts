import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, TERMINAL_STATES } from './states.js';

test('a merged pull request is reachable from every state a stalled task can be found in', () => {
  assert.ok(canTransition('pr_open', 'merged'));
  assert.ok(canTransition('skipped', 'merged'));
  assert.ok(canTransition('failed', 'merged'));
  assert.ok(canTransition('running', 'merged'));
  assert.ok(canTransition('discovered', 'merged'));
});

test('a pull request found open on GitHub can correct a stale skipped or failed task', () => {
  assert.ok(canTransition('skipped', 'pr_open'));
  assert.ok(canTransition('failed', 'pr_open'));
  assert.ok(canTransition('discovered', 'pr_open'));
});

test('merged can still be requeued by hand, matching the other terminal states', () => {
  assert.ok(canTransition('merged', 'discovered'));
});

test('merged is treated as terminal alongside pr_open and skipped', () => {
  assert.deepEqual(new Set(TERMINAL_STATES), new Set(['pr_open', 'merged', 'skipped']));
});
