import { config } from '../config.js';
import { many, one, pool, transaction } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Scores attempts in a single statement. With finalize=true only in-progress attempts are touched and they
 * are marked submitted; with finalize=false already-submitted attempts are re-scored (e.g. after an answer key fix).
 * Concurrent callers are safe: rows are locked with SKIP LOCKED so each attempt is finalized exactly once.
 */
async function scoreAttempts(db, { where, params, finalize, auto = false }) {
  const statusFilter = finalize ? "a.status = 'in_progress'" : "a.status = 'submitted'";
  const { rows } = await db.query(
    `WITH target AS (
       SELECT a.id FROM attempts a WHERE ${statusFilter} AND (${where}) FOR UPDATE SKIP LOCKED
     ), agg AS (
       SELECT t.id AS attempt_id,
              COALESCE(SUM(q.marks) FILTER (WHERE aa.selected_option = q.correct_option), 0) AS positive,
              COUNT(*) FILTER (WHERE aa.selected_option = q.correct_option) AS correct,
              COUNT(*) FILTER (WHERE aa.selected_option IS NOT NULL AND aa.selected_option <> q.correct_option) AS wrong
         FROM target t
         LEFT JOIN attempt_answers aa ON aa.attempt_id = t.id
         LEFT JOIN questions q ON q.id = aa.question_id
        GROUP BY t.id
     )
     UPDATE attempts a SET
       score = agg.positive - agg.wrong * c.negative_mark,
       correct_count = agg.correct,
       wrong_count = agg.wrong,
       unanswered_count = a.total_questions - agg.correct - agg.wrong
       ${finalize ? `, status = 'submitted', submitted_at = LEAST(now(), a.deadline), auto_submitted = ${auto ? 'TRUE' : 'FALSE'}` : ''}
     FROM agg, competitions c
     WHERE a.id = agg.attempt_id AND c.id = a.competition_id
     RETURNING a.id`,
    params,
  );
  return rows.length;
}

/** Finalizes every in-progress attempt whose deadline (plus grace) has passed. Called periodically. */
export async function autoSubmitExpired() {
  return scoreAttempts(pool, {
    where: `a.deadline < now() - make_interval(secs => $1)`,
    params: [config.submitGraceSeconds],
    finalize: true,
    auto: true,
  });
}

/** Submits every in-progress attempt of a competition right now. */
export async function forceSubmitCompetition(competitionId) {
  return scoreAttempts(pool, { where: 'a.competition_id = $1', params: [competitionId], finalize: true, auto: true });
}

export async function rescoreCompetition(competitionId) {
  return scoreAttempts(pool, { where: 'a.competition_id = $1', params: [competitionId], finalize: false });
}

function competitionPhase(c, now = new Date()) {
  if (now < c.start_time) return 'upcoming';
  if (now > c.end_time) return 'ended';
  return 'live';
}

async function getPublishedCompetition(db, competitionId) {
  const c = await db
    .query("SELECT * FROM competitions WHERE id = $1 AND status = 'published'", [competitionId])
    .then((r) => r.rows[0]);
  if (!c) throw notFound('Competition not found');
  return c;
}

/** Registers a student for a competition. Idempotent. */
export async function register(userId, competitionId) {
  const c = await getPublishedCompetition(pool, competitionId);
  if (competitionPhase(c) === 'ended') throw badRequest('This competition has already ended');
  if (!c.registration_open) throw badRequest('Registration for this competition is closed');
  await pool.query(
    'INSERT INTO registrations (competition_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [competitionId, userId],
  );
  return { registered: true };
}

/** Starts (or resumes) the student's attempt and returns the quiz state. */
export async function startAttempt(userId, competitionId) {
  await transaction(async (db) => {
    const c = await getPublishedCompetition(db, competitionId);
    const existing = await db
      .query('SELECT id FROM attempts WHERE competition_id = $1 AND user_id = $2', [competitionId, userId])
      .then((r) => r.rows[0]);
    if (existing) return existing.id;

    const phase = competitionPhase(c);
    if (phase === 'upcoming') throw badRequest('This competition has not started yet');
    if (phase === 'ended') throw badRequest('This competition has ended');

    const registered = await db
      .query('SELECT 1 FROM registrations WHERE competition_id = $1 AND user_id = $2', [competitionId, userId])
      .then((r) => r.rowCount > 0);
    if (!registered) throw forbidden('You are not registered for this competition');

    const bank = await db
      .query(
        `SELECT q.id, jsonb_array_length(q.options) AS option_count, q.marks
           FROM competition_questions cq JOIN questions q ON q.id = cq.question_id
          WHERE cq.competition_id = $1
          ORDER BY cq.position, q.id`,
        [competitionId],
      )
      .then((r) => r.rows);
    if (bank.length === 0) throw conflict('This competition has no questions yet. Please contact the organisers.');

    // When question_count is smaller than the bank, every student gets a different random subset.
    const count = Math.min(c.question_count ?? bank.length, bank.length);
    let picked = bank;
    if (count < bank.length) {
      const chosen = new Set(shuffle(bank).slice(0, count));
      picked = bank.filter((q) => chosen.has(q));
    }
    if (c.shuffle_questions) picked = shuffle(picked);

    const order = picked.map((q) => {
      const idx = Array.from({ length: q.option_count }, (_, i) => i);
      return { q: q.id, o: c.shuffle_options ? shuffle(idx) : idx };
    });
    const maxScore = picked.reduce((sum, q) => sum + Number(q.marks), 0);

    const inserted = await db
      .query(
        `INSERT INTO attempts (competition_id, user_id, deadline, question_order, total_questions, max_score)
         VALUES ($1, $2, LEAST(now() + make_interval(mins => $3), $4), $5, $6, $7)
         ON CONFLICT (competition_id, user_id) DO NOTHING
         RETURNING id`,
        [competitionId, userId, c.duration_minutes, c.end_time, JSON.stringify(order), order.length, maxScore],
      )
      .then((r) => r.rows[0]);
    if (inserted) return inserted.id;
    // Lost a race with a parallel request (e.g. double click) — use the attempt it created.
    return db
      .query('SELECT id FROM attempts WHERE competition_id = $1 AND user_id = $2', [competitionId, userId])
      .then((r) => r.rows[0].id);
  });
  return getAttemptState(userId, competitionId);
}

