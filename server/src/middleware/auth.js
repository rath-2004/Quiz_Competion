import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export const COOKIE_NAME = 'qc_token';

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role, tv: user.token_version }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

export function setAuthCookie(res, token) {
  const { exp } = jwt.decode(token);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.https,
    expires: new Date(exp * 1000),
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function readToken(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[COOKIE_NAME];
}

// During a quiz every student saves an answer every few seconds, so the user row is cached briefly per process.
// Changes made through this process apply at once (forgetUser); other cluster workers see them within USER_CACHE_MS.
const USER_CACHE_MS = 5000;
const userCache = new Map();

export function forgetUser(id) {
  userCache.delete(Number(id));
}

async function loadUser(id) {
  const hit = userCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.user;
  const user = await one('SELECT id, role, name, email, is_active, token_version FROM users WHERE id = $1', [id]);
  if (userCache.size > 50_000) userCache.clear();
  userCache.set(id, { user, expires: Date.now() + USER_CACHE_MS });
  return user;
}

/** Loads the logged-in user into req.user. Blocked users and revoked tokens are rejected. */
export async function authenticate(req, _res, next) {
  const token = readToken(req);
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Your session has expired. Please log in again.');
  }
  const user = await loadUser(Number(payload.sub));
  if (!user || user.token_version !== payload.tv) throw unauthorized('Your session has expired. Please log in again.');
  if (!user.is_active) throw forbidden('Your account has been disabled. Contact the organisers.');
  req.user = user;
  next();
}

export function requireRole(role) {
  return (req, _res, next) => {
    if (req.user?.role !== role) throw forbidden();
    next();
  };
}
