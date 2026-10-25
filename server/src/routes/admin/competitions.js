import { Router } from 'express';
import { many, one, query, transaction } from '../../db.js';
import { sendCsv, toCsv } from '../../lib/csv.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { competitionSchema, paginationSchema, validate, z } from '../../lib/validate.js';
import { forceSubmitCompetition, rescoreCompetition } from '../../services/quiz.js';

const router = Router();
const idParam = (req, name = 'id') => validate(z.coerce.number().int().positive(), req.params[name]);

/** The question set is frozen once any student has started, so every participant sees the same pool. */
export async function assertQuestionsEditable(db, competitionId) {
  const c = await db
    .query(
      'SELECT id, EXISTS (SELECT 1 FROM attempts WHERE competition_id = $1) AS started FROM competitions WHERE id = $1',
      [competitionId],
    )
    .then((r) => r.rows[0]);
  if (!c) throw notFound('Competition not found');
  if (c.started) throw conflict('Students have already started this competition, so its questions cannot be changed');
}

const STATS = `
  (SELECT COUNT(*) FROM competition_questions cq WHERE cq.competition_id = c.id) AS assigned_questions,
  (SELECT COUNT(*) FROM registrations r WHERE r.competition_id = c.id) AS registered_count,
  (SELECT COUNT(*) FROM attempts a WHERE a.competition_id = c.id AND a.status = 'in_progress') AS in_progress_count,
  (SELECT COUNT(*) FROM attempts a WHERE a.competition_id = c.id AND a.status = 'submitted') AS submitted_count`;

router.get('/', async (_req, res) => {
  res.json({ competitions: await many(`SELECT c.*, ${STATS} FROM competitions c ORDER BY c.start_time DESC`) });
});

router.get('/:id', async (req, res) => {
  const id = idParam(req);
  const competition = await one(
    `SELECT c.*, ${STATS},
            (SELECT ROUND(AVG(score), 2) FROM attempts a WHERE a.competition_id = c.id AND a.status = 'submitted') AS avg_score,
            (SELECT MAX(score) FROM attempts a WHERE a.competition_id = c.id AND a.status = 'submitted') AS top_score,
            EXISTS (SELECT 1 FROM attempts a WHERE a.competition_id = c.id) AS has_attempts
       FROM competitions c WHERE c.id = $1`,
    [id],
  );
  if (!competition) throw notFound('Competition not found');
  res.json({ competition, serverNow: new Date() });
});

const COLUMNS = [
  'title', 'description', 'rules', 'start_time', 'end_time', 'duration_minutes', 'question_count', 'shuffle_questions',
  'shuffle_options', 'negative_mark', 'max_tab_switches', 'status', 'registration_open', 'show_result_immediately',
  'show_answer_review',
];

