import { Transform } from 'node:stream';

/**
 * Container output is written to a log file the dashboard serves. Anything the agent
 * echoes — `git remote -v` alone is enough — would carry the installation token with it.
 *
 * Scrub first, then hold back the last (longest - 1) characters: a secret can only ever be
 * completed by the next chunk if what we already have is a *suffix* of the buffer, so that
 * tail is the only thing worth keeping. Emitting first and scrubbing the boundary later
 * would split a token across two writes and let it through.
 */
export function redactStream(secrets: string[]): Transform {
  const values = [...new Set(secrets.filter((value) => value && value.length >= 8))];
  if (!values.length) return new Transform({ transform: (chunk, _e, done) => done(null, chunk) });

  const longest = values.reduce((max, value) => Math.max(max, value.length), 0);
  const scrub = (text: string) => values.reduce((acc, value) => acc.split(value).join('[redacted]'), text);
  let carry = '';

  return new Transform({
    transform(chunk, _encoding, done) {
      const text = scrub(carry + chunk.toString('utf8'));
      const keep = Math.min(longest - 1, text.length);
      carry = text.slice(text.length - keep);
      done(null, text.slice(0, text.length - keep));
    },
    flush(done) {
      done(null, scrub(carry));
    },
  });
}
