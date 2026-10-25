// Simulates many students taking a quiz at the same time against a running server.
//
//   npm run seed -- --students 5000          # create load1..load5000@student.demo, registered for the demo competition
//   node scripts/loadtest.js --url http://localhost:4000 --students 5000 --concurrency 500 --think 10000
//
// Phases: every virtual student logs in, then all start the demo competition, answer every question
// (with --think N: a random 0..N ms pause before each answer) and submit.
// Attempts are deleted first so the test can be re-run.
import http from 'node:http';
import { pool } from '../src/db.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = args.url || 'http://localhost:4000';
const STUDENTS = Number(args.students || 1000);
const CONCURRENCY = Number(args.concurrency || 500);
const PASSWORD = args.password || 'Student@123';
const THINK_MS = Number(args.think || 0);

const { rows: [comp] } = await pool.query("SELECT id FROM competitions WHERE title = 'Inter-College Quiz Championship (Demo)'");
if (!comp) throw new Error('Run `npm run seed -- --students N` first');
await pool.query(
  "DELETE FROM attempts WHERE competition_id = $1 AND user_id IN (SELECT id FROM users WHERE email LIKE 'load%@student.demo')",
  [comp.id],
);
await pool.end();

const timings = {};
let errors = 0;
const errorSamples = new Set();

// A bounded keep-alive pool: one process opening thousands of fetch() sockets runs out of file descriptors.
const agent = new http.Agent({ keepAlive: true, maxSockets: Number(args.sockets || 2000) });

function request(path, { method, token, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      new URL(path, BASE),
      {
        method,
        agent,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let data = {};
          try {
            data = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, data });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

async function call(name, path, { token, method = 'GET', body } = {}) {
  const t0 = performance.now();
  let res;
  try {
    res = await request(path, { method, token, body });
  } catch (err) {
    errors++;
    if (errorSamples.size < 10) errorSamples.add(`${name} network: ${err.code || err.message}`);
    throw err;
  }
  (timings[name] ??= []).push(performance.now() - t0);
  if (res.status >= 400) {
    errors++;
    if (errorSamples.size < 10) errorSamples.add(`${name} ${res.status} ${res.data.error}`);
    throw new Error(res.data.error);
  }
  return res.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs fn(item) for every item with at most `limit` in flight; returns the phase duration in seconds. */
async function phase(name, items, limit, fn) {
  const t0 = performance.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await fn(item).catch(() => {});
      }
    }),
  );
  const seconds = (performance.now() - t0) / 1000;
  report(name, seconds);
  return seconds;
}

function report(name, seconds) {
  const list = (timings[name] ?? []).sort((a, b) => a - b);
  const pct = (p) => list[Math.min(list.length - 1, Math.floor((p / 100) * list.length))]?.toFixed(0);
  console.log(
    `${name.padEnd(7)} ${String(list.length).padStart(6)} requests in ${seconds.toFixed(1).padStart(5)}s ` +
      `(${(list.length / seconds).toFixed(0).padStart(4)} req/s)  p50=${pct(50)}ms  p95=${pct(95)}ms  p99=${pct(99)}ms  max=${pct(100)}ms`,
  );
}

const students = Array.from({ length: STUDENTS }, (_, i) => ({ n: i + 1 }));
console.log(`${STUDENTS} students, concurrency ${CONCURRENCY}, think time up to ${THINK_MS}ms per answer\n`);

// 1. Everyone logs in (in a real event this is spread over the minutes before the start).
await phase('login', students, CONCURRENCY, async (s) => {
  s.token = (await call('login', '/api/auth/login', { method: 'POST', body: { email: `load${s.n}@student.demo`, password: PASSWORD } })).token;
});
// 2. The start-time rush: everyone clicks "Start quiz".
await phase('start', students, CONCURRENCY, async (s) => {
  s.quiz = await call('start', `/api/student/competitions/${comp.id}/start`, { token: s.token, method: 'POST' });
});
// 3. Everyone answers every question at the same time, pausing between answers.
await phase('answer', students, STUDENTS, async (s) => {
  for (const q of s.quiz.questions) {
    if (THINK_MS) await sleep(Math.random() * THINK_MS);
    const pick = q.options[Math.floor(Math.random() * q.options.length)].index;
    await call('answer', `/api/student/competitions/${comp.id}/answer`, { token: s.token, method: 'PUT', body: { questionId: q.id, selected: pick } });
  }
});
// 4. Everyone submits.
await phase('submit', students, CONCURRENCY, async (s) => {
  await call('submit', `/api/student/competitions/${comp.id}/submit`, { token: s.token, method: 'POST' });
});

console.log(`\n${errors} errors`);
if (errorSamples.size) console.log('Sample errors:', [...errorSamples]);
