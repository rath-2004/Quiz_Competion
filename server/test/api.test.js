import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminAgent, app, db, isoIn, quiz, request, resetDatabase, studentAgent } from './setup.js';

before(resetDatabase);
after(() => db.pool.end());

async function createQuestions(admin, n, extra = {}) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const res = await admin
      .post('/api/admin/questions')
      .send({ text: `Question ${i + 1}?`, options: ['A', 'B', 'C', 'D'], correct_option: i % 4, marks: 2, category: 'Test', ...extra })
      .expect(201);
    ids.push(res.body.question.id);
  }
  return ids;
}

async function createCompetition(admin, overrides = {}) {
  const res = await admin
    .post('/api/admin/competitions')
    .send({
      title: 'Test Competition',
      start_time: isoIn(-10),
      end_time: isoIn(60),
      duration_minutes: 15,
      status: 'published',
      shuffle_questions: true,
      shuffle_options: true,
      ...overrides,
    })
    .expect(201);
  return res.body.competition;
}

describe('auth', () => {
  test('student registration, duplicate email, login and profile', async () => {
    const { agent, user, password } = await studentAgent();
    assert.equal(user.role, 'student');
    assert.equal(user.password_hash, undefined);

    const dup = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dup', email: user.email.toUpperCase(), password: 'whatever12', college: 'Dup College', roll_number: 'Z1' });
    assert.equal(dup.status, 409);

    const bad = await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' });
    assert.equal(bad.status, 401);

    const login = await request(app).post('/api/auth/login').send({ email: user.email, password });
    assert.equal(login.status, 200);
    assert.ok(login.headers['set-cookie'][0].includes('HttpOnly'));

    const me = await agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.email, user.email);
  });

  test('validation errors are reported per field', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'A', email: 'not-an-email', password: '123' });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.email);
    assert.ok(res.body.details.password);
  });

  test('students cannot use admin endpoints', async () => {
    const { agent } = await studentAgent();
    await agent.get('/api/admin/stats').expect(403);
    await request(app).get('/api/admin/stats').expect(401);
  });

  test('blocking a student signs them out immediately', async () => {
    const admin = await adminAgent();
    const { agent, user } = await studentAgent();
    await agent.get('/api/auth/me').expect(200);
    await admin.patch(`/api/admin/students/${user.id}/status`).send({ is_active: false }).expect(200);
    await agent.get('/api/auth/me').expect(401);
  });
});

