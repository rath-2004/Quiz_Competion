import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { sendCsv, toCsv } from '../../lib/csv.js';
import { notFound } from '../../lib/errors.js';
import { generatePassword, hashPassword } from '../../lib/password.js';
import { likePattern, pagination, parse, parseId } from '../../lib/validate.js';
import { STUDENT_SELECT, toStudent } from '../auth.js';

export const studentsRouter = Router();

function studentFilters(q) {
  const where = [];
  const params = [];
  const pattern = likePattern(q.search);
  if (pattern) {
    params.push(pattern);
    where.push(`(s.name ILIKE $${params.length} OR s.email ILIKE $${params.length}
                 OR s.register_no ILIKE $${params.length} OR s.phone ILIKE $${params.length})`);
  }
  if (q.departmentId) {
    params.push(parseId(q.departmentId, 'department'));
    where.push(`s.department_id = $${params.length}`);
  }
  if (q.year) {
    params.push(Number.parseInt(q.year, 10) || 0);
    where.push(`s.year_of_study = $${params.length}`);
  }
  if (q.status === 'blocked') where.push('s.is_blocked');
  if (q.status === 'active') where.push('NOT s.is_blocked');
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

studentsRouter.get('/students', async (req, res) => {
  const { page, pageSize, offset } = pagination(req.query);
  const filter = studentFilters(req.query);
  const n = filter.params.length;
  const [list, count] = await Promise.all([
    query(`${STUDENT_SELECT} ${filter.sql} ORDER BY s.created_at DESC, s.id DESC LIMIT $${n + 1} OFFSET $${n + 2}`, [
      ...filter.params,
      pageSize,
      offset,
    ]),
    query(`SELECT COUNT(*) AS total FROM students s ${filter.sql}`, filter.params),
  ]);
  res.json({ items: list.rows.map(toStudent), total: count.rows[0].total, page, pageSize });
});

studentsRouter.get('/students/export.csv', async (req, res) => {
  const filter = studentFilters(req.query);
  const { rows } = await query(`${STUDENT_SELECT} ${filter.sql} ORDER BY d.name, s.year_of_study, s.name`, filter.params);
  const csv = toCsv(rows, [
    { header: 'Register No', value: (r) => r.register_no },
    { header: 'Name', value: (r) => r.name },
    { header: 'Email', value: (r) => r.email },
    { header: 'Phone', value: (r) => r.phone },
    { header: 'Department', value: (r) => r.department_name },
    { header: 'Year', value: (r) => r.year_of_study },
    { header: 'Status', value: (r) => (r.is_blocked ? 'Blocked' : 'Active') },
    { header: 'Registered At', value: (r) => r.created_at },
  ]);
  sendCsv(res, 'students.csv', csv);
});

studentsRouter.get('/students/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await query(`${STUDENT_SELECT} WHERE s.id = $1`, [id]);
  if (!rows[0]) throw notFound('Student not found');
  const attempts = await query(
    `SELECT c.id AS "competitionId", c.title, r.registered_at AS "registeredAt",
            a.id AS "attemptId", a.status, a.started_at AS "startedAt", a.submitted_at AS "submittedAt",
            a.score, a.max_score AS "maxScore", a.tab_switches AS "tabSwitches"
       FROM registrations r
       JOIN competitions c ON c.id = r.competition_id
       LEFT JOIN attempts a ON a.competition_id = r.competition_id AND a.student_id = r.student_id
      WHERE r.student_id = $1
      ORDER BY c.starts_at DESC`,
    [id],
  );
  res.json({ student: toStudent(rows[0]), competitions: attempts.rows });
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  registerNo: z.string().trim().toUpperCase().min(2).max(40),
  phone: z.string().trim().min(7).max(20),
  departmentId: z.coerce.number().int().positive(),
  yearOfStudy: z.coerce.number().int().min(1).max(6),
});

studentsRouter.put('/students/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const d = parse(updateSchema, req.body);
  const { rowCount } = await query(
    `UPDATE students SET name = $2, email = $3, register_no = $4, phone = $5, department_id = $6, year_of_study = $7
      WHERE id = $1`,
    [id, d.name, d.email, d.registerNo, d.phone, d.departmentId, d.yearOfStudy],
  );
  if (!rowCount) throw notFound('Student not found');
  const { rows } = await query(`${STUDENT_SELECT} WHERE s.id = $1`, [id]);
  res.json({ student: toStudent(rows[0]) });
});

studentsRouter.post('/students/:id/block', async (req, res) => {
  const id = parseId(req.params.id);
  const { blocked } = parse(z.object({ blocked: z.boolean() }), req.body);
  const { rowCount } = await query('UPDATE students SET is_blocked = $2 WHERE id = $1', [id, blocked]);
  if (!rowCount) throw notFound('Student not found');
  res.json({ ok: true, blocked });
});

studentsRouter.post('/students/:id/reset-password', async (req, res) => {
  const id = parseId(req.params.id);
  const password = generatePassword();
  const { rowCount } = await query('UPDATE students SET password_hash = $2 WHERE id = $1', [
    id,
    await hashPassword(password),
  ]);
  if (!rowCount) throw notFound('Student not found');
  res.json({ temporaryPassword: password });
});

studentsRouter.delete('/students/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { rowCount } = await query('DELETE FROM students WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Student not found');
  res.json({ ok: true });
});
