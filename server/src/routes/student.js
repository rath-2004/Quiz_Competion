import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireStudent } from '../lib/auth.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, parseId } from '../lib/validate.js';
import {
  buildQuizPayload,
  getAttempt,
  recordTabSwitch,
  saveAnswers,
  startAttempt,
  submitAttempt,
} from '../services/attempts.js';
import { getCompetition, getRank, reviewVisible, scoresVisible, toPublicCompetition } from '../services/competitions.js';
import { invalidateCompetitionList } from './public.js';

export const studentRouter = Router();
studentRouter.use(requireStudent);

async function publishedCompetition(req) {
  const id = parseId(req.params.id, 'competition id');
  const competition = await getCompetition(id);
  if (!competition || !competition.is_published) throw notFound('Competition not found');
  return competition;
}

studentRouter.post('/competitions/:id/register', async (req, res) => {
  const competition = await publishedCompetition(req);
  const { rows } = await query('SELECT is_blocked, now() AS now FROM students WHERE id = $1', [req.studentId]);
  if (!rows[0]) throw notFound('Student not found');
  if (rows[0].is_blocked) throw forbidden('Your account has been blocked. Please contact the organisers.');
  if (rows[0].now >= competition.ends_at) throw conflict('Registration has closed for this competition');
  await query(
    `INSERT INTO registrations (competition_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [competition.id, req.studentId],
  );
  invalidateCompetitionList();
  res.status(201).json({ registered: true });
});

studentRouter.post('/competitions/:id/start', async (req, res) => {
  const id = parseId(req.params.id, 'competition id');
  const { competition, attempt, fresh } = await startAttempt(id, req.studentId, req.ip);
  res.json(await buildQuizPayload(competition, attempt, { fresh }));
});

const answersSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.number().int().positive(),
        option: z.number().int().min(0).max(9).nullable(),
      }),
    )
    .min(1)
    .max(500),
});

studentRouter.put('/competitions/:id/answers', async (req, res) => {
  const id = parseId(req.params.id, 'competition id');
  const { answers } = parse(answersSchema, req.body);
  res.json(await saveAnswers(id, req.studentId, answers));
});

studentRouter.post('/competitions/:id/submit', async (req, res) => {
  const id = parseId(req.params.id, 'competition id');
  const attempt = await submitAttempt(id, req.studentId);
  res.json({ status: attempt.status, submittedAt: attempt.submitted_at });
});

studentRouter.post('/competitions/:id/tab-switch', async (req, res) => {
  const id = parseId(req.params.id, 'competition id');
  await recordTabSwitch(id, req.studentId);
  res.json({ ok: true });
});

studentRouter.get('/competitions/:id/result', async (req, res) => {
  const competition = await publishedCompetition(req);
  const attempt = await getAttempt(competition.id, req.studentId);
  if (!attempt) throw notFound('You did not take this quiz');
  const now = attempt.db_now;
  const finished = attempt.status !== 'in_progress';
  const showScore = finished && scoresVisible(competition, now);
  const showReview = finished && reviewVisible(competition, now);

  const result = {
    competition: toPublicCompetition(competition, now),
    attempt: {
      status: attempt.status,
      startedAt: attempt.started_at,
      submittedAt: attempt.submitted_at,
      totalQuestions: attempt.question_ids.length,
      timeTakenSeconds: finished ? Math.round((attempt.submitted_at - attempt.started_at) / 1000) : null,
    },
    showScore,
    showReview,
  };

  if (showScore) {
    const { rank, total } = await getRank(attempt);
    Object.assign(result.attempt, {
      score: attempt.score,
      maxScore: attempt.max_score,
      correctCount: attempt.correct_count,
      wrongCount: attempt.wrong_count,
      unansweredCount: attempt.question_ids.length - attempt.correct_count - attempt.wrong_count,
      rank,
      totalParticipants: total,
    });
  }

  if (showReview) {
    const { rows } = await query(
      `SELECT q.id, q.text, q.options, q.correct_option, q.marks, q.explanation, aa.selected_option
         FROM unnest($1::int[]) WITH ORDINALITY AS served(question_id, ord)
         JOIN questions q ON q.id = served.question_id
         LEFT JOIN attempt_answers aa ON aa.attempt_id = $2 AND aa.question_id = q.id
        ORDER BY served.ord`,
      [attempt.question_ids, attempt.id],
    );
    result.review = rows.map((q) => ({
      id: q.id,
      text: q.text,
      options: q.options,
      correctOption: q.correct_option,
      selectedOption: q.selected_option,
      marks: q.marks,
      explanation: q.explanation,
    }));
  }

  res.json(result);
});
