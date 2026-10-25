import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { combineSeed, seededShuffle } from '../lib/shuffle.js';
import { getCompetition, getQuestionMap } from './competitions.js';

// Scores every attempt id produced by `targetsSql`. Shared by submit, auto-submit and rescore
// so all three always agree on how marks and negative marks are counted.
function scoresCte(targetsSql) {
  return `
    WITH targets AS (${targetsSql}),
    scores AS (
      SELECT t.id,
        COUNT(q.id) FILTER (WHERE aa.selected_option = q.correct_option)::int AS correct_count,
        COUNT(q.id) FILTER (WHERE aa.selected_option IS NOT NULL
                              AND aa.selected_option <> q.correct_option)::int AS wrong_count,
        COALESCE(SUM(CASE WHEN aa.selected_option = q.correct_option THEN q.marks
                          WHEN aa.selected_option IS NOT NULL THEN -q.negative_marks
                          ELSE 0 END), 0) AS score
      FROM targets t
      LEFT JOIN attempt_answers aa ON aa.attempt_id = t.id
      LEFT JOIN questions q ON q.id = aa.question_id
      GROUP BY t.id
    )`;
}

/**
 * Finalizes in-progress attempts matching `where` (SQL over the attempts table) and
 * returns the finalized ids. The sweeper passes skipLocked so several app servers can
 * run it at once without blocking each other.
 */
async function finalizeWhere(where, params, status, { skipLocked = false } = {}) {
  const statusParam = `$${params.length + 1}`;
  const sql = `${scoresCte(
    `SELECT id FROM attempts WHERE status = 'in_progress' AND ${where} FOR UPDATE${skipLocked ? ' SKIP LOCKED' : ''}`,
  )}
    UPDATE attempts a
       SET status = ${statusParam},
           submitted_at = LEAST(now(), a.deadline_at),
           score = s.score,
           correct_count = s.correct_count,
           wrong_count = s.wrong_count
      FROM scores s
     WHERE a.id = s.id
    RETURNING a.id`;
  const { rows } = await query(sql, [...params, status]);
  return rows.map((r) => r.id);
}

export async function finalizeExpiredAttempts() {
  return finalizeWhere(
    `deadline_at < now() - make_interval(secs => $1)`,
    [config.submitGraceSeconds],
    'auto_submitted',
    { skipLocked: true },
  );
}

export async function rescoreCompetition(competitionId) {
  const sql = `${scoresCte(
    `SELECT id FROM attempts WHERE competition_id = $1 AND status <> 'in_progress' FOR UPDATE`,
  )}
    UPDATE attempts a
       SET score = s.score,
           correct_count = s.correct_count,
           wrong_count = s.wrong_count,
           max_score = (SELECT COALESCE(SUM(q.marks), 0) FROM questions q WHERE q.id = ANY(a.question_ids))
      FROM scores s
     WHERE a.id = s.id
    RETURNING a.id`;
  const { rowCount } = await query(sql, [competitionId]);
  return rowCount;
}

async function loadAttempt(competitionId, studentId) {
  const { rows } = await query(
    `SELECT a.*, now() AS db_now FROM attempts a WHERE a.competition_id = $1 AND a.student_id = $2`,
    [competitionId, studentId],
  );
  return rows[0] ?? null;
}

function isPastGrace(attempt) {
  return attempt.deadline_at.getTime() + config.submitGraceSeconds * 1000 < attempt.db_now.getTime();
}

/** Loads the student's attempt, auto-submitting it first if its time ran out while they were away. */
export async function getAttempt(competitionId, studentId) {
  let attempt = await loadAttempt(competitionId, studentId);
  if (attempt?.status === 'in_progress' && isPastGrace(attempt)) {
    await finalizeWhere('id = $1', [attempt.id], 'auto_submitted');
    attempt = await loadAttempt(competitionId, studentId);
  }
  return attempt;
}

