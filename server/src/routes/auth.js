import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { clearAuthCookie, readAdminId, readStudentId, setAuthCookie } from '../lib/auth.js';
import { badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { dummyVerify, hashPassword, verifyPassword } from '../lib/password.js';
import { parse } from '../lib/validate.js';

export const authRouter = Router();

const limiterDefaults = { standardHeaders: 'draft-8', legacyHeaders: false };

// Keyed by IP + account so one shared campus IP does not lock everybody out,
// while repeated guessing against a single account is still stopped.
const loginLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 15 * 60 * 1000,
  limit: config.loginLimitPerAccount,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.identifier ?? req.body?.email ?? '').toLowerCase()}`,
  message: { error: 'Too many failed login attempts. Please wait 15 minutes and try again.' },
});

const registerLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 10 * 60 * 1000,
  limit: config.registerLimitPerIp,
  message: { error: 'Too many registrations from this network. Please try again in a few minutes.' },
});

export function toStudent(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    registerNo: row.register_no,
    phone: row.phone,
    departmentId: row.department_id,
    department: row.department_name,
    yearOfStudy: row.year_of_study,
    isBlocked: row.is_blocked,
    createdAt: row.created_at,
  };
}

export const STUDENT_SELECT = `
  SELECT s.*, d.name AS department_name
    FROM students s JOIN departments d ON d.id = s.department_id`;

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  registerNo: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Enter your register number')
    .max(40)
    .regex(/^[A-Z0-9/-]+$/, 'Register number can only contain letters, digits, "/" and "-"'),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\+?\d{10,15}$/, 'Enter a valid phone number (10–15 digits)')),
  departmentId: z.coerce.number().int().positive('Select your department'),
  yearOfStudy: z.coerce.number().int().min(1, 'Select your year').max(6),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

authRouter.post('/student/register', registerLimiter, async (req, res) => {
  const data = parse(registerSchema, req.body);
  const dept = await query('SELECT id FROM departments WHERE id = $1', [data.departmentId]);
  if (!dept.rows[0]) throw badRequest('departmentId: Select a valid department');
  const passwordHash = await hashPassword(data.password);
  const { rows } = await query(
    `INSERT INTO students (name, email, register_no, phone, department_id, year_of_study, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [data.name, data.email, data.registerNo, data.phone, data.departmentId, data.yearOfStudy, passwordHash],
  );
  const student = (await query(`${STUDENT_SELECT} WHERE s.id = $1`, [rows[0].id])).rows[0];
  setAuthCookie(res, 'student', student.id);
  res.status(201).json({ student: toStudent(student) });
});

const studentLoginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your register number or email').max(200),
  password: z.string().min(1, 'Enter your password').max(128),
});

authRouter.post('/student/login', loginLimiter, async (req, res) => {
  const { identifier, password } = parse(studentLoginSchema, req.body);
  const { rows } = await query(
    `${STUDENT_SELECT} WHERE lower(s.email) = lower($1) OR upper(s.register_no) = upper($1) LIMIT 1`,
    [identifier],
  );
  const student = rows[0];
  const ok = student ? await verifyPassword(password, student.password_hash) : await dummyVerify(password);
  if (!ok) throw unauthorized('Incorrect register number/email or password');
  if (student.is_blocked) throw forbidden('Your account has been blocked. Please contact the organisers.');
  setAuthCookie(res, 'student', student.id);
  res.json({ student: toStudent(student) });
});

authRouter.post('/student/logout', (req, res) => {
  clearAuthCookie(res, 'student');
  res.json({ ok: true });
});

authRouter.get('/student/me', async (req, res) => {
  const id = readStudentId(req);
  if (!id) return res.json({ student: null });
  const { rows } = await query(`${STUDENT_SELECT} WHERE s.id = $1`, [id]);
  if (!rows[0] || rows[0].is_blocked) {
    clearAuthCookie(res, 'student');
    return res.json({ student: null });
  }
  res.json({ student: toStudent(rows[0]) });
});

const adminLoginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').max(200),
  password: z.string().min(1, 'Enter your password').max(128),
});

authRouter.post('/admin/login', loginLimiter, async (req, res) => {
  const { email, password } = parse(adminLoginSchema, req.body);
  const { rows } = await query('SELECT * FROM admins WHERE lower(email) = lower($1)', [email]);
  const admin = rows[0];
  const ok = admin ? await verifyPassword(password, admin.password_hash) : await dummyVerify(password);
  if (!ok) throw unauthorized('Incorrect email or password');
  setAuthCookie(res, 'admin', admin.id);
  res.json({ admin: { id: admin.id, name: admin.name, email: admin.email } });
});

authRouter.post('/admin/logout', (req, res) => {
  clearAuthCookie(res, 'admin');
  res.json({ ok: true });
});

authRouter.get('/admin/me', async (req, res) => {
  const id = readAdminId(req);
  if (!id) return res.json({ admin: null });
  const { rows } = await query('SELECT id, name, email FROM admins WHERE id = $1', [id]);
  res.json({ admin: rows[0] ?? null });
});
