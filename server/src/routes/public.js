import { Router } from 'express';
import { query } from '../db/pool.js';
import { optionalStudent } from '../lib/auth.js';
import { createCache } from '../lib/cache.js';
import { forbidden, notFound } from '../lib/errors.js';
import { parseId } from '../lib/validate.js';
import { getCompetition, scoresVisible, toPublicCompetition } from '../services/competitions.js';

export const publicRouter = Router();

// Before a quiz starts thousands of students sit on the dashboard refreshing,
// so the shared parts of these responses are cached briefly.
const listCache = createCache(5_000);
const leaderboardCache = createCache(10_000);

export function invalidateCompetitionList() {
  listCache.clear();
}

publicRouter.get('/departments', async (req, res) => {
  const { rows } = await query('SELECT id, name, code FROM departments ORDER BY name');
  res.json({ departments: rows });
});

function loadPublishedCompetitions() {
  return listCache.get('published', async () => {
    const { rows } = await query(
      `SELECT c.*, now() AS db_now,
              (SELECT COUNT(*) FROM registrations r WHERE r.competition_id = c.id) AS registration_count
         FROM competitions c
        WHERE c.is_published
        ORDER BY c.starts_at DESC`,
    );
    return rows;
  });
}

async function studentStatus(studentId) {
  if (!studentId) return new Map();
  const { rows } = await query(
    `SELECT r.competition_id, a.status AS attempt_status
       FROM registrations r
       LEFT JOIN attempts a ON a.competition_id = r.competition_id AND a.student_id = r.student_id
      WHERE r.student_id = $1`,
    [studentId],
  );
  return new Map(rows.map((r) => [r.competition_id, r.attempt_status ?? 'not_started']));
}

function withMe(competition, statusMap, studentId) {
  if (!studentId) return { ...competition, me: null };
  const attemptStatus = statusMap.get(competition.id);
  return { ...competition, me: { registered: attemptStatus !== undefined, attemptStatus: attemptStatus ?? null } };
}

publicRouter.get('/competitions', optionalStudent, async (req, res) => {
  const [rows, statusMap] = await Promise.all([loadPublishedCompetitions(), studentStatus(req.studentId)]);
  const now = new Date();
  const competitions = rows.map((c) =>
    withMe({ ...toPublicCompetition(c, now), registrationCount: c.registration_count }, statusMap, req.studentId),
  );
  res.json({ competitions, serverNow: now });
});

publicRouter.get('/competitions/:id', optionalStudent, async (req, res) => {
  const id = parseId(req.params.id);
  const competition = await getCompetition(id);
  if (!competition || !competition.is_published) throw notFound('Competition not found');
  const statusMap = await studentStatus(req.studentId);
  const now = new Date();
  res.json({ competition: withMe(toPublicCompetition(competition, now), statusMap, req.studentId), serverNow: now });
});

publicRouter.get('/competitions/:id/leaderboard', async (req, res) => {
  const id = parseId(req.params.id);
  const competition = await getCompetition(id);
  if (!competition || !competition.is_published) throw notFound('Competition not found');
  if (!scoresVisible(competition)) throw forbidden('Results for this competition are not published yet');
  const leaderboard = await leaderboardCache.get(id, async () => {
    const { rows } = await query(
      `SELECT RANK() OVER (ORDER BY a.score DESC, (a.submitted_at - a.started_at)) AS rank,
              s.name, d.name AS department, s.year_of_study, a.score, a.max_score,
              EXTRACT(EPOCH FROM (a.submitted_at - a.started_at))::int AS time_taken_seconds
         FROM attempts a
         JOIN students s ON s.id = a.student_id
         JOIN departments d ON d.id = s.department_id
        WHERE a.competition_id = $1 AND a.status <> 'in_progress'
        ORDER BY rank, s.name
        LIMIT 100`,
      [id],
    );
    return rows.map((r) => ({
      rank: r.rank,
      name: r.name,
      department: r.department,
      yearOfStudy: r.year_of_study,
      score: r.score,
      maxScore: r.max_score,
      timeTakenSeconds: r.time_taken_seconds,
    }));
  });
  res.json({ competition: toPublicCompetition(competition), leaderboard });
});
