import type { RepoSettings } from './schema.js';

export const builtinDefaults: RepoSettings = {
  base_branch: 'main',
  branch_pattern: 'agent/issue-{{number}}',
  config_path: '.issue-auto-solve.yml',
  labels: { exclude: [], waiting: 'needs-human-input' },
  selection: {
    order: 'oldest',
    priority_labels: [],
    require_label: null,
    trusted_associations: [],
    whitelist_users: [],
    blacklist_users: [],
    check_tags: false,
    whitelist_tags: [],
    blacklist_tags: [],
  },
  limits: { max_concurrent_runs: 1, timeout_minutes: 45, max_runs_per_task: 2 },
  runtime: { image: 'node:24-slim', docker_socket: false, env: [], setup: [], writable_paths: [] },
  preflight: [],
  checks: [],
  prompt: { file: null, variables: {} },
};
