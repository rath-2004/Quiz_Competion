import { query } from '../db/pool.js';
import { createCache } from '../lib/cache.js';

// Short TTLs keep the hot quiz path off the database while admin edits still
// show up quickly (immediately in the process that made the edit).
const competitionCache = createCache(5_000);
const questionCache = createCache(15_000);
const rankingCache = createCache(10_000);

export function getCompetition(id) {
  return competitionCache.get(id, async () => {
    const { rows } = await query('SELECT * FROM competitions WHERE id = $1', [id]);
    return rows[0] ?? null;
  });
}

/** Questions for serving to students: Map(questionId -> question). Never exposes correct answers. */
export function getQuestionMap(competitionId) {
  return questionCache.get(competitionId, async () => {
    const { rows } = await query(
      `SELECT id, text, options, marks, negative_marks
         FROM questions WHERE competition_id = $1 ORDER BY position, id`,
      [competitionId],
    );
    return new Map(
      rows.map((q) => [q.id, { id: q.id, text: q.text, options: q.options, marks: q.marks, negativeMarks: q.negative_marks }]),
    );
  });
}

export function invalidateCompetition(id) {
  competitionCache.delete(id);
  questionCache.delete(id);
  rankingCache.delete(id);
}

export function clearCompetitionCaches() {
  competitionCache.clear();
  questionCache.clear();
  rankingCache.clear();
}

// Ranking: higher score first, then less time taken (same order as the leaderboard).
function loadRanking(competitionId) {
  return rankingCache.get(competitionId, async () => {
    const { rows } = await query(
      `SELECT student_id, RANK() OVER (ORDER BY score DESC, (submitted_at - started_at)) AS rank
         FROM attempts WHERE competition_id = $1 AND status <> 'in_progress'`,
      [competitionId],
    );
    return { total: rows.length, byStudent: new Map(rows.map((r) => [r.student_id, r.rank])) };
  });
}

/**
 * A finished attempt's rank. Ranking the whole competition for every result view would
 * cost O(students) each time, so a briefly cached ranking is used; attempts submitted
 * after it was built are ranked with a direct count instead.
 */
export async function getRank(attempt) {
  const ranking = await loadRanking(attempt.competition_id);
  const rank = ranking.byStudent.get(attempt.student_id);
  if (rank) return { rank, total: ranking.total };
  const { rows } = await query(
    `SELECT (SELECT COUNT(*) FROM attempts o
              WHERE o.competition_id = me.competition_id AND o.status <> 'in_progress'
                AND (o.score > me.score
                     OR (o.score = me.score AND o.submitted_at - o.started_at < me.submitted_at - me.started_at))) + 1 AS rank,
            (SELECT COUNT(*) FROM attempts o
              WHERE o.competition_id = me.competition_id AND o.status <> 'in_progress') AS total
       FROM attempts me WHERE me.id = $1`,
    [attempt.id],
  );
  return rows[0] ?? { rank: null, total: null };
}

export function competitionState(c, now = new Date()) {
  if (!c.is_published) return 'draft';
  if (now < c.starts_at) return 'upcoming';
  if (now < c.ends_at) return 'live';
  return 'ended';
}

/** Whether students may see their own score (and the leaderboard). */
export function scoresVisible(c, now = new Date()) {
  if (c.results_visibility === 'hidden') return false;
  if (c.results_visibility === 'immediate') return true;
  return now >= c.ends_at;
}

/** Correct answers are only revealed once nobody can still be taking the quiz. */
export function reviewVisible(c, now = new Date()) {
  return c.results_visibility !== 'hidden' && now >= c.ends_at;
}

export function toPublicCompetition(c, now = new Date()) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    instructions: c.instructions,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    durationMinutes: c.duration_minutes,
    resultsVisibility: c.results_visibility,
    state: competitionState(c, now),
    scoresVisible: scoresVisible(c, now),
  };
}

export function toAdminCompetition(c, now = new Date()) {
  return {
    ...toPublicCompetition(c, now),
    questionsPerAttempt: c.questions_per_attempt,
    shuffleQuestions: c.shuffle_questions,
    shuffleOptions: c.shuffle_options,
    isPublished: c.is_published,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}
