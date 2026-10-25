import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { conflict, notFound } from '../../lib/errors.js';
import { parse, parseId } from '../../lib/validate.js';

export const departmentsRouter = Router();

const departmentSchema = z.object({
  name: z.string().trim().min(2, 'Enter the department name').max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Enter a short code, e.g. CSE')
    .max(20)
    .regex(/^[A-Z0-9&.-]+$/, 'Code can only contain letters, digits, "&", "." and "-"'),
});

departmentsRouter.get('/departments', async (req, res) => {
  const { rows } = await query(
    `SELECT d.id, d.name, d.code, d.created_at AS "createdAt", COUNT(s.id) AS students
       FROM departments d LEFT JOIN students s ON s.department_id = d.id
      GROUP BY d.id ORDER BY d.name`,
  );
  res.json({ departments: rows });
});

departmentsRouter.post('/departments', async (req, res) => {
  const { name, code } = parse(departmentSchema, req.body);
  const { rows } = await query('INSERT INTO departments (name, code) VALUES ($1, $2) RETURNING id, name, code', [
    name,
    code,
  ]);
  res.status(201).json({ department: rows[0] });
});

departmentsRouter.put('/departments/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { name, code } = parse(departmentSchema, req.body);
  const { rows } = await query('UPDATE departments SET name = $2, code = $3 WHERE id = $1 RETURNING id, name, code', [
    id,
    name,
    code,
  ]);
  if (!rows[0]) throw notFound('Department not found');
  res.json({ department: rows[0] });
});

departmentsRouter.delete('/departments/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await query('SELECT COUNT(*) AS n FROM students WHERE department_id = $1', [id]);
  if (rows[0].n > 0) throw conflict(`This department has ${rows[0].n} registered student(s) and cannot be deleted`);
  const { rowCount } = await query('DELETE FROM departments WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Department not found');
  res.json({ ok: true });
});
