// Points the app at a throwaway database. Imports happen dynamically so env is set before config loads.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://quiz:quiz@localhost:5432/quiz_test';
process.env.SUBMIT_GRACE_SECONDS = '0';

const { default: request } = await import('supertest');
const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { migrate, ensureAdmin } = await import('../src/migrate.js');
const quiz = await import('../src/services/quiz.js');

export const ADMIN = { name: 'Test Admin', email: 'admin@test.local', password: 'AdminPass123' };

export async function resetDatabase() {
  await db.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ log: () => {} });
  await ensureAdmin(ADMIN, { log: () => {} });
}

export const app = createApp();
export { db, quiz, request };

export async function adminAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
  return agent;
}

let studentSeq = 0;
export async function studentAgent(overrides = {}) {
  studentSeq += 1;
  const agent = request.agent(app);
  const body = {
    name: `Student ${studentSeq}`,
    email: `student${studentSeq}@test.local`,
    password: 'StudentPass1',
    college: overrides.college ?? 'Test College',
    roll_number: `R${studentSeq}`,
    department: 'CSE',
    year_of_study: 2,
    phone: '9876543210',
    ...overrides,
  };
  const res = await agent.post('/api/auth/register').send(body).expect(201);
  return { agent, user: res.body.user, password: body.password };
}

export function isoIn(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
