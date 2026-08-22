import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { builtinDefaults } from './defaults.js';
import { globalConfig, repoSettings, type GlobalConfig, type RepoSettings } from './schema.js';

type Plain = Record<string, unknown>;

const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

export function merge<T>(base: T, ...layers: Array<unknown>): T {
  return layers.reduce<unknown>((acc, layer) => {
    if (!isPlain(layer)) return layer === undefined || layer === null ? acc : layer;
    if (!isPlain(acc)) return layer;
    const out: Plain = { ...acc };
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      out[key] = isPlain(value) ? merge(out[key], value) : value;
    }
    return out;
  }, base) as T;
}

export function loadGlobalConfig(file: string): GlobalConfig {
  const raw = parse(readFileSync(file, 'utf8')) ?? {};
  const parsed = globalConfig.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`invalid ${file}:\n${details.join('\n')}`);
  }
  return parsed.data;
}

/**
 * `.issue-auto-solve.yml` lives in the repository being worked on, so anyone who can land a
 * commit there controls it — including the agent itself. Two knobs are therefore decided by
 * the operator only, never by that file: the Docker socket, which is root on the host, and
 * which environment variables may be forwarded into the container.
 */
export function resolveRepoSettings(
  config: GlobalConfig,
  entryOverrides: unknown,
  repoFile: string | null,
): RepoSettings {
  const inRepo = repoFile ? (parse(repoFile) ?? {}) : {};
  const operator = merge(builtinDefaults, config.defaults, entryOverrides) as RepoSettings;
  const merged = merge(builtinDefaults, config.defaults, entryOverrides, inRepo) as RepoSettings;
  merged.runtime.docker_socket = operator.runtime.docker_socket;
  merged.runtime.env = (merged.runtime.env ?? []).filter((name) => config.allow_env.includes(name));
  const parsed = repoSettings.safeParse(merged);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`invalid repository settings:\n${details.join('\n')}`);
  }
  return parsed.data;
}

export { builtinDefaults };
export * from './schema.js';
export * from './env.js';
