export type Vars = Record<string, string | number | boolean | null | undefined>;

const truthy = (value: unknown) => value !== undefined && value !== null && value !== false && value !== '';

export function render(template: string, vars: Vars): string {
  const withBlocks = template.replace(
    /\{\{#if\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key: string, body: string) => (truthy(vars[key]) ? body : ''),
  );
  return withBlocks
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
      const value = vars[key];
      return value === undefined || value === null ? '' : String(value);
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
