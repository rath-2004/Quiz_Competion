import { migrate } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';

try {
  await migrate();
  console.log('Database is up to date');
} finally {
  await pool.end();
}
