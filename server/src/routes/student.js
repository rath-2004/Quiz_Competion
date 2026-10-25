import { Router } from 'express';
import { many, one } from '../db.js';
import { notFound } from '../lib/errors.js';
import { validate, z } from '../lib/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as quiz from '../services/quiz.js';

const router = Router();
router.use(authenticate, requireRole('student'));

const idParam = (req) => validate(z.coerce.number().int().positive(), req.params.id);

const LIST_FIELDS = `c.id, c.title, c.description, c.start_time, c.end_time, c.duration_minutes, c.registration_open,
  c.negative_mark, c.show_result_immediately, c.results_published, c.max_tab_switches,
  (SELECT LEAST(COALESCE(c.question_count, COUNT(*)), COUNT(*)) FROM competition_questions cq WHERE cq.competition_id = c.id) AS question_count`;

/** Published competitions with this student's registration / attempt status. */
router.get('/competitions', async (req, res) => {
  const rows = await many(
    `SELECT ${LIST_FIELDS},
            (r.id IS NOT NULL) AS registered,
            a.status AS attempt_status, a.deadline AS attempt_deadline
       FROM competitions c
       LEFT JOIN registrations r ON r.competition_id = c.id AND r.user_id = $1
       LEFT JOIN attempts a ON a.competition_id = c.id AND a.user_id = $1
      WHERE c.status = 'published'
      ORDER BY c.start_time DESC`,
    [req.user.id],
  );
  res.json({ competitions: rows, serverNow: new Date() });
});

router.get('/competitions/:id', async (req, res) => {
  const id = idParam(req);
  const competition = await one(
    `SELECT ${LIST_FIELDS}, c.rules,
            (r.id IS NOT NULL) AS registered,
            a.status AS attempt_status, a.deadline AS attempt_deadline,
            (SELECT COUNT(*) FROM registrations WHERE competition_id = c.id) AS registered_count
       FROM competitions c
       LEFT JOIN registrations r ON r.competition_id = c.id AND r.user_id = $2
       LEFT JOIN attempts a ON a.competition_id = c.id AND a.user_id = $2
      WHERE c.id = $1 AND c.status = 'published'`,
    [id, req.user.id],
  );
  if (!competition) throw notFound('Competition not found');
  res.json({ competition, serverNow: new Date() });
});

router.post('/competitions/:id/register', async (req, res) => {
  res.json(await quiz.register(req.user.id, idParam(req)));
});

router.post('/competitions/:id/start', async (req, res) => {
  res.json(await quiz.startAttempt(req.user.id, idParam(req)));
});

router.get('/competitions/:id/attempt', async (req, res) => {
  res.json(await quiz.getAttemptState(req.user.id, idParam(req)));
});

const answerSchema = z.object({
  questionId: z.number().int().positive().max(2147483647),
  selected: z.number().int().min(0).max(5).nullable(),
  markedReview: z.boolean().default(false),
});

router.put('/competitions/:id/answer', async (req, res) => {
  res.json(await quiz.saveAnswer(req.user.id, idParam(req), validate(answerSchema, req.body)));
});

router.post('/competitions/:id/tab-switch', async (req, res) => {
  res.json(await quiz.recordTabSwitch(req.user.id, idParam(req)));
});

router.post('/competitions/:id/submit', async (req, res) => {
  res.json(await quiz.submitAttempt(req.user.id, idParam(req)));
});

router.get('/competitions/:id/result', async (req, res) => {
  res.json(await quiz.getResult(req.user.id, idParam(req)));
});

export default router;
