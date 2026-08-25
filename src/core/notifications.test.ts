import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingTargets, type NotificationRule } from './notifications.js';

const discord = { type: 'discord' as const, url: 'https://discord.example/hook' };
const webhook = { type: 'webhook' as const, url: 'https://hooks.example/hook' };

function rule(overrides: Partial<NotificationRule>): NotificationRule {
  return { id: 1, name: 'rule', enabled: true, repos: [], statuses: [], targets: [discord], ...overrides };
}

test('a rule with empty repos and statuses matches anything', () => {
  const targets = matchingTargets([rule({})], 'acme/breem', 'pr_open');
  assert.deepEqual(targets, [discord]);
});

test('a rule scoped to a repo does not fire for another repo', () => {
  const targets = matchingTargets([rule({ repos: ['acme/other'] })], 'acme/breem', 'pr_open');
  assert.deepEqual(targets, []);
});

test('a rule scoped to a status does not fire for another status', () => {
  const targets = matchingTargets([rule({ statuses: ['merged'] })], 'acme/breem', 'pr_open');
  assert.deepEqual(targets, []);
});

test('a disabled rule never fires', () => {
  const targets = matchingTargets([rule({ enabled: false })], 'acme/breem', 'pr_open');
  assert.deepEqual(targets, []);
});

test('the same target is only returned once even if two matching rules both list it', () => {
  const rules = [rule({ id: 1, repos: ['acme/breem'] }), rule({ id: 2, statuses: ['pr_open'] })];
  const targets = matchingTargets(rules, 'acme/breem', 'pr_open');
  assert.deepEqual(targets, [discord]);
});

test('targets from every matching rule are combined', () => {
  const rules = [rule({ id: 1, targets: [discord] }), rule({ id: 2, targets: [webhook] })];
  const targets = matchingTargets(rules, 'acme/breem', 'pr_open');
  assert.deepEqual(targets, [discord, webhook]);
});
