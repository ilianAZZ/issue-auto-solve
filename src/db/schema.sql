CREATE TABLE IF NOT EXISTS repos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL UNIQUE,
  enabled       INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  installation_id INTEGER,
  last_sync_at  TEXT,
  last_error    TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id            INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  number             INTEGER NOT NULL,
  title              TEXT NOT NULL DEFAULT '',
  url                TEXT NOT NULL DEFAULT '',
  labels_json        TEXT NOT NULL DEFAULT '[]',
  state              TEXT NOT NULL DEFAULT 'discovered',
  phase              TEXT,
  branch             TEXT,
  pr_url             TEXT,
  reason             TEXT,
  waiting_comment_id INTEGER,
  waiting_since      TEXT,
  run_count          INTEGER NOT NULL DEFAULT 0,
  issue_updated_at   TEXT,
  entered_state_at   TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (repo_id, number)
);

CREATE INDEX IF NOT EXISTS tasks_state_idx ON tasks (state, entered_state_at);

CREATE TABLE IF NOT EXISTS runs (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id                     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status                      TEXT NOT NULL DEFAULT 'running',
  phase                       TEXT,
  log_path                    TEXT NOT NULL,
  exit_code                   INTEGER,
  error                       TEXT,
  cost_usd                    REAL,
  duration_ms                 INTEGER,
  num_turns                   INTEGER,
  input_tokens                INTEGER,
  output_tokens               INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens     INTEGER,
  started_at                  TEXT NOT NULL,
  ended_at                    TEXT
);

CREATE INDEX IF NOT EXISTS runs_task_idx ON runs (task_id, started_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  run_id     INTEGER REFERENCES runs(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_task_idx ON events (task_id, id DESC);

CREATE TABLE IF NOT EXISTS bootstrap_runs (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id                     INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  status                      TEXT NOT NULL DEFAULT 'running',
  instructions                TEXT NOT NULL DEFAULT '',
  log_path                    TEXT NOT NULL,
  result                      TEXT,
  cost_usd                    REAL,
  duration_ms                 INTEGER,
  input_tokens                INTEGER,
  output_tokens               INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens     INTEGER,
  started_at                  TEXT NOT NULL,
  ended_at                    TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
