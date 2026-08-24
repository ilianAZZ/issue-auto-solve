import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.js';

export type Db = DatabaseSync;

export function openDatabase(file: string): Db {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  const here = dirname(fileURLToPath(import.meta.url));
  runMigrations(db, join(here, 'migrations'));
  return db;
}
