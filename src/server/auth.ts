import { timingSafeEqual } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const COOKIE = 'ias_session';
const PUBLIC_PATHS = new Set(['/', '/index.html', '/style.css', '/app.js', '/favicon.ico']);

export function resolveDashboardToken(fromEnv: string | undefined, tokenFile: string): string {
  if (fromEnv) return fromEnv;
  if (!existsSync(tokenFile)) {
    mkdirSync(dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, randomBytes(24).toString('hex'));
    chmodSync(tokenFile, 0o600);
  }
  return readFileSync(tokenFile, 'utf8').trim();
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function presented(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === COOKIE);
  if (cookie?.[1]) return decodeURIComponent(cookie[1]);
  const query = (request.query as { token?: string } | undefined)?.token;
  return query ?? null;
}

/**
 * The dashboard can add repositories, replace credentials and read run logs, so it is never
 * left open. A token is generated on first boot and printed once; everything but the static
 * shell and the signature-checked webhook requires it.
 */
export function registerAuth(app: FastifyInstance, token: string, secure: boolean): void {
  app.get<{ Querystring: { token?: string } }>('/login', async (request, reply: FastifyReply) => {
    if (!request.query.token || !equal(request.query.token, token)) {
      return reply.code(401).type('text/plain').send('invalid token');
    }
    const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=31536000', secure ? 'Secure' : '']
      .filter(Boolean)
      .join('; ');
    return reply.header('set-cookie', `${COOKIE}=${encodeURIComponent(token)}; ${attributes}`).redirect('/');
  });

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    if (path === '/webhooks/github' || path === '/login' || PUBLIC_PATHS.has(path)) return;
    const supplied = presented(request);
    if (!supplied || !equal(supplied, token)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });
}
