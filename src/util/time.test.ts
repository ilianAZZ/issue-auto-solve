import { test } from 'node:test';
import assert from 'node:assert/strict';
import { since, slug } from './time.js';

test('slug lowercases and dashes non-alphanumeric runs', () => {
  assert.equal(slug('Fix Auth Bug #42!'), 'fix-auth-bug-42');
});

test('slug trims leading and trailing dashes', () => {
  assert.equal(slug('  --Weird Input--  '), 'weird-input');
});

test('since returns 0 for missing timestamps', () => {
  assert.equal(since(null), 0);
  assert.equal(since(undefined), 0);
});

test('since returns a positive elapsed time for a past timestamp', () => {
  const past = new Date(Date.now() - 1000).toISOString();
  assert.ok(since(past) >= 1000);
});
