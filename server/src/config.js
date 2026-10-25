import 'dotenv/config';

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

function required(name, fallback) {
  const value = env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const jwtSecret = env.JWT_SECRET || (isProduction ? undefined : 'dev-only-insecure-secret-change-me');
if (!jwtSecret) throw new Error('JWT_SECRET must be set in production');

export const config = {
  isProduction,
  isTest: env.NODE_ENV === 'test',
  port: Number(env.PORT || 4000),
  // Number of server processes. Set to the CPU core count in production (keep WEB_CONCURRENCY × DB_POOL_SIZE
  // below PostgreSQL's max_connections, 100 by default).
  workers: Math.max(1, Number(env.WEB_CONCURRENCY || 1)),
  databaseUrl: required('DATABASE_URL', isProduction ? undefined : 'postgres://quiz:quiz@localhost:5432/quiz_competition'),
  dbPoolSize: Number(env.DB_POOL_SIZE || 10),
  jwtSecret,
  jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
  // Set to the number of proxies in front of the app (e.g. 1 behind nginx) so rate limits see real client IPs.
  trustProxy: env.TRUST_PROXY ? (Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY)) : false,
  corsOrigin: env.CORS_ORIGIN || '',
  // Whether the site is served over HTTPS: enables Secure cookies, HSTS and upgrade-insecure-requests.
  // Set HTTPS=false only for plain-HTTP deployments (e.g. a college LAN), or logins will silently fail.
  https: env.HTTPS ? env.HTTPS === 'true' : isProduction,
  // Seconds after the deadline during which in-flight answer saves are still accepted.
  submitGraceSeconds: Number(env.SUBMIT_GRACE_SECONDS || 15),
  autoSubmitIntervalMs: Number(env.AUTO_SUBMIT_INTERVAL_MS || 30000),
  // Login attempts allowed per email+IP in a 15 minute window.
  loginRateLimit: Number(env.LOGIN_RATE_LIMIT || 20),
  // Registrations allowed per IP in a 15 minute window. Whole colleges often share one IP, so keep this generous.
  registerRateLimit: Number(env.REGISTER_RATE_LIMIT || 500),
  admin: {
    name: env.ADMIN_NAME || 'Administrator',
    email: env.ADMIN_EMAIL || 'admin@quiz.local',
    password: env.ADMIN_PASSWORD || (isProduction ? undefined : 'Admin@123'),
  },
};
