import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import {
  adminAgent,
  app,
  createLiveCompetition,
  minutes,
  pool,
  query,
  registerStudent,
  request,
  resetDatabase,
} from './helpers.js';

const { finalizeExpiredAttempts } = await import('../src/services/attempts.js');
const { clearCompetitionCaches } = await import('../src/services/competitions.js');

let departmentIds;
let admin;

beforeEach(async () => {
  ({ departmentIds } = await resetDatabase());
  admin = await adminAgent();
});

after(() => pool.end());

async function joinedStudent(competitionId) {
  const s = await registerStudent(departmentIds[0]);
  await s.agent.post(`/api/student/competitions/${competitionId}/register`).expect(201);
  return s;
}

describe('taking a quiz', () => {
  test('full flow: register, start, answer, submit, see score and rank', async () => {
    const { competition, questions } = await createLiveCompetition(admin);
    const { agent } = await joinedStudent(competition.id);

    const start = await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    assert.equal(start.body.attempt.status, 'in_progress');
    assert.equal(start.body.questions.length, 3);
    // Correct answers must never reach the browser.
    assert.doesNotMatch(JSON.stringify(start.body), /correct/i);

    const [q1, q2, q3] = questions;
    await agent
      .put(`/api/student/competitions/${competition.id}/answers`)
      .send({ answers: [{ questionId: q1.id, option: 0 }, { questionId: q2.id, option: 2 }] })
      .expect(200);
    // Change of mind: clear Q3 after answering it.
    await agent.put(`/api/student/competitions/${competition.id}/answers`).send({ answers: [{ questionId: q3.id, option: 1 }] }).expect(200);
    await agent.put(`/api/student/competitions/${competition.id}/answers`).send({ answers: [{ questionId: q3.id, option: null }] }).expect(200);

    // Resuming returns saved answers.
    const resumed = await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    assert.deepEqual(resumed.body.answers, { [q1.id]: 0, [q2.id]: 2, [q3.id]: null });

    const submit = await agent.post(`/api/student/competitions/${competition.id}/submit`).expect(200);
    assert.equal(submit.body.status, 'submitted');

    const result = await agent.get(`/api/student/competitions/${competition.id}/result`).expect(200);
    assert.equal(result.body.showScore, true);
    // +2 for Q1, -0.5 for wrong Q2, Q3 unanswered.
    assert.equal(result.body.attempt.score, 1.5);
    assert.equal(result.body.attempt.maxScore, 4);
    assert.equal(result.body.attempt.correctCount, 1);
    assert.equal(result.body.attempt.wrongCount, 1);
    assert.equal(result.body.attempt.unansweredCount, 1);
    assert.equal(result.body.attempt.rank, 1);
    // Correct answers stay hidden until the competition window closes.
    assert.equal(result.body.showReview, false);
    assert.equal(result.body.review, undefined);

    const board = await request(app).get(`/api/competitions/${competition.id}/leaderboard`).expect(200);
    assert.equal(board.body.leaderboard.length, 1);
    assert.equal(board.body.leaderboard[0].score, 1.5);
  });

  test('answers are rejected after submission and submit is idempotent', async () => {
    const { competition, questions } = await createLiveCompetition(admin);
    const { agent } = await joinedStudent(competition.id);
    await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    await agent.post(`/api/student/competitions/${competition.id}/submit`).expect(200);
    const res = await agent
      .put(`/api/student/competitions/${competition.id}/answers`)
      .send({ answers: [{ questionId: questions[0].id, option: 0 }] })
      .expect(409);
    assert.match(res.body.error, /already been submitted/);
    await agent.post(`/api/student/competitions/${competition.id}/submit`).expect(200);
  });

  test('rejects invalid options and questions from another competition', async () => {
    const { competition, questions } = await createLiveCompetition(admin);
    const other = await createLiveCompetition(admin, { title: 'Other quiz' });
    const { agent } = await joinedStudent(competition.id);
    await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    await agent
      .put(`/api/student/competitions/${competition.id}/answers`)
      .send({ answers: [{ questionId: questions[2].id, option: 5 }] })
      .expect(400);
    await agent
      .put(`/api/student/competitions/${competition.id}/answers`)
      .send({ answers: [{ questionId: other.questions[0].id, option: 0 }] })
      .expect(400);
  });

  test('students must register first and cannot start before the start time', async () => {
    const live = await createLiveCompetition(admin);
    const s = await registerStudent(departmentIds[0]);
    const res = await s.agent.post(`/api/student/competitions/${live.competition.id}/start`).expect(403);
    assert.match(res.body.error, /register/);

    const upcoming = await createLiveCompetition(admin, { startsAt: minutes(30), endsAt: minutes(90) });
    await s.agent.post(`/api/student/competitions/${upcoming.competition.id}/register`).expect(201);
    const early = await s.agent.post(`/api/student/competitions/${upcoming.competition.id}/start`).expect(409);
    assert.match(early.body.error, /not started/);
  });

  test('unpublished competitions are invisible to students', async () => {
    const res = await admin
      .post('/api/admin/competitions')
      .send({ title: 'Draft quiz', startsAt: minutes(-1), endsAt: minutes(60), durationMinutes: 5 })
      .expect(201);
    const s = await registerStudent(departmentIds[0]);
    await s.agent.post(`/api/student/competitions/${res.body.competition.id}/register`).expect(404);
    const list = await request(app).get('/api/competitions').expect(200);
    assert.equal(list.body.competitions.length, 0);
  });

  test('deadline is capped by the competition end time', async () => {
    const { competition } = await createLiveCompetition(admin, { endsAt: minutes(3), durationMinutes: 30 });
    const { agent } = await joinedStudent(competition.id);
    const start = await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    assert.equal(new Date(start.body.attempt.deadlineAt).getTime(), new Date(competition.endsAt).getTime());
  });

  test('expired attempts are auto-submitted and scored', async () => {
    const { competition, questions } = await createLiveCompetition(admin);
    const { agent } = await joinedStudent(competition.id);
    await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    await agent
      .put(`/api/student/competitions/${competition.id}/answers`)
      .send({ answers: [{ questionId: questions[0].id, option: 0 }] })
      .expect(200);
    await query(`UPDATE attempts SET deadline_at = now() - interval '5 minutes', started_at = now() - interval '15 minutes'`);

    const ids = await finalizeExpiredAttempts();
    assert.equal(ids.length, 1);
    const result = await agent.get(`/api/student/competitions/${competition.id}/result`).expect(200);
    assert.equal(result.body.attempt.status, 'auto_submitted');
    assert.equal(result.body.attempt.score, 2);

    const late = await agent
      .put(`/api/student/competitions/${competition.id}/answers`)
      .send({ answers: [{ questionId: questions[1].id, option: 1 }] })
      .expect(409);
    assert.match(late.body.error, /already been submitted/);
  });

  test('answers within the grace period are accepted, after it they are not', async () => {
    const { competition, questions } = await createLiveCompetition(admin);
    const { agent } = await joinedStudent(competition.id);
    await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    await query(`UPDATE attempts SET deadline_at = now() - interval '5 seconds'`);
    await agent
      .put(`/api/student/competitions/${competition.id}/answers`)
      .send({ answers: [{ questionId: questions[0].id, option: 0 }] })
      .expect(200);
    await query(`UPDATE attempts SET deadline_at = now() - interval '1 minute'`);
    const res = await agent
      .put(`/api/student/competitions/${competition.id}/answers`)
      .send({ answers: [{ questionId: questions[1].id, option: 1 }] })
      .expect(409);
    assert.match(res.body.error, /already been submitted|Time is up/);
  });

  test('serves a stable random subset when questionsPerAttempt is set', async () => {
    const questions = Array.from({ length: 8 }, (_, i) => ({ text: `Q${i}`, options: ['a', 'b', 'c', 'd'], correctOption: 0 }));
    const { competition } = await createLiveCompetition(admin, {
      questions,
      questionsPerAttempt: 5,
      shuffleQuestions: true,
      shuffleOptions: true,
    });
    const { agent } = await joinedStudent(competition.id);
    const first = await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    assert.equal(first.body.questions.length, 5);
    clearCompetitionCaches();
    const again = await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    assert.deepEqual(again.body.questions, first.body.questions);
    for (const q of first.body.questions) {
      assert.deepEqual(q.options.map((o) => o.index).sort(), [0, 1, 2, 3]);
    }
  });

  test('scores stay hidden until the end when results are "after_end"', async () => {
    const { competition } = await createLiveCompetition(admin, { resultsVisibility: 'after_end' });
    const { agent } = await joinedStudent(competition.id);
    await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    await agent.post(`/api/student/competitions/${competition.id}/submit`).expect(200);
    const result = await agent.get(`/api/student/competitions/${competition.id}/result`).expect(200);
    assert.equal(result.body.showScore, false);
    assert.equal(result.body.attempt.score, undefined);
    await request(app).get(`/api/competitions/${competition.id}/leaderboard`).expect(403);
  });

  test('answer review with correct answers is shown after the competition ends', async () => {
    const { competition, questions } = await createLiveCompetition(admin);
    const { agent } = await joinedStudent(competition.id);
    await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    await agent
      .put(`/api/student/competitions/${competition.id}/answers`)
      .send({ answers: [{ questionId: questions[0].id, option: 3 }] })
      .expect(200);
    await agent.post(`/api/student/competitions/${competition.id}/submit`).expect(200);
    await query(`UPDATE competitions SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 minute'`);
    clearCompetitionCaches();
    const result = await agent.get(`/api/student/competitions/${competition.id}/result`).expect(200);
    assert.equal(result.body.showReview, true);
    assert.equal(result.body.review.length, 3);
    assert.equal(result.body.review[0].correctOption, 0);
    assert.equal(result.body.review[0].selectedOption, 3);
  });
});

