// Usage: npm run create-admin -- "Full Name" admin@college.edu 'StrongPassword'
import { pool } from '../src/db.js';
import { hashPassword } from '../src/lib/password.js';

const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password || password.length < 8) {
  console.error('Usage: npm run create-admin -- "Full Name" email@example.com "password (8+ chars)"');
  process.exit(1);
}

try {
  const { rows } = await pool.query(
    `INSERT INTO users (role, name, email, password_hash) VALUES ('admin', $1, lower($2), $3)
     ON CONFLICT (lower(email)) DO UPDATE SET role = 'admin', name = EXCLUDED.name, password_hash = EXCLUDED.password_hash,
       is_active = TRUE, token_version = users.token_version + 1
     RETURNING id`,
    [name, email, await hashPassword(password)],
  );
  console.log(`Admin ${email} is ready (id ${rows[0].id}).`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
