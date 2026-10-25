import { Router } from 'express';
import { many, one, query, transaction } from '../../db.js';
import { parseCsv, sendCsv, toCsv } from '../../lib/csv.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { paginationSchema, password, registerSchema, studentProfileSchema, validate, z } from '../../lib/validate.js';
import { PUBLIC_USER_FIELDS, publicUser, uniqueViolation } from '../auth.js';

const router = Router();
const idParam = (req) => validate(z.coerce.number().int().positive(), req.params.id);

const listSchema = paginationSchema.extend({
  college: z.string().trim().max(200).optional().default(''),
  status: z.enum(['', 'active', 'blocked']).optional().default(''),
});

function buildFilter({ q, college, status }) {
  const where = ["u.role = 'student'"];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where.push(`(u.name ILIKE ${p} OR u.email ILIKE ${p} OR u.roll_number ILIKE ${p} OR u.phone ILIKE ${p} OR u.college ILIKE ${p})`);
  }
  if (college) {
    params.push(college);
    where.push(`u.college = $${params.length}`);
  }
  if (status) where.push(status === 'active' ? 'u.is_active' : 'NOT u.is_active');
  return { where: `WHERE ${where.join(' AND ')}`, params };
}

router.get('/', async (req, res) => {
  const opts = validate(listSchema, req.query);
  const { where, params } = buildFilter(opts);
  const [items, total] = await Promise.all([
    many(
      `SELECT ${PUBLIC_USER_FIELDS.split(', ').map((f) => `u.${f}`).join(', ')},
              (SELECT COUNT(*) FROM registrations r WHERE r.user_id = u.id) AS registrations,
              (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id AND a.status = 'submitted') AS completed
         FROM users u ${where}
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.pageSize, (opts.page - 1) * opts.pageSize],
    ),
    one(`SELECT COUNT(*) AS n FROM users u ${where}`, params),
  ]);
  res.json({ items: items.map(publicUser), total: total.n, page: opts.page, pageSize: opts.pageSize });
});

router.get('/colleges', async (_req, res) => {
  res.json({
    colleges: await many(
      `SELECT college, COUNT(*) AS count FROM users WHERE role = 'student' AND college IS NOT NULL
        GROUP BY college ORDER BY count DESC, college`,
    ),
  });
});

router.get('/export', async (req, res) => {
  const opts = validate(listSchema.omit({ page: true, pageSize: true }), req.query);
  const { where, params } = buildFilter(opts);
  const rows = await many(`SELECT u.* FROM users u ${where} ORDER BY u.college, u.name`, params);
  const columns = [
    { header: 'name', key: 'name' },
    { header: 'email', key: 'email' },
    { header: 'phone', key: 'phone' },
    { header: 'college', key: 'college' },
    { header: 'department', key: 'department' },
    { header: 'year', key: 'year_of_study' },
    { header: 'roll_number', key: 'roll_number' },
    { header: 'status', value: (r) => (r.is_active ? 'active' : 'blocked') },
    { header: 'registered_on', key: 'created_at' },
  ];
  sendCsv(res, 'students.csv', toCsv(columns, rows));
});

router.get('/:id', async (req, res) => {
  const id = idParam(req);
  const student = await one(`SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = $1 AND role = 'student'`, [id]);
  if (!student) throw notFound('Student not found');
  const competitions = await many(
    `SELECT c.id, c.title, c.start_time, c.end_time, r.registered_at,
            a.status, a.started_at, a.submitted_at, a.score, a.max_score, a.correct_count, a.wrong_count,
            a.unanswered_count, a.tab_switches, a.auto_submitted
       FROM registrations r JOIN competitions c ON c.id = r.competition_id
       LEFT JOIN attempts a ON a.competition_id = r.competition_id AND a.user_id = r.user_id
      WHERE r.user_id = $1
      ORDER BY c.start_time DESC`,
    [id],
  );
  res.json({ student: publicUser(student), competitions });
});

router.post('/', async (req, res) => {
  const data = validate(registerSchema, req.body);
  try {
    const student = await one(
      `INSERT INTO users (role, name, email, phone, college, department, year_of_study, roll_number, password_hash)
       VALUES ('student', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${PUBLIC_USER_FIELDS}`,
      [data.name, data.email, data.phone, data.college, data.department, data.year_of_study ?? null, data.roll_number,
        await hashPassword(data.password)],
    );
    res.status(201).json({ student: publicUser(student) });
  } catch (err) {
    throw uniqueViolation(err) ?? err;
  }
});

router.put('/:id', async (req, res) => {
  const id = idParam(req);
  const data = validate(studentProfileSchema.extend({ email: registerSchema.shape.email }), req.body);
  try {
    const student = await one(
      `UPDATE users SET name = $1, email = $2, phone = $3, college = $4, department = $5, year_of_study = $6,
              roll_number = $7, updated_at = now()
        WHERE id = $8 AND role = 'student' RETURNING ${PUBLIC_USER_FIELDS}`,
      [data.name, data.email, data.phone, data.college, data.department, data.year_of_study ?? null, data.roll_number, id],
    );
    if (!student) throw notFound('Student not found');
    res.json({ student: publicUser(student) });
  } catch (err) {
    throw uniqueViolation(err) ?? err;
  }
});

router.patch('/:id/status', async (req, res) => {
  const { is_active } = validate(z.object({ is_active: z.boolean() }), req.body);
  // Bumping token_version signs a blocked student out everywhere immediately.
  const student = await one(
    `UPDATE users SET is_active = $1, token_version = token_version + CASE WHEN $1 THEN 0 ELSE 1 END, updated_at = now()
      WHERE id = $2 AND role = 'student' RETURNING ${PUBLIC_USER_FIELDS}`,
    [is_active, idParam(req)],
  );
  if (!student) throw notFound('Student not found');
  res.json({ student: publicUser(student) });
});

router.post('/:id/reset-password', async (req, res) => {
  const { password: newPassword } = validate(z.object({ password }), req.body);
  const student = await one(
    `UPDATE users SET password_hash = $1, token_version = token_version + 1, updated_at = now()
      WHERE id = $2 AND role = 'student' RETURNING id`,
    [await hashPassword(newPassword), idParam(req)],
  );
  if (!student) throw notFound('Student not found');
  res.json({ reset: true });
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await query("DELETE FROM users WHERE id = $1 AND role = 'student'", [idParam(req)]);
  if (!rowCount) throw notFound('Student not found');
  res.json({ deleted: true });
});

const importSchema = z.object({
  csv: z.string().max(10 * 1024 * 1024),
  defaultPassword: password.optional(),
  competitionId: z.number().int().positive().nullable().optional(),
});

/** Hashes with bounded concurrency; scrypt is memory-hungry, so don't queue thousands at once. */
async function hashAll(passwords, concurrency = 8) {
  const out = new Array(passwords.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < passwords.length) {
        const i = next++;
        out[i] = await hashPassword(passwords[i]);
      }
    }),
  );
  return out;
}

/**
 * Bulk-creates students from CSV (name, email, phone, college, department, year, roll_number, password).
 * Rows without a password get defaultPassword. Existing emails / roll numbers are skipped, not overwritten.
 */
router.post('/import', async (req, res) => {
  const { csv, defaultPassword, competitionId } = validate(importSchema, req.body);
  const rows = parseCsv(csv);
  if (rows.length > 20000) throw badRequest('Import at most 20,000 students at a time');

  const valid = [];
  const errors = [];
  const seenEmails = new Set();
  rows.forEach((row, i) => {
    const input = {
      name: row.name ?? row.full_name ?? row.student_name ?? '',
      email: row.email ?? row.email_id ?? '',
      phone: row.phone ?? row.mobile ?? row.phone_number ?? null,
      college: row.college ?? row.college_name ?? row.institution ?? '',
      department: row.department ?? row.branch ?? row.dept ?? null,
      year_of_study: row.year ?? row.year_of_study ? Number(row.year ?? row.year_of_study) : null,
      roll_number: row.roll_number ?? row.roll_no ?? row.roll ?? row.registration_number ?? row.reg_no ?? '',
      password: row.password || defaultPassword || '',
    };
    try {
      const data = validate(registerSchema, input);
      if (seenEmails.has(data.email)) throw new Error('Duplicate email within the file');
      seenEmails.add(data.email);
      valid.push({ ...data, ownPassword: Boolean(row.password) });
    } catch (err) {
      errors.push({ row: i + 2, message: err.message.startsWith('password') && !defaultPassword ? 'password: missing — set a default password' : err.message });
    }
  });

  // Everyone without their own password shares the default, so hash it once.
  const sharedHash = defaultPassword ? await hashPassword(defaultPassword) : null;
  const own = valid.filter((v) => v.ownPassword);
  const ownHashes = await hashAll(own.map((v) => v.password));
  own.forEach((v, i) => {
    v.password_hash = ownHashes[i];
  });
  for (const v of valid) if (!v.ownPassword) v.password_hash = sharedHash;

  const result = await transaction(async (db) => {
    if (competitionId) {
      const c = await db.query('SELECT 1 FROM competitions WHERE id = $1', [competitionId]);
      if (!c.rowCount) throw notFound('Competition not found');
    }
    const records = valid.map(({ name, email, phone, college, department, year_of_study, roll_number, password_hash }) => ({
      name, email, phone, college, department, year_of_study: year_of_study ?? null, roll_number, password_hash,
    }));
    const { rows: inserted } = await db.query(
      `INSERT INTO users (role, name, email, phone, college, department, year_of_study, roll_number, password_hash)
       SELECT 'student', name, email, phone, college, department, year_of_study, roll_number, password_hash
         FROM jsonb_to_recordset($1::jsonb) AS x(name text, email text, phone text, college text, department text,
              year_of_study smallint, roll_number text, password_hash text)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [JSON.stringify(records)],
    );
    let registered = 0;
    if (competitionId && valid.length) {
      // Register both new and already-existing students from the file.
      const reg = await db.query(
        `INSERT INTO registrations (competition_id, user_id)
         SELECT $1, id FROM users WHERE role = 'student' AND lower(email) = ANY($2::text[])
         ON CONFLICT DO NOTHING`,
        [competitionId, valid.map((v) => v.email)],
      );
      registered = reg.rowCount;
    }
    return { inserted: inserted.length, registered };
  });

  res.json({
    inserted: result.inserted,
    skipped: valid.length - result.inserted,
    registered: result.registered,
    failed: errors.length,
    errors: errors.slice(0, 200),
  });
});

export default router;
