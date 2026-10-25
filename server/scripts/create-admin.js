// Usage: npm run create-admin -- --email admin@college.edu --password "S3cret-pass" [--name "Quiz Admin"]
// Running it again for an existing email resets that admin's password.
import { parseArgs } from 'node:util';
import { migrate } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';
import { createAdmin } from '../src/services/admins.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string', default: 'Administrator' },
  },
});

if (!values.email || !values.password) {
  console.error('Usage: npm run create-admin -- --email <email> --password <password> [--name <name>]');
  process.exit(1);
}

try {
  await migrate();
  const admin = await createAdmin(values);
  console.log(`Admin ready: ${admin.email}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