router.post('/', async (req, res) => {
  const data = validate(competitionSchema, req.body);
  const competition = await one(
    `INSERT INTO competitions (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    COLUMNS.map((c) => data[c] ?? null),
  );
  res.status(201).json({ competition });
});

router.put('/:id', async (req, res) => {
  const id = idParam(req);
  const data = validate(competitionSchema, req.body);
  const competition = await one(
    `UPDATE competitions SET ${COLUMNS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now()
      WHERE id = $${COLUMNS.length + 1} RETURNING *`,
    [...COLUMNS.map((c) => data[c] ?? null), id],
  );
  if (!competition) throw notFound('Competition not found');
  res.json({ competition });
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM competitions WHERE id = $1', [idParam(req)]);
  if (!rowCount) throw notFound('Competition not found');
  res.json({ deleted: true });
});

// ---- Question assignment -------------------------------------------------------------------------------

router.get('/:id/questions', async (req, res) => {
  const questions = await many(
    `SELECT q.*, cq.position FROM competition_questions cq JOIN questions q ON q.id = cq.question_id
      WHERE cq.competition_id = $1 ORDER BY cq.position, q.id`,
    [idParam(req)],
  );
  res.json({ questions });
});

async function addQuestions(db, competitionId, questionIds) {
  const { rowCount } = await db.query(
    `INSERT INTO competition_questions (competition_id, question_id, position)
     SELECT $1, q.id, COALESCE((SELECT MAX(position) FROM competition_questions WHERE competition_id = $1), 0) + t.ord
       FROM unnest($2::int[]) WITH ORDINALITY AS t(id, ord)
       JOIN questions q ON q.id = t.id
     ON CONFLICT DO NOTHING`,
    [competitionId, questionIds],
  );
  return rowCount;
}

router.post('/:id/questions', async (req, res) => {
  const id = idParam(req);
  const { questionIds } = validate(z.object({ questionIds: z.array(z.number().int().positive()).min(1).max(5000) }), req.body);
  const added = await transaction(async (db) => {
    await assertQuestionsEditable(db, id);
    return addQuestions(db, id, questionIds);
  });
  res.json({ added });
});

router.post('/:id/questions/random', async (req, res) => {
  const id = idParam(req);
  const opts = validate(
    z.object({
      count: z.number().int().min(1).max(5000),
      category: z.string().trim().max(100).optional().default(''),
      difficulty: z.enum(['easy', 'medium', 'hard', '']).optional().default(''),
    }),
    req.body,
  );
  const added = await transaction(async (db) => {
    await assertQuestionsEditable(db, id);
    const { rows } = await db.query(
      `SELECT q.id FROM questions q
        WHERE ($2 = '' OR q.category = $2) AND ($3 = '' OR q.difficulty = $3)
          AND NOT EXISTS (SELECT 1 FROM competition_questions x WHERE x.competition_id = $1 AND x.question_id = q.id)
        ORDER BY random() LIMIT $4`,
      [id, opts.category, opts.difficulty, opts.count],
    );
    if (rows.length === 0) throw badRequest('No unassigned questions match these filters');
    return addQuestions(db, id, rows.map((r) => r.id));
  });
  res.json({ added });
});

router.delete('/:id/questions/:questionId', async (req, res) => {
  const id = idParam(req);
  const questionId = idParam(req, 'questionId');
  await transaction(async (db) => {
    await assertQuestionsEditable(db, id);
    await db.query('DELETE FROM competition_questions WHERE competition_id = $1 AND question_id = $2', [id, questionId]);
  });
  res.json({ removed: true });
});

router.delete('/:id/questions', async (req, res) => {
  const id = idParam(req);
  const removed = await transaction(async (db) => {
    await assertQuestionsEditable(db, id);
    return (await db.query('DELETE FROM competition_questions WHERE competition_id = $1', [id])).rowCount;
  });
  res.json({ removed });
});

// ---- Participants & results ----------------------------------------------------------------------------

const RANKED = `
  SELECT a.*, u.name, u.email, u.phone, u.college, u.department, u.year_of_study, u.roll_number,
         EXTRACT(EPOCH FROM (a.submitted_at - a.started_at))::int AS time_taken_seconds,
         RANK() OVER (ORDER BY a.score DESC, a.submitted_at - a.started_at ASC) AS rank
    FROM attempts a JOIN users u ON u.id = a.user_id
   WHERE a.competition_id = $1 AND a.status = 'submitted'`;

router.get('/:id/leaderboard', async (req, res) => {
  const id = idParam(req);
  const { limit, college } = validate(
    z.object({ limit: z.coerce.number().int().min(1).max(10000).default(50), college: z.string().trim().max(200).default('') }),
    req.query,
  );
  const rows = await many(
    `SELECT * FROM (${RANKED}) ranked WHERE ($2 = '' OR college = $2) ORDER BY rank, name LIMIT $3`,
    [id, college, limit],
  );
  const colleges = await many(
    `SELECT u.college, COUNT(*) AS participants, ROUND(AVG(a.score), 2) AS avg_score, MAX(a.score) AS top_score
       FROM attempts a JOIN users u ON u.id = a.user_id
      WHERE a.competition_id = $1 AND a.status = 'submitted'
      GROUP BY u.college ORDER BY avg_score DESC NULLS LAST`,
    [id],
  );
  res.json({ leaderboard: rows, colleges });
});

const participantsSchema = paginationSchema.extend({
  status: z.enum(['', 'registered', 'in_progress', 'submitted']).optional().default(''),
});

/** Every registered student with their attempt state (if any). */
router.get('/:id/participants', async (req, res) => {
  const id = idParam(req);
  const opts = validate(participantsSchema, req.query);
  const params = [id];
  const where = ['r.competition_id = $1'];
  if (opts.q) {
    params.push(`%${opts.q}%`);
    const p = `$${params.length}`;
    where.push(`(u.name ILIKE ${p} OR u.email ILIKE ${p} OR u.roll_number ILIKE ${p} OR u.college ILIKE ${p})`);
  }
  if (opts.status === 'registered') where.push('a.id IS NULL');
  else if (opts.status) {
    params.push(opts.status);
    where.push(`a.status = $${params.length}`);
  }
  const base = `FROM registrations r JOIN users u ON u.id = r.user_id
                LEFT JOIN attempts a ON a.competition_id = r.competition_id AND a.user_id = r.user_id
               WHERE ${where.join(' AND ')}`;
  const [items, total] = await Promise.all([
    many(
      `SELECT u.id AS user_id, u.name, u.email, u.college, u.roll_number, u.department, r.registered_at,
              a.id AS attempt_id, a.status, a.started_at, a.submitted_at, a.deadline, a.score, a.max_score,
              a.correct_count, a.wrong_count, a.unanswered_count, a.tab_switches, a.auto_submitted,
              (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.selected_option IS NOT NULL) AS answered
         ${base}
        ORDER BY a.score DESC NULLS LAST, u.name
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.pageSize, (opts.page - 1) * opts.pageSize],
    ),
    one(`SELECT COUNT(*) AS n ${base}`, params),
  ]);
  res.json({ items, total: total.n, page: opts.page, pageSize: opts.pageSize });
});