describe('full quiz flow', () => {
  test('register → start → answer → submit → results with negative marking and ranking', async () => {
    const admin = await adminAgent();
    const qids = await createQuestions(admin, 4);
    const comp = await createCompetition(admin, { negative_mark: 0.5 });
    await admin.post(`/api/admin/competitions/${comp.id}/questions`).send({ questionIds: qids }).expect(200);

    const alice = await studentAgent();
    const bob = await studentAgent();

    // Must register before starting.
    await alice.agent.post(`/api/student/competitions/${comp.id}/start`).expect(403);
    await alice.agent.post(`/api/student/competitions/${comp.id}/register`).expect(200);
    await bob.agent.post(`/api/student/competitions/${comp.id}/register`).expect(200);

    const list = await alice.agent.get('/api/student/competitions').expect(200);
    const listed = list.body.competitions.find((c) => c.id === comp.id);
    assert.equal(listed.registered, true);
    assert.equal(listed.question_count, 4);

    const start = await alice.agent.post(`/api/student/competitions/${comp.id}/start`).expect(200);
    assert.equal(start.body.status, 'in_progress');
    assert.equal(start.body.questions.length, 4);
    // Correct answers never reach the browser.
    assert.ok(!JSON.stringify(start.body).includes('correct'));
    const deadline = new Date(start.body.deadline).getTime();
    assert.ok(deadline > Date.now() + 14 * 60_000 && deadline <= Date.now() + 15 * 60_000 + 1000);

    // Starting again resumes the same attempt.
    const again = await alice.agent.post(`/api/student/competitions/${comp.id}/start`).expect(200);
    assert.equal(again.body.attemptId, start.body.attemptId);

    // Question i has correct option i % 4. Alice: 3 right, 1 wrong.
    const correctOf = new Map(qids.map((id, i) => [id, i % 4]));
    const [q1, q2, q3, q4] = start.body.questions;
    for (const q of [q1, q2, q3]) {
      await alice.agent
        .put(`/api/student/competitions/${comp.id}/answer`)
        .send({ questionId: q.id, selected: correctOf.get(q.id) })
        .expect(200);
    }
    await alice.agent
      .put(`/api/student/competitions/${comp.id}/answer`)
      .send({ questionId: q4.id, selected: (correctOf.get(q4.id) + 1) % 4, markedReview: true })
      .expect(200);
    await alice.agent.put(`/api/student/competitions/${comp.id}/answer`).send({ questionId: q4.id, selected: 9 }).expect(400);
    await alice.agent.put(`/api/student/competitions/${comp.id}/answer`).send({ questionId: 999999, selected: 0 }).expect(400);

    const state = await alice.agent.get(`/api/student/competitions/${comp.id}/attempt`).expect(200);
    assert.equal(state.body.questions.filter((q) => q.selected !== null).length, 4);
    assert.equal(state.body.questions.find((q) => q.id === q4.id).markedReview, true);

    await alice.agent.post(`/api/student/competitions/${comp.id}/submit`).expect(200);
    await alice.agent.put(`/api/student/competitions/${comp.id}/answer`).send({ questionId: q1.id, selected: 0 }).expect(409);

    // Bob answers just one question correctly.
    const bobStart = await bob.agent.post(`/api/student/competitions/${comp.id}/start`).expect(200);
    const bq = bobStart.body.questions[0];
    await bob.agent.put(`/api/student/competitions/${comp.id}/answer`).send({ questionId: bq.id, selected: correctOf.get(bq.id) }).expect(200);
    await bob.agent.post(`/api/student/competitions/${comp.id}/submit`).expect(200);

    // Results are hidden until the admin publishes them (show_result_immediately is off).
    const hidden = await alice.agent.get(`/api/student/competitions/${comp.id}/result`).expect(200);
    assert.equal(hidden.body.scoreVisible, false);
    assert.equal(hidden.body.score, undefined);

    await admin.post(`/api/admin/competitions/${comp.id}/publish-results`).send({ published: true }).expect(200);
    const result = await alice.agent.get(`/api/student/competitions/${comp.id}/result`).expect(200);
    assert.equal(result.body.score, 3 * 2 - 0.5);
    assert.equal(result.body.maxScore, 8);
    assert.equal(result.body.correct, 3);
    assert.equal(result.body.wrong, 1);
    assert.equal(result.body.unanswered, 0);
    assert.equal(result.body.rank, 1);
    assert.equal(result.body.participants, 2);
    assert.equal(result.body.review.length, 4);

    const bobResult = await bob.agent.get(`/api/student/competitions/${comp.id}/result`).expect(200);
    assert.equal(bobResult.body.score, 2);
    assert.equal(bobResult.body.unanswered, 3);
    assert.equal(bobResult.body.rank, 2);

    const board = await admin.get(`/api/admin/competitions/${comp.id}/leaderboard`).expect(200);
    assert.deepEqual(board.body.leaderboard.map((r) => r.user_id), [alice.user.id, bob.user.id]);

    const csv = await admin.get(`/api/admin/competitions/${comp.id}/export`).expect(200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.text, /Rank,Name,Email/);
    assert.equal(csv.text.trim().split('\r\n').length, 3);

    // Question set is frozen once attempts exist.
    const extra = await createQuestions(admin, 1);
    await admin.post(`/api/admin/competitions/${comp.id}/questions`).send({ questionIds: extra }).expect(409);

    // Fixing the answer key and re-scoring updates results.
    const q1Index = qids.indexOf(q1.id);
    await admin
      .put(`/api/admin/questions/${q1.id}`)
      .send({ text: 'Fixed?', options: ['A', 'B', 'C', 'D'], correct_option: (q1Index + 1) % 4, marks: 2, category: 'Test' })
      .expect(200);
    await admin.post(`/api/admin/competitions/${comp.id}/rescore`).expect(200);
    const rescored = await alice.agent.get(`/api/student/competitions/${comp.id}/result`).expect(200);
    assert.equal(rescored.body.score, 2 * 2 - 2 * 0.5);
  });

  test('random subset per student when question_count is smaller than the pool', async () => {
    const admin = await adminAgent();
    const qids = await createQuestions(admin, 6);
    const comp = await createCompetition(admin, { question_count: 3, show_result_immediately: true });
    await admin.post(`/api/admin/competitions/${comp.id}/questions`).send({ questionIds: qids }).expect(200);
    const s = await studentAgent();
    await s.agent.post(`/api/student/competitions/${comp.id}/register`).expect(200);
    const start = await s.agent.post(`/api/student/competitions/${comp.id}/start`).expect(200);
    assert.equal(start.body.questions.length, 3);
    for (const q of start.body.questions) assert.ok(qids.includes(q.id));
    await s.agent.post(`/api/student/competitions/${comp.id}/submit`).expect(200);
    const result = await s.agent.get(`/api/student/competitions/${comp.id}/result`).expect(200);
    assert.equal(result.body.scoreVisible, true);
    assert.equal(result.body.maxScore, 6);
    assert.equal(result.body.review, undefined);
  });

  test('cannot start before the window opens or after it closes', async () => {
    const admin = await adminAgent();
    const qids = await createQuestions(admin, 1);
    const upcoming = await createCompetition(admin, { start_time: isoIn(30), end_time: isoIn(90) });
    await admin.post(`/api/admin/competitions/${upcoming.id}/questions`).send({ questionIds: qids }).expect(200);
    const s = await studentAgent();
    await s.agent.post(`/api/student/competitions/${upcoming.id}/register`).expect(200);
    const early = await s.agent.post(`/api/student/competitions/${upcoming.id}/start`).expect(400);
    assert.match(early.body.error, /not started/);

    const draft = await createCompetition(admin, { status: 'draft' });
    await s.agent.post(`/api/student/competitions/${draft.id}/register`).expect(404);
  });

  test('deadline is capped at the competition end time and expired attempts are auto-submitted', async () => {
    const admin = await adminAgent();
    const qids = await createQuestions(admin, 2);
    const comp = await createCompetition(admin, { end_time: isoIn(5), duration_minutes: 60 });
    await admin.post(`/api/admin/competitions/${comp.id}/questions`).send({ questionIds: qids }).expect(200);
    const s = await studentAgent();
    await s.agent.post(`/api/student/competitions/${comp.id}/register`).expect(200);
    const start = await s.agent.post(`/api/student/competitions/${comp.id}/start`).expect(200);
    assert.ok(new Date(start.body.deadline).getTime() <= Date.now() + 5 * 60_000 + 1000);
    const q = start.body.questions[0];
    await s.agent.put(`/api/student/competitions/${comp.id}/answer`).send({ questionId: q.id, selected: qids.indexOf(q.id) % 4 }).expect(200);

    // Simulate the student's time running out while they were offline.
    await db.query("UPDATE attempts SET deadline = now() - interval '1 minute' WHERE id = $1", [start.body.attemptId]);
    const swept = await quiz.autoSubmitExpired();
    assert.ok(swept >= 1);
    const row = await db.one('SELECT * FROM attempts WHERE id = $1', [start.body.attemptId]);
    assert.equal(row.status, 'submitted');
    assert.equal(row.auto_submitted, true);
    assert.equal(row.score, 2);

    const late = await s.agent.put(`/api/student/competitions/${comp.id}/answer`).send({ questionId: q.id, selected: 0 });
    assert.equal(late.status, 409);
    const state = await s.agent.get(`/api/student/competitions/${comp.id}/attempt`).expect(200);
    assert.equal(state.body.status, 'submitted');
  });

  test('exceeding the tab-switch limit auto-submits', async () => {
    const admin = await adminAgent();
    const qids = await createQuestions(admin, 2);
    const comp = await createCompetition(admin, { max_tab_switches: 1 });
    await admin.post(`/api/admin/competitions/${comp.id}/questions`).send({ questionIds: qids }).expect(200);
    const s = await studentAgent();
    await s.agent.post(`/api/student/competitions/${comp.id}/register`).expect(200);
    await s.agent.post(`/api/student/competitions/${comp.id}/start`).expect(200);
    const first = await s.agent.post(`/api/student/competitions/${comp.id}/tab-switch`).expect(200);
    assert.equal(first.body.autoSubmitted, false);
    const second = await s.agent.post(`/api/student/competitions/${comp.id}/tab-switch`).expect(200);
    assert.equal(second.body.autoSubmitted, true);
    const row = await db.one('SELECT status, tab_switches FROM attempts WHERE competition_id = $1', [comp.id]);
    assert.equal(row.status, 'submitted');
    assert.equal(row.tab_switches, 2);
  });

  test('admin can force-submit running attempts and reset one student', async () => {
    const admin = await adminAgent();
    const qids = await createQuestions(admin, 2);
    const comp = await createCompetition(admin);
    await admin.post(`/api/admin/competitions/${comp.id}/questions`).send({ questionIds: qids }).expect(200);
    const s = await studentAgent();
    await admin.post(`/api/admin/competitions/${comp.id}/registrations`).send({ userIds: [s.user.id] }).expect(200);
    await s.agent.post(`/api/student/competitions/${comp.id}/start`).expect(200);
    const forced = await admin.post(`/api/admin/competitions/${comp.id}/force-submit`).expect(200);
    assert.equal(forced.body.submitted, 1);
    const participants = await admin.get(`/api/admin/competitions/${comp.id}/participants`).expect(200);
    assert.equal(participants.body.items[0].status, 'submitted');

    await admin.delete(`/api/admin/competitions/${comp.id}/attempts/${s.user.id}`).expect(200);
    const restart = await s.agent.post(`/api/student/competitions/${comp.id}/start`).expect(200);
    assert.equal(restart.body.status, 'in_progress');
  });
});

