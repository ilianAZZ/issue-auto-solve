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

// useSyncExternalStore compares snapshots by reference, so this must keep returning the
// same object as long as the URL hasn't actually changed, or React re-renders forever.
let cached: Location = { pathname: window.location.pathname, search: window.location.search };

export function getLocation(): Location {
  const { pathname, search } = window.location;
  if (cached.pathname !== pathname || cached.search !== search) {
    cached = { pathname, search };
  }
  return cached;
}

export function navigate(url: string, { replace = false }: { replace?: boolean } = {}): void {
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  listeners.forEach((listener) => listener());
}
