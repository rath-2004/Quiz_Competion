import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { unauthorized } from './errors.js';

const COOKIES = { student: 'qc_student', admin: 'qc_admin' };
const TTL_SECONDS = { student: 12 * 60 * 60, admin: 8 * 60 * 60 };

export function setAuthCookie(res, role, id) {
  const token = jwt.sign({ sub: String(id), role }, config.jwtSecret, { expiresIn: TTL_SECONDS[role] });
  res.cookie(COOKIES[role], token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: TTL_SECONDS[role] * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res, role) {
  res.clearCookie(COOKIES[role], { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' });
}

function readToken(req, role) {
  const token = req.cookies?.[COOKIES[role]];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.role !== role) return null;
    const id = Number(payload.sub);
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

/** Student routes are hot during a live quiz, so this only verifies the token (no DB lookup). */
export function requireStudent(req, res, next) {
  const id = readToken(req, 'student');
  if (!id) return next(unauthorized());
  req.studentId = id;
  next();
}

export function optionalStudent(req, res, next) {
  req.studentId = readToken(req, 'student');
  next();
}

export function readStudentId(req) {
  return readToken(req, 'student');
}

export function readAdminId(req) {
  return readToken(req, 'admin');
}

/** Admin traffic is light, so we confirm the admin still exists on every request. */
export async function requireAdmin(req, res, next) {
  const id = readToken(req, 'admin');
  if (!id) throw unauthorized('Admin login required');
  const { rows } = await query('SELECT id, name, email FROM admins WHERE id = $1', [id]);
  if (!rows[0]) throw unauthorized('Admin login required');
  req.admin = rows[0];
  next();
}