async function requirePublishedCompetition(competitionId) {
  const competition = await getCompetition(competitionId);
  if (!competition || !competition.is_published) throw notFound('Competition not found');
  return competition;
}

function pickQuestionIds(competition, questionMap, seed) {
  const all = [...questionMap.keys()];
  const limit = competition.questions_per_attempt;
  const takeSubset = limit && limit < all.length;
  if (!competition.shuffle_questions && !takeSubset) return all;
  let ids = seededShuffle(all, seed);
  if (takeSubset) {
    ids = ids.slice(0, limit);
    if (!competition.shuffle_questions) {
      const order = new Map(all.map((id, i) => [id, i]));
      ids.sort((a, b) => order.get(a) - order.get(b));
    }
  }
  return ids;
}

/** Starts the student's attempt, or returns the existing one (idempotent; safe on reload or double-click). */
export async function startAttempt(competitionId, studentId, ipAddress) {
  const competition = await requirePublishedCompetition(competitionId);
  const existing = await getAttempt(competitionId, studentId);
  if (existing) return { competition, attempt: existing };

  const { rows } = await query(
    `SELECT now() AS now, s.is_blocked,
            EXISTS (SELECT 1 FROM registrations r WHERE r.competition_id = $1 AND r.student_id = s.id) AS registered
       FROM students s WHERE s.id = $2`,
    [competitionId, studentId],
  );
  const check = rows[0];
  if (!check) throw unauthorized();
  if (check.is_blocked) throw forbidden('Your account has been blocked. Please contact the organisers.');
  if (!check.registered) throw forbidden('You need to register for this competition before you can take it');
  if (check.now < competition.starts_at) throw conflict('This competition has not started yet');
  if (check.now >= competition.ends_at) throw conflict('This competition has ended');

  const questionMap = await getQuestionMap(competitionId);
  if (questionMap.size === 0) throw conflict('This competition has no questions yet. Please try again shortly.');

  const seed = crypto.randomInt(1, 2 ** 31 - 1);
  const questionIds = pickQuestionIds(competition, questionMap, seed);
  const maxScore = questionIds.reduce((sum, id) => sum + questionMap.get(id).marks, 0);

  const inserted = await query(
    `INSERT INTO attempts (competition_id, student_id, question_ids, seed, max_score, deadline_at, ip_address)
     VALUES ($1, $2, $3, $4, $5, LEAST(now() + make_interval(mins => $6), $7), $8)
     ON CONFLICT (competition_id, student_id) DO NOTHING
     RETURNING *, now() AS db_now`,
    [competitionId, studentId, questionIds, seed, maxScore, competition.duration_minutes, competition.ends_at, ipAddress],
  );
  if (inserted.rows[0]) return { competition, attempt: inserted.rows[0], fresh: true };
  // Lost a race with a parallel request from the same student (e.g. a double click).
  return { competition, attempt: await loadAttempt(competitionId, studentId) };
}

/** Everything the quiz screen needs. Option order is shuffled per student; correct answers are never sent. */
export async function buildQuizPayload(competition, attempt, { fresh = false } = {}) {
  const base = {
    competition: {
      id: competition.id,
      title: competition.title,
      instructions: competition.instructions,
      durationMinutes: competition.duration_minutes,
    },
    attempt: {
      id: attempt.id,
      status: attempt.status,
      startedAt: attempt.started_at,
      deadlineAt: attempt.deadline_at,
      submittedAt: attempt.submitted_at,
    },
    serverNow: attempt.db_now,
  };
  if (attempt.status !== 'in_progress') return base;

  // A brand-new attempt has no saved answers, so skip that query during the start-time rush.
  const [questionMap, answerRows] = await Promise.all([
    getQuestionMap(competition.id),
    fresh
      ? { rows: [] }
      : query('SELECT question_id, selected_option FROM attempt_answers WHERE attempt_id = $1', [attempt.id]),
  ]);
  const questions = attempt.question_ids
    .map((id) => questionMap.get(id))
    .filter(Boolean)
    .map((q) => {
      const indices = q.options.map((_, i) => i);
      const order = competition.shuffle_options ? seededShuffle(indices, combineSeed(attempt.seed, q.id)) : indices;
      return {
        id: q.id,
        text: q.text,
        marks: q.marks,
        negativeMarks: q.negativeMarks,
        options: order.map((i) => ({ index: i, text: q.options[i] })),
      };
    });
  const answers = Object.fromEntries(answerRows.rows.map((r) => [r.question_id, r.selected_option]));
  return { ...base, questions, answers };
}

