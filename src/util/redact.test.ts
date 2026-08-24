import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactStream } from './redact.js';

function run(secrets: string[], chunks: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = redactStream(secrets);
    let output = '';
    stream.on('data', (chunk) => (output += chunk.toString('utf8')));
    stream.on('end', () => resolve(output));
    stream.on('error', reject);
    for (const chunk of chunks) stream.write(chunk);
    stream.end();
  });
}

test('redacts a secret contained in a single chunk', async () => {
  const output = await run(['sekrit-token'], ['before sekrit-token after']);
  assert.equal(output, 'before [redacted] after');
});

test('redacts a secret split across chunk boundaries', async () => {
  const secret = 'sekrit-token-value';
  const output = await run([secret], ['prefix sekr', 'it-token-value suffix']);
  assert.equal(output, 'prefix [redacted] suffix');
});

test('ignores secrets shorter than 8 characters', async () => {
  const output = await run(['short'], ['this has short in it']);
  assert.equal(output, 'this has short in it');
});

test('passes text through untouched when there are no secrets', async () => {
  const output = await run([], ['nothing to hide here']);
  assert.equal(output, 'nothing to hide here');
});
