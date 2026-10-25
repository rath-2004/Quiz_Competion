import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config.js';
import { one } from '../db.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { loginSchema, password, registerSchema, studentProfileSchema, validate, z } from '../lib/validate.js';
import { authenticate, clearAuthCookie, setAuthCookie, signToken } from '../middleware/auth.js';

const router = Router();

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const skip = () => config.isTest;

// Keyed on email + IP: a whole college lab behind one NAT IP must still be able to log in at once.
const loginLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: config.loginRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email || '').toLowerCase()}`,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
});

const registerLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: config.registerRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  message: { error: 'Too many registrations from this network. Please try again later.' },
});

const PUBLIC_USER_FIELDS =
  'id, role, name, email, phone, college, department, year_of_study, roll_number, is_active, token_version, created_at';

function publicUser(u) {
  const { token_version: _tv, ...rest } = u;
  return rest;
}

function uniqueViolation(err) {
  if (err.code !== '23505') return null;
  if (err.constraint === 'users_email_uq') return conflict('An account with this email already exists');
  if (err.constraint === 'users_college_roll_uq') return conflict('This roll number is already registered for this college');
  return conflict('Duplicate entry');
}

router.post('/register', registerLimiter, async (req, res) => {
  const data = validate(registerSchema, req.body);
  const passwordHash = await hashPassword(data.password);
  let user;
  try {
    user = await one(
      `INSERT INTO users (role, name, email, phone, college, department, year_of_study, roll_number, password_hash)
       VALUES ('student', $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${PUBLIC_USER_FIELDS}`,
      [data.name, data.email, data.phone, data.college, data.department, data.year_of_study ?? null, data.roll_number, passwordHash],
    );
  } catch (err) {
    throw uniqueViolation(err) ?? err;
  }
  const token = signToken(user);
  setAuthCookie(res, token);
  res.status(201).json({ user: publicUser(user), token });
});

router.post('/login', loginLimiter, async (req, res) => {
  const data = validate(loginSchema, req.body);
  const user = await one(`SELECT ${PUBLIC_USER_FIELDS}, password_hash FROM users WHERE lower(email) = $1`, [data.email]);
  if (!user || !(await verifyPassword(data.password, user.password_hash))) {
    throw unauthorized('Invalid email or password');
  }
  if (!user.is_active) throw unauthorized('Your account has been disabled. Contact the organisers.');
  const { password_hash: _ph, ...rest } = user;
  const token = signToken(rest);
  setAuthCookie(res, token);
  res.json({ user: publicUser(rest), token });
});

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', authenticate, async (req, res) => {
  const user = await one(`SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = $1`, [req.user.id]);
  res.json({ user: publicUser(user) });
});

router.put('/me', authenticate, async (req, res) => {
  if (req.user.role !== 'student') throw badRequest('Only student profiles can be edited here');
  const data = validate(studentProfileSchema, req.body);
  let user;
  try {
    user = await one(
      `UPDATE users SET name = $1, phone = $2, college = $3, department = $4, year_of_study = $5, roll_number = $6, updated_at = now()
        WHERE id = $7 RETURNING ${PUBLIC_USER_FIELDS}`,
      [data.name, data.phone, data.college, data.department, data.year_of_study ?? null, data.roll_number, req.user.id],
    );
  } catch (err) {
    throw uniqueViolation(err) ?? err;
  }
  res.json({ user: publicUser(user) });
});

router.post('/change-password', authenticate, async (req, res) => {
  const data = validate(z.object({ currentPassword: z.string().min(1), newPassword: password }), req.body);
  const row = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(data.currentPassword, row.password_hash))) throw badRequest('Current password is incorrect');
  const user = await one(
    `UPDATE users SET password_hash = $1, token_version = token_version + 1, updated_at = now()
      WHERE id = $2 RETURNING ${PUBLIC_USER_FIELDS}`,
    [await hashPassword(data.newPassword), req.user.id],
  );
  // Other sessions are signed out; this one gets a fresh token.
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ ok: true, token });
});

export { uniqueViolation, PUBLIC_USER_FIELDS, publicUser };
export default router;
