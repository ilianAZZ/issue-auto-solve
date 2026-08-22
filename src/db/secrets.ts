import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Db } from './index.js';

/**
 * Credentials entered through the dashboard live here rather than in a .env the user has
 * to edit by hand. Encrypted at rest with a key generated on first boot: no worse than a
 * plain .env against someone with the disk, better against a stray `cat` or a screen share.
 */
export class SecretStore {
  private readonly key: Buffer;

  constructor(
    private readonly db: Db,
    keyFile: string,
  ) {
    mkdirSync(dirname(keyFile), { recursive: true });
    if (!existsSync(keyFile)) {
      writeFileSync(keyFile, randomBytes(32));
      chmodSync(keyFile, 0o600);
    }
    this.key = readFileSync(keyFile);
    this.db.exec('CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  set(key: string, value: string | null): void {
    if (value === null || value === '') {
      this.db.prepare('DELETE FROM secrets WHERE key = ?').run(key);
      return;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const payload = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const packed = [iv, cipher.getAuthTag(), payload].map((b) => b.toString('base64')).join('.');
    this.db
      .prepare('INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, packed);
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM secrets WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return null;
    const [iv, tag, payload] = row.value.split('.').map((part) => Buffer.from(part, 'base64'));
    if (!iv || !tag || !payload) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
