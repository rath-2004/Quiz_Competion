// Simulates a full competition against a running server:
//   1. seeds N students, registered for a live competition (directly in the database)
//   2. all students log in, start the quiz, answer every question one click at a time, and submit
// and reports latency percentiles and errors for each phase.
//
// Use a throwaway database — this inserts thousands of rows. The server under test
// must use the same DATABASE_URL as this script.
//
//   DATABASE_URL=postgres://.../quiz_load npm run loadtest -- --url http://localhost:4000 --students 5000
import { parseArgs } from 'node:util';
import { migrate } from '../src/db/migrate.js';
import { pool, query } from '../src/db/pool.js';
import { hashPassword } from '../src/lib/password.js';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4000' },
    students: { type: 'string', default: '5000' },
    questions: { type: 'string', default: '25' },
    concurrency: { type: 'string', default: '1000' },
  },
});
const BASE = args.url.replace(/\/$/, '');
const N = Number(args.students);
const Q = Number(args.questions);
const CONCURRENCY = Number(args.concurrency);
const PASSWORD = 'loadtest-password';

async function seed() {
  await migrate({ log: () => {} });
  const tag = Date.now().toString(36).toUpperCase();
  const dept = await query(
    `INSERT INTO departments (name, code) VALUES ($1, $2) RETURNING id`,
    [`Load Test ${tag}`, `LT${tag}`.slice(0, 20)],
  );
  const competition = await query(
    `INSERT INTO competitions (title, starts_at, ends_at, duration_minutes, results_visibility, is_published)
     VALUES ($1, now() - interval '1 minute', now() + interval '2 hours', 30, 'immediate', true) RETURNING id`,
    [`Load test ${tag}`],
  );
  const competitionId = competition.rows[0].id;
  await query(
    `INSERT INTO questions (competition_id, text, options, correct_option, position)
     SELECT $1, 'Load test question ' || g, '["A","B","C","D"]'::jsonb, g % 4, g FROM generate_series(1, $2) g`,
    [competitionId, Q],
  );
  const hash = await hashPassword(PASSWORD);
  await query(
    `INSERT INTO students (name, email, register_no, phone, department_id, year_of_study, password_hash)
     SELECT 'Load Student ' || g, lower($1) || '-' || g || '@load.test', $1 || '-' || g, '9000000000', $2, 1 + g % 4, $3
       FROM generate_series(1, $4) g`,
    [tag, dept.rows[0].id, hash, N],
  );
  await query(
    `INSERT INTO registrations (competition_id, student_id)
     SELECT $1, id FROM students WHERE department_id = $2`,
    [competitionId, dept.rows[0].id],
  );
  return { competitionId, identifiers: Array.from({ length: N }, (_, i) => `${tag}-${i + 1}`) };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** Runs fn over items with at most `limit` in flight, recording each call's latency. */
async function phase(name, items, limit, fn) {
  const latencies = [];
  const errors = new Map();
  let next = 0;
  const started = performance.now();
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      const t0 = performance.now();
      try {
        await fn(item);
        latencies.push(performance.now() - t0);
      } catch (err) {
        const key = err.message.slice(0, 120);
        errors.set(key, (errors.get(key) ?? 0) + 1);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  const seconds = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const ms = (v) => `${Math.round(v)}ms`;
  console.log(
    `${name.padEnd(22)} ${String(latencies.length).padStart(7)} ok  ${String([...errors.values()].reduce((a, b) => a + b, 0)).padStart(5)} failed` +
      `  ${(latencies.length / seconds).toFixed(0).padStart(6)} req/s  p50 ${ms(percentile(latencies, 50))}` +
      `  p95 ${ms(percentile(latencies, 95))}  p99 ${ms(percentile(latencies, 99))}  total ${seconds.toFixed(1)}s`,
  );
  for (const [message, count] of errors) console.log(`    ${count} × ${message}`);
}

async function call(method, path, cookie, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status} ${data?.error ?? res.statusText}`);
  return { res, data };
}

console.log(`Seeding ${N} students and a ${Q}-question competition…`);
const { competitionId, identifiers } = await seed();
console.log(`Competition #${competitionId}. Target: ${BASE}, concurrency ${CONCURRENCY}\n`);

const students = identifiers.map((identifier) => ({ identifier }));

await phase('login', students, CONCURRENCY, async (s) => {
  const { res } = await call('POST', '/auth/student/login', null, { identifier: s.identifier, password: PASSWORD });
  s.cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
});

const loggedIn = students.filter((s) => s.cookie);
await phase('start quiz', loggedIn, CONCURRENCY, async (s) => {
  const { data } = await call('POST', `/student/competitions/${competitionId}/start`, s.cookie);
  s.questions = data.questions;
});

const answers = loggedIn
  .filter((s) => s.questions)
  .flatMap((s) => s.questions.map((q) => ({ s, q })))
  // Interleave students so load looks like everyone answering at once.
  .sort(() => Math.random() - 0.5);
await phase('save answer', answers, CONCURRENCY, async ({ s, q }) => {
  const option = q.options[Math.floor(Math.random() * q.options.length)].index;
  await call('PUT', `/student/competitions/${competitionId}/answers`, s.cookie, { answers: [{ questionId: q.id, option }] });
});

await phase('submit', loggedIn, CONCURRENCY, async (s) => {
  await call('POST', `/student/competitions/${competitionId}/submit`, s.cookie);
});

await phase('view result', loggedIn, CONCURRENCY, async (s) => {
  await call('GET', `/student/competitions/${competitionId}/result`, s.cookie);
});

const { rows } = await query(
  `SELECT status, COUNT(*) AS n, ROUND(AVG(score), 2) AS avg FROM attempts WHERE competition_id = $1 GROUP BY status`,
  [competitionId],
);
console.log('\nAttempts in database:', rows.map((r) => `${r.status}=${r.n} (avg score ${r.avg})`).join(', '));
await pool.end();
