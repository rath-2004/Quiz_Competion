import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Applies pending SQL migrations in filename order. Safe to run from several processes at once. */
export async function migrate({ log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`Applied migration ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}

export async function ensureAdmin({ name, email, password }, { log = console.log } = {}) {
  const { hashPassword } = await import('./lib/password.js');
  const existing = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing.rowCount) return false;
  await pool.query(
    "INSERT INTO users (role, name, email, password_hash) VALUES ('admin', $1, $2, $3)",
    [name, email, await hashPassword(password)],
  );
  log(`Created admin account ${email}`);
  return true;
}