describe('admin competition management', () => {
  test('rescoring applies a corrected answer key', async () => {
    const { competition, questions } = await createLiveCompetition(admin);
    const { agent } = await joinedStudent(competition.id);
    await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    await agent
      .put(`/api/student/competitions/${competition.id}/answers`)
      .send({ answers: [{ questionId: questions[2].id, option: 0 }] })
      .expect(200);
    await agent.post(`/api/student/competitions/${competition.id}/submit`).expect(200);

    let results = await admin.get(`/api/admin/competitions/${competition.id}/results`).expect(200);
    assert.equal(results.body.items[0].score, 0);

    await admin
      .put(`/api/admin/questions/${questions[2].id}`)
      .send({ text: 'Q3', options: ['a', 'b'], correctOption: 0, marks: 3 })
      .expect(200);
    const rescore = await admin.post(`/api/admin/competitions/${competition.id}/rescore`).expect(200);
    assert.equal(rescore.body.rescored, 1);
    results = await admin.get(`/api/admin/competitions/${competition.id}/results`).expect(200);
    assert.equal(results.body.items[0].score, 3);
    assert.equal(results.body.items[0].maxScore, 6);
    assert.equal(results.body.departments[0].participants, 1);

    const csv = await admin.get(`/api/admin/competitions/${competition.id}/results.csv`).expect(200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.text, /Rank,Register No,Name/);
  });

  test('questions cannot be deleted once students have started', async () => {
    const { competition, questions } = await createLiveCompetition(admin);
    const { agent } = await joinedStudent(competition.id);
    await admin.delete(`/api/admin/questions/${questions[0].id}`).expect(200);
    await agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    await admin.delete(`/api/admin/questions/${questions[1].id}`).expect(409);
  });

  test('imports questions from CSV and reports row errors', async () => {
    const res = await admin
      .post('/api/admin/competitions')
      .send({ title: 'Import quiz', startsAt: minutes(10), endsAt: minutes(60), durationMinutes: 5 })
      .expect(201);
    const id = res.body.competition.id;
    const good = [
      'Question,Option A,Option B,Option C,Option D,Correct,Marks,Negative Marks',
      '"Capital of India?",Mumbai,New Delhi,Chennai,Kolkata,B,2,0.5',
      '2 + 2 = ?,3,4,,,4,,',
    ].join('\n');
    const ok = await admin
      .post(`/api/admin/competitions/${id}/questions/import`)
      .attach('file', Buffer.from(good), 'questions.csv')
      .expect(201);
    assert.equal(ok.body.imported, 2);
    const list = await admin.get(`/api/admin/competitions/${id}/questions`).expect(200);
    assert.deepEqual(
      list.body.questions.map((q) => [q.text, q.options.length, q.correctOption, q.marks, q.negativeMarks]),
      [
        ['Capital of India?', 4, 1, 2, 0.5],
        ['2 + 2 = ?', 2, 1, 1, 0],
      ],
    );

    const bad = ['Question,Option A,Option B,Correct', 'Missing answer,x,y,', ',x,y,A'].join('\n');
    const err = await admin
      .post(`/api/admin/competitions/${id}/questions/import`)
      .attach('file', Buffer.from(bad), 'bad.csv')
      .expect(400);
    assert.deepEqual(err.body.details.map((d) => d.row), [2, 3]);
  });

  test('participants list shows progress and an attempt can be reset', async () => {
    const { competition, questions } = await createLiveCompetition(admin);
    const a = await joinedStudent(competition.id);
    await joinedStudent(competition.id);
    await a.agent.post(`/api/student/competitions/${competition.id}/start`).expect(200);
    await a.agent
      .put(`/api/student/competitions/${competition.id}/answers`)
      .send({ answers: [{ questionId: questions[0].id, option: 1 }] })
      .expect(200);
    await a.agent.post(`/api/student/competitions/${competition.id}/tab-switch`).expect(200);

    const all = await admin.get(`/api/admin/competitions/${competition.id}/participants`).expect(200);
    assert.equal(all.body.total, 2);
    const inProgress = await admin.get(`/api/admin/competitions/${competition.id}/participants?status=in_progress`).expect(200);
    assert.equal(inProgress.body.total, 1);
    const attempt = inProgress.body.items[0].attempt;
    assert.equal(attempt.answered, 1);
    assert.equal(attempt.tabSwitches, 1);

    await admin.delete(`/api/admin/attempts/${attempt.id}`).expect(200);
    const notStarted = await admin.get(`/api/admin/competitions/${competition.id}/participants?status=not_started`).expect(200);
    assert.equal(notStarted.body.total, 2);
  });

  test('student search, export and password reset', async () => {
    const { student } = await registerStudent(departmentIds[1], { name: 'Priya Raman', registerNo: 'ME2201' });
    await registerStudent(departmentIds[0]);
    const search = await admin.get('/api/admin/students?search=priya').expect(200);
    assert.equal(search.body.total, 1);
    const byDept = await admin.get(`/api/admin/students?departmentId=${departmentIds[1]}`).expect(200);
    assert.equal(byDept.body.items[0].registerNo, 'ME2201');

    const csv = await admin.get('/api/admin/students/export.csv').expect(200);
    assert.match(csv.text, /ME2201/);

    const reset = await admin.post(`/api/admin/students/${student.id}/reset-password`).expect(200);
    await request(app)
      .post('/api/auth/student/login')
      .send({ identifier: 'ME2201', password: reset.body.temporaryPassword })
      .expect(200);
  });
});
