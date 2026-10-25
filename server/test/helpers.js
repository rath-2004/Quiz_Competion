// Points the app at the test database before any app module is loaded.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/quiz_test';
process.env.LOGIN_LIMIT_PER_ACCOUNT = '1000';

const { default: request } = await import('supertest');
const { createApp } = await import('../src/app.js');
const { migrate } = await import('../src/db/migrate.js');
const { pool, query } = await import('../src/db/pool.js');
const { createAdmin } = await import('../src/services/admins.js');
const { clearCompetitionCaches } = await import('../src/services/competitions.js');

export { pool, query, request };
export const app = createApp();

export const ADMIN = { name: 'Test Admin', email: 'admin@test.local', password: 'admin-password' };

export async function resetDatabase() {
  await migrate({ log: () => {} });
  await query(
    'TRUNCATE attempt_answers, attempts, registrations, questions, competitions, students, departments, admins RESTART IDENTITY CASCADE',
  );
  clearCompetitionCaches();
  await createAdmin(ADMIN);
  const { rows } = await query(
    `INSERT INTO departments (name, code) VALUES ('Computer Science', 'CSE'), ('Mechanical', 'MECH') RETURNING id`,
  );
  return { departmentIds: rows.map((r) => r.id) };
}

export async function adminAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/admin/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
  return agent;
}

let studentCounter = 0;
export async function registerStudent(departmentId, overrides = {}) {
  studentCounter += 1;
  const data = {
    name: `Student ${studentCounter}`,
    email: `student${studentCounter}@test.local`,
    registerNo: `REG${1000 + studentCounter}`,
    phone: '9876543210',
    departmentId,
    yearOfStudy: 2,
    password: 'student-pass',
    ...overrides,
  };
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/student/register').send(data).expect(201);
  return { agent, student: res.body.student, data };
}

const minutes = (n) => new Date(Date.now() + n * 60_000).toISOString();

/** Creates a published, currently-live competition with the given questions. */
export async function createLiveCompetition(admin, { questions, ...overrides } = {}) {
  const res = await admin
    .post('/api/admin/competitions')
    .send({
      title: 'Test Quiz',
      startsAt: minutes(-1),
      endsAt: minutes(60),
      durationMinutes: 10,
      resultsVisibility: 'immediate',
      shuffleQuestions: false,
      shuffleOptions: false,
      ...overrides,
    })
    .expect(201);
  const competition = res.body.competition;
  const created = [];
  for (const q of questions ?? defaultQuestions()) {
    const r = await admin.post(`/api/admin/competitions/${competition.id}/questions`).send(q).expect(201);
    created.push(r.body.question);
  }
  await admin.post(`/api/admin/competitions/${competition.id}/publish`).send({ isPublished: true }).expect(200);
  return { competition, questions: created };
}

export function defaultQuestions() {
  return [
    { text: 'Q1', options: ['a', 'b', 'c', 'd'], correctOption: 0, marks: 2 },
    { text: 'Q2', options: ['a', 'b', 'c'], correctOption: 1, marks: 1, negativeMarks: 0.5 },
    { text: 'Q3', options: ['a', 'b'], correctOption: 1, marks: 1 },
  ];
}

export { minutes };
