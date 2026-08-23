// Single channel for anything that should surface as the app's global error banner:
// API failures (from api/client.ts) and uncaught JS errors/rejections (from main.tsx).
const ERROR_EVENT = 'ias:error';

export function emitError(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(ERROR_EVENT, { detail: message }));
}

export function onError(callback: (message: string) => void): () => void {
  const handler = (e: Event) => callback((e as CustomEvent<string>).detail);
  window.addEventListener(ERROR_EVENT, handler);
  return () => window.removeEventListener(ERROR_EVENT, handler);
}