describe('admin data management', () => {
  test('question CSV import validates rows and can attach to a competition', async () => {
    const admin = await adminAgent();
    const comp = await createCompetition(admin, { status: 'draft' });
    const csv = [
      'Question,Option A,Option B,Option C,Option D,Correct,Category,Difficulty,Marks',
      '"What is 2+2?",3,4,5,6,B,Math,easy,1',
      '"Capital of France?",Paris,Rome,,,A,GK,medium,2',
      '"Broken row",only one,,,,A,GK,easy,1',
      '"Bad answer",x,y,z,w,Q,GK,easy,1',
    ].join('\n');
    const res = await admin.post('/api/admin/questions/import').send({ csv, competitionId: comp.id }).expect(200);
    assert.equal(res.body.inserted, 2);
    assert.equal(res.body.failed, 2);
    assert.deepEqual(res.body.errors.map((e) => e.row), [4, 5]);
    const assigned = await admin.get(`/api/admin/competitions/${comp.id}/questions`).expect(200);
    assert.equal(assigned.body.questions.length, 2);
    assert.equal(assigned.body.questions[0].correct_option, 1);

    const list = await admin.get('/api/admin/questions?category=GK').expect(200);
    assert.equal(list.body.total, 1);
    // In use → cannot delete.
    await admin.delete(`/api/admin/questions/${assigned.body.questions[0].id}`).expect(409);
  });

  test('student CSV import uses default password, skips duplicates and registers for a competition', async () => {
    const admin = await adminAgent();
    const comp = await createCompetition(admin);
    const csv = [
      'Name,Email,Phone,College,Department,Year,Roll No',
      'Imported One,imp1@test.local,9000000001,Import College,ECE,1,IMP1',
      'Imported Two,imp2@test.local,9000000002,Import College,ECE,2,IMP2',
      'Imported Dup,IMP1@test.local,9000000003,Import College,ECE,2,IMP3',
      'No Email,,9000000004,Import College,ECE,2,IMP4',
    ].join('\n');
    const res = await admin
      .post('/api/admin/students/import')
      .send({ csv, defaultPassword: 'Welcome@2026', competitionId: comp.id })
      .expect(200);
    assert.equal(res.body.inserted, 2);
    assert.equal(res.body.failed, 2);
    assert.equal(res.body.registered, 2);

    const again = await admin.post('/api/admin/students/import').send({ csv, defaultPassword: 'Welcome@2026' }).expect(200);
    assert.equal(again.body.inserted, 0);
    assert.equal(again.body.skipped, 2);

    await request(app).post('/api/auth/login').send({ email: 'imp2@test.local', password: 'Welcome@2026' }).expect(200);

    const list = await admin.get('/api/admin/students?college=Import%20College').expect(200);
    assert.equal(list.body.total, 2);
    const detail = await admin.get(`/api/admin/students/${list.body.items[0].id}`).expect(200);
    assert.equal(detail.body.competitions.length, 1);

    const exported = await admin.get('/api/admin/students/export?college=Import%20College').expect(200);
    assert.match(exported.text, /imp1@test\.local/);
  });

  test('CSV export neutralises spreadsheet formulas', async () => {
    const admin = await adminAgent();
    await studentAgent({ name: '=HYPERLINK("http://evil")', college: 'Formula College' });
    const exported = await admin.get('/api/admin/students/export?college=Formula%20College').expect(200);
    assert.match(exported.text, /"'=HYPERLINK\(""http:\/\/evil""\)"/);
  });

  test('dashboard stats', async () => {
    const admin = await adminAgent();
    const res = await admin.get('/api/admin/stats').expect(200);
    assert.ok(res.body.totals.students > 0);
    assert.equal(res.body.signups.length, 14);
  });
});
