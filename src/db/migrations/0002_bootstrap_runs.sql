CREATE TABLE IF NOT EXISTS bootstrap_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id      INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'running',
  instructions TEXT NOT NULL DEFAULT '',
  log_path     TEXT NOT NULL,
  result       TEXT,
  started_at   TEXT NOT NULL,
  ended_at     TEXT
);
