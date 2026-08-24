import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './index.js';
import { logger } from '../util/log.js';

const log = logger('db');

interface ColumnInfo {
  name: string;
}

function tableExists(db: Db, table: string): boolean {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
}

function columnExists(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[];
  return columns.some((c) => c.name === column);
}

/**
 * Databases created before this migration runner existed were shaped by an ad-hoc mix of
 * `CREATE TABLE IF NOT EXISTS` in schema.sql plus a hand-rolled column check in index.ts —
 * neither of which recorded what had actually been applied. This inspects the live schema
 * once to backfill schema_migrations for whichever of the migrations below already landed,
 * so they aren't (and can't be, since e.g. re-adding an existing column errors) replayed.
 * Every migration added after this one just goes through the normal runner below.
 */
function backfillPreExistingDatabase(db: Db, applied: (id: string, at: string) => void, at: string): void {
  if (!tableExists(db, 'tasks')) return;
  applied('0001_initial', at);
  if (tableExists(db, 'bootstrap_runs')) applied('0002_bootstrap_runs', at);
  if (columnExists(db, 'runs', 'cost_usd')) applied('0003_usage_tracking', at);
  if (columnExists(db, 'tasks', 'retry_at')) applied('0004_retry_at', at);
}

export function runMigrations(db: Db, migrationsDir: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id         TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const markApplied = (id: string, at: string) => {
    db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(id, at);
  };

  const alreadyTracked = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number };
  if (alreadyTracked.n === 0) {
    const before = new Set<string>();
    backfillPreExistingDatabase(db, (id, at) => { before.add(id); markApplied(id, at); }, new Date().toISOString());
    if (before.size > 0) log.info(`backfilled ${before.size} pre-existing migration(s): ${[...before].join(', ')}`);
  }

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((row) => row.id),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending = files.filter((f) => !applied.has(f.replace(/\.sql$/, '')));
  if (pending.length > 0) log.info(`running ${pending.length} pending migration(s): ${pending.join(', ')}`);

  for (const file of pending) {
    const id = file.replace(/\.sql$/, '');
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      markApplied(id, new Date().toISOString());
      db.exec('COMMIT');
      log.info(`applied migration ${file}`);
    } catch (err) {
      db.exec('ROLLBACK');
      log.error(`migration ${file} failed: ${(err as Error).message}`);
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
}