/**
 * Saves a batch of answers ([{ questionId, option }], option null = cleared).
 * One statement both validates the attempt and writes, and it share-locks the
 * attempt row so an answer can never land after the attempt was finalized.
 */
export async function saveAnswers(competitionId, studentId, answers) {
  const questionMap = await getQuestionMap(competitionId);
  for (const { questionId, option } of answers) {
    const question = questionMap.get(questionId);
    if (!question) throw badRequest('Unknown question');
    if (option !== null && (option < 0 || option >= question.options.length)) throw badRequest('Invalid option');
  }
  // Last write wins if the same question appears twice in one batch.
  const latest = new Map(answers.map((a) => [a.questionId, a.option]));
  const { rowCount } = await query(
    `WITH a AS (
       SELECT id, question_ids FROM attempts
        WHERE competition_id = $1 AND student_id = $2 AND status = 'in_progress'
          AND now() <= deadline_at + make_interval(secs => $5)
        FOR SHARE
     )
     INSERT INTO attempt_answers (attempt_id, question_id, selected_option)
     SELECT a.id, x.question_id, x.selected_option
       FROM a, unnest($3::int[], $4::smallint[]) AS x(question_id, selected_option)
      WHERE x.question_id = ANY(a.question_ids)
     ON CONFLICT (attempt_id, question_id)
     DO UPDATE SET selected_option = EXCLUDED.selected_option, answered_at = now()`,
    [competitionId, studentId, [...latest.keys()], [...latest.values()], config.submitGraceSeconds],
  );
  if (rowCount === latest.size) return { saved: rowCount };

  const attempt = await getAttempt(competitionId, studentId);
  if (!attempt) throw conflict('You have not started this quiz');
  if (attempt.status !== 'in_progress') throw conflict('Your quiz has already been submitted');
  if (isPastGrace(attempt)) throw conflict('Time is up for this quiz');
  throw badRequest('One or more questions are not part of your quiz');
}

export async function submitAttempt(competitionId, studentId) {
  const attempt = await getAttempt(competitionId, studentId);
  if (!attempt) throw conflict('You have not started this quiz');
  if (attempt.status === 'in_progress') {
    await finalizeWhere('id = $1', [attempt.id], 'submitted');
  }
  return getAttempt(competitionId, studentId);
}

export async function recordTabSwitch(competitionId, studentId) {
  await query(
    `UPDATE attempts SET tab_switches = tab_switches + 1
      WHERE competition_id = $1 AND student_id = $2 AND status = 'in_progress'`,
    [competitionId, studentId],
  );
}

let sweeperTimer = null;

/** Periodically auto-submits attempts whose time ran out (e.g. the student closed the browser). */
export function startSweeper({ intervalSeconds = config.sweepIntervalSeconds, log = console.log } = {}) {
  const run = async () => {
    try {
      const ids = await finalizeExpiredAttempts();
      if (ids.length) log(`Auto-submitted ${ids.length} expired attempt(s)`);
    } catch (err) {
      console.error('Auto-submit sweep failed', err);
    }
  };
  sweeperTimer = setInterval(run, intervalSeconds * 1000);
  sweeperTimer.unref();
  return run;
}

export function stopSweeper() {
  clearInterval(sweeperTimer);
  sweeperTimer = null;
}