async function loadAttempt(userId, competitionId) {
  const attempt = await one(
    `SELECT a.*, c.title, c.max_tab_switches, c.negative_mark, c.show_result_immediately, c.results_published, c.end_time
       FROM attempts a JOIN competitions c ON c.id = a.competition_id
      WHERE a.competition_id = $1 AND a.user_id = $2`,
    [competitionId, userId],
  );
  if (!attempt) throw notFound('You have not started this competition');
  return attempt;
}

/** Finalizes the attempt if its time is up. Returns true when the attempt is (now) submitted. */
async function finalizeIfExpired(attempt) {
  if (attempt.status === 'submitted') return true;
  const expiredAt = attempt.deadline.getTime() + config.submitGraceSeconds * 1000;
  if (Date.now() <= expiredAt) return false;
  await scoreAttempts(pool, { where: 'a.id = $1', params: [attempt.id], finalize: true, auto: true });
  return true;
}

/** Everything the quiz screen needs. Correct answers are never included. */
export async function getAttemptState(userId, competitionId) {
  let attempt = await loadAttempt(userId, competitionId);
  if (await finalizeIfExpired(attempt)) {
    attempt = await loadAttempt(userId, competitionId);
    return { attemptId: attempt.id, status: 'submitted', title: attempt.title, competitionId };
  }

  const order = attempt.question_order;
  const ids = order.map((o) => o.q);
  const [questions, answers] = await Promise.all([
    many('SELECT id, text, image_url, options, marks FROM questions WHERE id = ANY($1)', [ids]),
    many('SELECT question_id, selected_option, marked_review FROM attempt_answers WHERE attempt_id = $1', [attempt.id]),
  ]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answerById = new Map(answers.map((a) => [a.question_id, a]));

  return {
    attemptId: attempt.id,
    competitionId,
    title: attempt.title,
    status: attempt.status,
    startedAt: attempt.started_at,
    deadline: attempt.deadline,
    serverNow: new Date(),
    negativeMark: attempt.negative_mark,
    maxTabSwitches: attempt.max_tab_switches,
    tabSwitches: attempt.tab_switches,
    questions: order
      .filter((o) => byId.has(o.q))
      .map((o, index) => {
        const q = byId.get(o.q);
        const saved = answerById.get(q.id);
        return {
          id: q.id,
          number: index + 1,
          text: q.text,
          imageUrl: q.image_url,
          marks: q.marks,
          // Each option carries its original index; the client sends that index back, so shuffling stays server-side.
          options: o.o.filter((i) => i < q.options.length).map((i) => ({ index: i, text: q.options[i] })),
          selected: saved?.selected_option ?? null,
          markedReview: saved?.marked_review ?? false,
        };
      }),
  };
}

async function loadOpenAttempt(userId, competitionId) {
  const attempt = await loadAttempt(userId, competitionId);
  if (attempt.status === 'submitted') throw conflict('Your quiz has already been submitted');
  if (await finalizeIfExpired(attempt)) throw conflict('Time is up — your quiz has been submitted');
  return attempt;
}

/** Saves (or clears) the answer for one question. */
export async function saveAnswer(userId, competitionId, { questionId, selected, markedReview }) {
  // This is the hottest endpoint during a quiz, so the normal case is one statement: it only writes when the
  // attempt is open, within its deadline, and the question / option belong to this student's quiz.
  const { rowCount } = await pool.query(
    `INSERT INTO attempt_answers (attempt_id, question_id, selected_option, marked_review, answered_at)
     SELECT a.id, $3::int, $4::int, $5::boolean, now()
       FROM attempts a
      WHERE a.competition_id = $1 AND a.user_id = $2 AND a.status = 'in_progress'
        AND now() <= a.deadline + make_interval(secs => $6)
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(a.question_order) e
           WHERE (e->>'q')::int = $3::int AND ($4::int IS NULL OR e->'o' @> to_jsonb($4::int)))
     ON CONFLICT (attempt_id, question_id)
     DO UPDATE SET selected_option = EXCLUDED.selected_option, marked_review = EXCLUDED.marked_review, answered_at = now()`,
    [competitionId, userId, questionId, selected, markedReview, config.submitGraceSeconds],
  );
  if (rowCount) return { saved: true };

  // Nothing was written: find out why to give the student a useful error.
  const attempt = await loadOpenAttempt(userId, competitionId);
  const entry = attempt.question_order.find((o) => o.q === questionId);
  if (!entry) throw badRequest('This question is not part of your quiz');
  if (selected !== null && !entry.o.includes(selected)) throw badRequest('Invalid option');
  throw conflict('Your quiz has already been submitted');
}

/** Records a tab switch / window blur. Auto-submits when the competition's limit is exceeded. */
export async function recordTabSwitch(userId, competitionId) {
  const attempt = await loadOpenAttempt(userId, competitionId);
  const updated = await one(
    "UPDATE attempts SET tab_switches = tab_switches + 1 WHERE id = $1 AND status = 'in_progress' RETURNING tab_switches",
    [attempt.id],
  );
  if (!updated) throw conflict('Your quiz has already been submitted');
  const limit = attempt.max_tab_switches;
  if (limit !== null && updated.tab_switches > limit) {
    await scoreAttempts(pool, { where: 'a.id = $1', params: [attempt.id], finalize: true, auto: true });
    return { tabSwitches: updated.tab_switches, autoSubmitted: true };
  }
  return { tabSwitches: updated.tab_switches, autoSubmitted: false };
}

export async function submitAttempt(userId, competitionId) {
  const attempt = await loadAttempt(userId, competitionId);
  if (attempt.status === 'in_progress') {
    const expired = Date.now() > attempt.deadline.getTime() + config.submitGraceSeconds * 1000;
    await scoreAttempts(pool, { where: 'a.id = $1', params: [attempt.id], finalize: true, auto: expired });
  }
  return { submitted: true };
}

/** Result for the student. Score is shown per competition settings; answer review only after results are published. */
export async function getResult(userId, competitionId) {
  let attempt = await loadAttempt(userId, competitionId);
  if (!(await finalizeIfExpired(attempt))) throw badRequest('Your quiz is still in progress');
  attempt = await loadAttempt(userId, competitionId);

  const base = {
    competitionId,
    title: attempt.title,
    status: attempt.status,
    startedAt: attempt.started_at,
    submittedAt: attempt.submitted_at,
    autoSubmitted: attempt.auto_submitted,
    resultsPublished: attempt.results_published,
    totalQuestions: attempt.total_questions,
  };
  if (!attempt.show_result_immediately && !attempt.results_published) {
    return { ...base, scoreVisible: false };
  }

  const result = {
    ...base,
    scoreVisible: true,
    score: attempt.score,
    maxScore: attempt.max_score,
    correct: attempt.correct_count,
    wrong: attempt.wrong_count,
    unanswered: attempt.unanswered_count,
  };
  if (!attempt.results_published) return result;

  // Same ordering as the admin leaderboard: higher score first, then less time taken.
  const rank = await one(
    `SELECT COUNT(o.id) + 1 AS rank,
            (SELECT COUNT(*) FROM attempts WHERE competition_id = me.competition_id AND status = 'submitted') AS participants
       FROM attempts me
       LEFT JOIN attempts o ON o.competition_id = me.competition_id AND o.status = 'submitted' AND o.id <> me.id
        AND (o.score > me.score OR (o.score = me.score AND o.submitted_at - o.started_at < me.submitted_at - me.started_at))
      WHERE me.id = $1
      GROUP BY me.id, me.competition_id`,
    [attempt.id],
  );

  const order = attempt.question_order;
  const [questions, answers] = await Promise.all([
    many('SELECT id, text, image_url, options, correct_option, explanation, marks FROM questions WHERE id = ANY($1)', [
      order.map((o) => o.q),
    ]),
    many('SELECT question_id, selected_option FROM attempt_answers WHERE attempt_id = $1', [attempt.id]),
  ]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answerById = new Map(answers.map((a) => [a.question_id, a.selected_option]));

  return {
    ...result,
    rank: rank.rank,
    participants: rank.participants,
    review: order
      .filter((o) => byId.has(o.q))
      .map((o, i) => {
        const q = byId.get(o.q);
        return {
          number: i + 1,
          text: q.text,
          imageUrl: q.image_url,
          options: q.options,
          correctOption: q.correct_option,
          selected: answerById.get(q.id) ?? null,
          explanation: q.explanation,
          marks: q.marks,
        };
      }),
  };
}
