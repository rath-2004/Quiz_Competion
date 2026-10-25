import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { ensureAdmin, migrate } from '../src/migrate.js';

try {
  await migrate();
  if (config.admin.password) await ensureAdmin(config.admin);
  else console.log('ADMIN_PASSWORD not set; skipping default admin creation (use `npm run create-admin`).');
  console.log('Database is up to date.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
