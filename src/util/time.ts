export const now = () => new Date().toISOString();

export function since(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Date.now() - new Date(iso).getTime();
}

export function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}