router.get('/:id/export', async (req, res) => {
  const id = idParam(req);
  const c = await one('SELECT title FROM competitions WHERE id = $1', [id]);
  if (!c) throw notFound('Competition not found');
  const rows = await many(`${RANKED} ORDER BY rank, u.name`, [id]);
  const columns = [
    { header: 'Rank', key: 'rank' },
    { header: 'Name', key: 'name' },
    { header: 'Email', key: 'email' },
    { header: 'Phone', key: 'phone' },
    { header: 'College', key: 'college' },
    { header: 'Department', key: 'department' },
    { header: 'Year', key: 'year_of_study' },
    { header: 'Roll Number', key: 'roll_number' },
    { header: 'Score', key: 'score' },
    { header: 'Max Score', key: 'max_score' },
    { header: 'Correct', key: 'correct_count' },
    { header: 'Wrong', key: 'wrong_count' },
    { header: 'Unanswered', key: 'unanswered_count' },
    { header: 'Time Taken (s)', key: 'time_taken_seconds' },
    { header: 'Tab Switches', key: 'tab_switches' },
    { header: 'Auto Submitted', value: (r) => (r.auto_submitted ? 'Yes' : 'No') },
    { header: 'Started At', key: 'started_at' },
    { header: 'Submitted At', key: 'submitted_at' },
  ];
  sendCsv(res, `${c.title}-results.csv`, toCsv(columns, rows));
});

router.post('/:id/publish-results', async (req, res) => {
  const { published } = validate(z.object({ published: z.boolean() }), req.body);
  const competition = await one(
    'UPDATE competitions SET results_published = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [published, idParam(req)],
  );
  if (!competition) throw notFound('Competition not found');
  res.json({ competition });
});

router.post('/:id/rescore', async (req, res) => {
  res.json({ rescored: await rescoreCompetition(idParam(req)) });
});

/** Ends every running attempt now (e.g. to close a competition early). */
router.post('/:id/force-submit', async (req, res) => {
  res.json({ submitted: await forceSubmitCompetition(idParam(req)) });
});

/** Deletes a student's attempt so they can start again (e.g. after a technical problem). */
router.delete('/:id/attempts/:userId', async (req, res) => {
  const { rowCount } = await query('DELETE FROM attempts WHERE competition_id = $1 AND user_id = $2', [
    idParam(req),
    idParam(req, 'userId'),
  ]);
  if (!rowCount) throw notFound('No attempt found for this student');
  res.json({ reset: true });
});

/** Registers students for this competition, by id list or everyone (optionally filtered by college). */
router.post('/:id/registrations', async (req, res) => {
  const id = idParam(req);
  const body = validate(
    z.object({
      userIds: z.array(z.number().int().positive()).max(20000).optional(),
      allStudents: z.boolean().optional(),
      college: z.string().trim().max(200).optional().default(''),
    }),
    req.body,
  );
  if (!body.userIds?.length && !body.allStudents) throw badRequest('Choose students to register');
  const exists = await one('SELECT 1 FROM competitions WHERE id = $1', [id]);
  if (!exists) throw notFound('Competition not found');
  const { rowCount } = body.allStudents
    ? await query(
        `INSERT INTO registrations (competition_id, user_id)
         SELECT $1, id FROM users WHERE role = 'student' AND is_active AND ($2 = '' OR college = $2)
         ON CONFLICT DO NOTHING`,
        [id, body.college],
      )
    : await query(
        `INSERT INTO registrations (competition_id, user_id)
         SELECT $1, id FROM users WHERE role = 'student' AND id = ANY($2::int[])
         ON CONFLICT DO NOTHING`,
        [id, body.userIds],
      );
  res.json({ registered: rowCount });
});

router.delete('/:id/registrations/:userId', async (req, res) => {
  const id = idParam(req);
  const userId = idParam(req, 'userId');
  const started = await one('SELECT 1 FROM attempts WHERE competition_id = $1 AND user_id = $2', [id, userId]);
  if (started) throw conflict('This student has already started; reset their attempt first');
  await query('DELETE FROM registrations WHERE competition_id = $1 AND user_id = $2', [id, userId]);
  res.json({ removed: true });
});

export default router;
