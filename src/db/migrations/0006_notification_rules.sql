CREATE TABLE IF NOT EXISTS notification_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  repos_json    TEXT NOT NULL DEFAULT '[]',
  statuses_json TEXT NOT NULL DEFAULT '[]',
  targets_json  TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
