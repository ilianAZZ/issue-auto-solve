import { emitError } from '../lib/errorBus';

// The dashboard token lives in an httpOnly cookie set by GET /login. Every other route
// requires it, so a 401 anywhere means the session is gone — the app switches to the
// login screen instead of failing each query independently.
const UNAUTHORIZED_EVENT = 'ias:unauthorized';

export function onUnauthorized(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit, opts?: { silent?: boolean }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    const message = 'Network error — could not reach the server.';
    if (!opts?.silent) emitError(message);
    throw new ApiError(message);
  }
  if (response.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    return new Promise<T>(() => {});
  }
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();
  if (!response.ok) {
    const message = (payload && typeof payload === 'object' && 'error' in payload && (payload as { error?: string }).error) || response.statusText;
    if (!opts?.silent) emitError(message);
    throw new ApiError(message);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, opts?: { silent?: boolean }) => request<T>(path, undefined, opts),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
