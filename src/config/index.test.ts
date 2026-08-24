import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conflictingPaths, resolveRepoSettings } from './index.js';
import { globalConfig } from './schema.js';

const baseGlobalConfig = globalConfig.parse({});

test('conflictingPaths reports leaf keys set on both sides with different values', () => {
  const a = { base_branch: 'dev', runtime: { setup: ['a'] } };
  const b = { base_branch: 'main', runtime: { setup: ['a'] } };
  assert.deepEqual(conflictingPaths(a, b), ['base_branch']);
});

test('conflictingPaths ignores keys only set on one side, or equal on both', () => {
  const a = { base_branch: 'dev', only_a: 1 };
  const b = { base_branch: 'dev', only_b: 2 };
  assert.deepEqual(conflictingPaths(a, b), []);
});

test('resolveRepoSettings: repo file overrides dashboard settings for the same key', () => {
  const entryOverrides = { base_branch: 'dev' };
  const repoFile = 'base_branch: main\n';
  const settings = resolveRepoSettings(baseGlobalConfig, entryOverrides, repoFile, 'owner/repo');
  assert.equal(settings.base_branch, 'main');
});

test('resolveRepoSettings: dashboard setting applies when the repo file is absent', () => {
  const settings = resolveRepoSettings(baseGlobalConfig, { base_branch: 'dev' }, null, 'owner/repo');
  assert.equal(settings.base_branch, 'dev');
});
