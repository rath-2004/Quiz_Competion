import crypto from 'node:crypto';
import { promisify } from 'node:util';

// scrypt runs on libuv's thread pool, so hashing never blocks the event loop
// even when thousands of students log in right before a quiz starts.
const scrypt = promisify(crypto.scrypt);
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 32;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, rr, pp, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
  });
  return crypto.timingSafeEqual(expected, actual);
}
