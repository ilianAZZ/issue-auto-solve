// Minimal history-API bridge so filters and the current page live in the URL instead of
// component state: reload and shared links then reproduce exactly what was on screen.
type Listener = () => void;

const listeners = new Set<Listener>();

window.addEventListener('popstate', () => listeners.forEach((listener) => listener()));

export function subscribeToLocation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface Location {
  pathname: string;
  search: string;
}

export function getLocation(): Location {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function navigate(url: string, { replace = false }: { replace?: boolean } = {}): void {
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  listeners.forEach((listener) => listener());
}
