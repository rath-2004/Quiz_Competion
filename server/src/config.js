import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(serverRoot, '..');

// Load .env from the repo root or server/ (existing environment variables win).
if (process.env.NODE_ENV !== 'test') {
  for (const file of [path.join(repoRoot, '.env'), path.join(serverRoot, '.env')]) {
    if (fs.existsSync(file)) process.loadEnvFile(file);
  }
}

// Password hashing (scrypt) runs on libuv's thread pool; the default of 4 threads
// becomes a bottleneck when thousands of students log in at once. This must be
// set before the pool is first used, which is why it lives in the config module.
process.env.UV_THREADPOOL_SIZE ||= '16';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function int(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new Error(`Expected an integer but got "${value}"`);
  return n;
}

function trustProxy(value) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

export const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  port: int(env.PORT, 4000),
  databaseUrl: env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/quiz',
  dbPoolMax: int(env.DB_POOL_MAX, 20),
  jwtSecret: env.JWT_SECRET || (isProd ? '' : 'dev-only-insecure-secret-change-me'),
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
  trustProxy: trustProxy(env.TRUST_PROXY),
  webConcurrency: int(env.WEB_CONCURRENCY, 1),
  // Answers/submissions are accepted this long after the deadline to absorb network latency.
  submitGraceSeconds: int(env.SUBMIT_GRACE_SECONDS, 15),
  sweepIntervalSeconds: int(env.SWEEP_INTERVAL_SECONDS, 20),
  // A whole campus often shares one public IP, so keep per-IP limits generous.
  registerLimitPerIp: int(env.REGISTER_LIMIT_PER_IP, 1000),
  loginLimitPerAccount: int(env.LOGIN_LIMIT_PER_ACCOUNT, 20),
  admin: {
    name: env.ADMIN_NAME || 'Administrator',
    email: env.ADMIN_EMAIL || '',
    password: env.ADMIN_PASSWORD || '',
  },
  paths: {
    serverRoot,
    migrations: path.join(serverRoot, 'migrations'),
    clientDist: path.join(repoRoot, 'client', 'dist'),
  },
};

if (!config.jwtSecret) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production');
}
