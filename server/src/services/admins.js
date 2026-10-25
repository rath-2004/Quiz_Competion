import { config } from '../config.js';
import { query } from '../db/pool.js';
import { hashPassword } from '../lib/password.js';

export async function createAdmin({ name, email, password }) {
  if (!email || !password) throw new Error('Admin email and password are required');
  if (password.length < 8) throw new Error('Admin password must be at least 8 characters');
  const { rows } = await query(
    `INSERT INTO admins (name, email, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT ((lower(email))) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
     RETURNING id, name, email`,
    [name || 'Administrator', email.trim().toLowerCase(), await hashPassword(password)],
  );
  return rows[0];
}

/** On first start, creates the admin named by ADMIN_EMAIL / ADMIN_PASSWORD if no admin exists yet. */
export async function bootstrapAdmin(log = console.log) {
  const { rows } = await query('SELECT COUNT(*) AS n FROM admins');
  if (rows[0].n > 0) return;
  if (!config.admin.email || !config.admin.password) {
    log('No admin account exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD, or run: npm run create-admin');
    return;
  }
  const admin = await createAdmin(config.admin);
  log(`Created admin account ${admin.email}`);
}
