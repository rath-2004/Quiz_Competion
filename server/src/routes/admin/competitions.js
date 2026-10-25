import { Router } from 'express';
import { parse as parseCsv } from 'csv-parse/sync';
import multer from 'multer';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { sendCsv, toCsv } from '../../lib/csv.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { likePattern, pagination, parse, parseId } from '../../lib/validate.js';
import { rescoreCompetition } from '../../services/attempts.js';
import { invalidateCompetition, toAdminCompetition } from '../../services/competitions.js';

export const competitionsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

// ---------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------

const competitionSchema = z
  .object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
    description: z.string().trim().max(5000).default(''),
    instructions: z.string().trim().max(10000).default(''),
    startsAt: z.coerce.date({ error: 'Enter a valid start time' }),
    endsAt: z.coerce.date({ error: 'Enter a valid end time' }),
    durationMinutes: z.coerce.number().int().min(1, 'Duration must be at least 1 minute').max(600),
    questionsPerAttempt: z.coerce.number().int().min(1).max(5000).nullable().default(null),
    shuffleQuestions: z.boolean().default(true),
    shuffleOptions: z.boolean().default(true),
    resultsVisibility: z.enum(['immediate', 'after_end', 'hidden']).default('after_end'),
    isPublished: z.boolean().default(false),
  })
  .refine((c) => c.endsAt > c.startsAt, { message: 'End time must be after the start time', path: ['endsAt'] });

const COMPETITION_STATS = `
  SELECT c.*, q.question_count, r.registered, a.started, a.in_progress, a.finished
    FROM competitions c
    LEFT JOIN LATERAL (SELECT COUNT(*) AS question_count FROM questions WHERE competition_id = c.id) q ON true
    LEFT JOIN LATERAL (SELECT COUNT(*) AS registered FROM registrations WHERE competition_id = c.id) r ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS started,
             COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
             COUNT(*) FILTER (WHERE status <> 'in_progress') AS finished
        FROM attempts WHERE competition_id = c.id) a ON true`;

function withStats(row) {
  return {
    ...toAdminCompetition(row),
    stats: {
      questions: row.question_count,
      registered: row.registered,
      started: row.started,
      inProgress: row.in_progress,
      finished: row.finished,
    },
  };
}

async function loadCompetition(id) {
  const { rows } = await query(`${COMPETITION_STATS} WHERE c.id = $1`, [id]);
  if (!rows[0]) throw notFound('Competition not found');
  return rows[0];
}

competitionsRouter.get('/competitions', async (req, res) => {
  const { rows } = await query(`${COMPETITION_STATS} ORDER BY c.starts_at DESC`);
  res.json({ competitions: rows.map(withStats) });
});

competitionsRouter.post('/competitions', async (req, res) => {
  const c = parse(competitionSchema, req.body);
  const { rows } = await query(
    `INSERT INTO competitions (title, description, instructions, starts_at, ends_at, duration_minutes,
       questions_per_attempt, shuffle_questions, shuffle_options, results_visibility, is_published)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      c.title, c.description, c.instructions, c.startsAt, c.endsAt, c.durationMinutes,
      c.questionsPerAttempt, c.shuffleQuestions, c.shuffleOptions, c.resultsVisibility, c.isPublished,
    ],
  );
  res.status(201).json({ competition: withStats(await loadCompetition(rows[0].id)) });
});

competitionsRouter.get('/competitions/:id', async (req, res) => {
  res.json({ competition: withStats(await loadCompetition(parseId(req.params.id))) });
});

async function assertHasQuestions(id) {
  const { rows } = await query('SELECT COUNT(*) AS n FROM questions WHERE competition_id = $1', [id]);
  if (rows[0].n === 0) throw conflict('Add at least one question before publishing');
}

competitionsRouter.put('/competitions/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const c = parse(competitionSchema, req.body);
  if (c.isPublished) await assertHasQuestions(id);
  const { rowCount } = await query(
    `UPDATE competitions SET title = $2, description = $3, instructions = $4, starts_at = $5, ends_at = $6,
       duration_minutes = $7, questions_per_attempt = $8, shuffle_questions = $9, shuffle_options = $10,
       results_visibility = $11, is_published = $12, updated_at = now()
     WHERE id = $1`,
    [
      id, c.title, c.description, c.instructions, c.startsAt, c.endsAt, c.durationMinutes,
      c.questionsPerAttempt, c.shuffleQuestions, c.shuffleOptions, c.resultsVisibility, c.isPublished,
    ],
  );
  if (!rowCount) throw notFound('Competition not found');
  invalidateCompetition(id);
  res.json({ competition: withStats(await loadCompetition(id)) });
});

competitionsRouter.post('/competitions/:id/publish', async (req, res) => {
  const id = parseId(req.params.id);
  const { isPublished } = parse(z.object({ isPublished: z.boolean() }), req.body);
  if (isPublished) await assertHasQuestions(id);
  const { rowCount } = await query('UPDATE competitions SET is_published = $2, updated_at = now() WHERE id = $1', [
    id,
    isPublished,
  ]);
  if (!rowCount) throw notFound('Competition not found');
  invalidateCompetition(id);
  res.json({ competition: withStats(await loadCompetition(id)) });
});

competitionsRouter.delete('/competitions/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { rowCount } = await query('DELETE FROM competitions WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Competition not found');
  invalidateCompetition(id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

const questionSchema = z
  .object({
    text: z.string().trim().min(1, 'Enter the question').max(5000),
    options: z
      .array(z.string().trim().min(1, 'Options cannot be empty').max(1000))
      .min(2, 'Add at least 2 options')
      .max(6, 'At most 6 options are allowed'),
    correctOption: z.coerce.number().int().min(0),
    marks: z.coerce.number().min(0).max(1000).default(1),
    negativeMarks: z.coerce.number().min(0).max(1000).default(0),
    explanation: z.string().trim().max(5000).default(''),
    position: z.coerce.number().int().min(0).optional(),
  })
  .refine((q) => q.correctOption < q.options.length, {
    message: 'Choose which option is correct',
    path: ['correctOption'],
  });

function toQuestion(q) {
  return {
    id: q.id,
    competitionId: q.competition_id,
    text: q.text,
    options: q.options,
    correctOption: q.correct_option,
    marks: q.marks,
    negativeMarks: q.negative_marks,
    explanation: q.explanation,
    position: q.position,
  };
}

async function ensureCompetition(id) {
  const { rows } = await query(
    `SELECT id, EXISTS (SELECT 1 FROM attempts WHERE competition_id = $1) AS has_attempts FROM competitions WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound('Competition not found');
  return rows[0];
}

competitionsRouter.get('/competitions/:id/questions', async (req, res) => {
  const id = parseId(req.params.id);
  await ensureCompetition(id);
  const { rows } = await query('SELECT * FROM questions WHERE competition_id = $1 ORDER BY position, id', [id]);
  res.json({ questions: rows.map(toQuestion) });
});

competitionsRouter.post('/competitions/:id/questions', async (req, res) => {
  const id = parseId(req.params.id);
  await ensureCompetition(id);
  const q = parse(questionSchema, req.body);
  const { rows } = await query(
    `INSERT INTO questions (competition_id, text, options, correct_option, marks, negative_marks, explanation, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             COALESCE($8, (SELECT COALESCE(MAX(position), 0) + 1 FROM questions WHERE competition_id = $1)))
     RETURNING *`,
    [id, q.text, JSON.stringify(q.options), q.correctOption, q.marks, q.negativeMarks, q.explanation, q.position ?? null],
  );
  invalidateCompetition(id);
  res.status(201).json({ question: toQuestion(rows[0]) });
});

competitionsRouter.put('/questions/:questionId', async (req, res) => {
  const questionId = parseId(req.params.questionId);
  const q = parse(questionSchema, req.body);
  const { rows } = await query(
    `UPDATE questions SET text = $2, options = $3, correct_option = $4, marks = $5, negative_marks = $6,
       explanation = $7, position = COALESCE($8, position), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [questionId, q.text, JSON.stringify(q.options), q.correctOption, q.marks, q.negativeMarks, q.explanation, q.position ?? null],
  );
  if (!rows[0]) throw notFound('Question not found');
  invalidateCompetition(rows[0].competition_id);
  res.json({ question: toQuestion(rows[0]) });
});

competitionsRouter.delete('/questions/:questionId', async (req, res) => {
  const questionId = parseId(req.params.questionId);
  const { rows } = await query('SELECT competition_id FROM questions WHERE id = $1', [questionId]);
  if (!rows[0]) throw notFound('Question not found');
  const competition = await ensureCompetition(rows[0].competition_id);
  if (competition.has_attempts) {
    throw conflict('Students have already started this competition, so questions can no longer be deleted. Edit it instead.');
  }
  await query('DELETE FROM questions WHERE id = $1', [questionId]);
  invalidateCompetition(rows[0].competition_id);
  res.json({ ok: true });
});

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Accepts a letter ("B"), the exact option text, or the option number ("2") as the correct answer. */
function parseCorrect(value, options) {
  const v = String(value ?? '').trim();
  if (!v) return -1;
  const letter = LETTERS.indexOf(v.toUpperCase());
  if (letter !== -1) return letter;
  const byText = options.findIndex((o) => o.toLowerCase() === v.toLowerCase());
  if (byText !== -1) return byText;
  if (/^\d+$/.test(v)) return Number(v) - 1;
  return -1;
}

competitionsRouter.post('/competitions/:id/questions/import', upload.single('file'), async (req, res) => {
  const id = parseId(req.params.id);
  await ensureCompetition(id);
  if (!req.file) throw badRequest('Choose a CSV file to upload');

  let records;
  try {
    records = parseCsv(req.file.buffer, {
      bom: true,
      columns: (header) => header.map((h) => String(h).trim().toLowerCase().replace(/[\s-]+/g, '_')),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    throw badRequest(`Could not read the CSV file: ${err.message}`);
  }
  if (records.length === 0) throw badRequest('The CSV file has no question rows');
  if (records.length > 2000) throw badRequest('Import at most 2000 questions at a time');

  const valid = [];
  const errors = [];
  records.forEach((r, i) => {
    const options = LETTERS.map((l) => r[`option_${l.toLowerCase()}`] ?? r[l.toLowerCase()] ?? '').filter(
      (o) => o !== '',
    );
    const result = questionSchema.safeParse({
      text: r.question ?? r.question_text ?? '',
      options,
      correctOption: parseCorrect(r.correct ?? r.answer ?? r.correct_option, options),
      marks: r.marks || 1,
      negativeMarks: r.negative_marks || 0,
      explanation: r.explanation ?? '',
    });
    if (result.success) valid.push(result.data);
    // Row 1 is the header, so data rows start at 2 (matching what spreadsheet apps show).
    else errors.push({ row: i + 2, message: result.error.issues.map((x) => x.message).join('; ') });
  });
  if (errors.length) {
    throw badRequest(`${errors.length} row(s) have problems. Nothing was imported.`, errors.slice(0, 50));
  }

  const inserted = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT COALESCE(MAX(position), 0) AS max FROM questions WHERE competition_id = $1',
      [id],
    );
    const payload = valid.map((q, i) => ({
      text: q.text,
      options: q.options,
      correct_option: q.correctOption,
      marks: q.marks,
      negative_marks: q.negativeMarks,
      explanation: q.explanation,
      position: rows[0].max + i + 1,
    }));
    const result = await client.query(
      `INSERT INTO questions (competition_id, text, options, correct_option, marks, negative_marks, explanation, position)
       SELECT $1, x.text, x.options, x.correct_option, x.marks, x.negative_marks, x.explanation, x.position
         FROM jsonb_to_recordset($2::jsonb) AS x(text text, options jsonb, correct_option smallint, marks numeric,
                                                  negative_marks numeric, explanation text, position int)`,
      [id, JSON.stringify(payload)],
    );
    return result.rowCount;
  });
  invalidateCompetition(id);
  res.status(201).json({ imported: inserted });
});

// ---------------------------------------------------------------------------
// Participants, live monitoring and results
// ---------------------------------------------------------------------------

competitionsRouter.get('/competitions/:id/participants', async (req, res) => {
  const id = parseId(req.params.id);
  await ensureCompetition(id);
  const { page, pageSize, offset } = pagination(req.query);
  const where = ['r.competition_id = $1'];
  const params = [id];
  const pattern = likePattern(req.query.search);
  if (pattern) {
    params.push(pattern);
    where.push(`(s.name ILIKE $${params.length} OR s.register_no ILIKE $${params.length} OR s.email ILIKE $${params.length})`);
  }
  if (req.query.status === 'not_started') where.push('a.id IS NULL');
  if (req.query.status === 'in_progress') where.push(`a.status = 'in_progress'`);
  if (req.query.status === 'finished') where.push(`a.status <> 'in_progress'`);
  const from = `FROM registrations r
    JOIN students s ON s.id = r.student_id
    JOIN departments d ON d.id = s.department_id
    LEFT JOIN attempts a ON a.competition_id = r.competition_id AND a.student_id = r.student_id
    WHERE ${where.join(' AND ')}`;
  const n = params.length;
  const [list, count] = await Promise.all([
    query(
      `SELECT s.id AS student_id, s.name, s.register_no, s.email, s.phone, d.name AS department, s.year_of_study,
              r.registered_at, a.id AS attempt_id, a.status, a.started_at, a.submitted_at, a.deadline_at,
              a.score, a.max_score, a.tab_switches, a.ip_address, cardinality(a.question_ids) AS total_questions,
              (SELECT COUNT(*) FROM attempt_answers aa
                WHERE aa.attempt_id = a.id AND aa.selected_option IS NOT NULL) AS answered
       ${from}
       ORDER BY r.registered_at DESC
       LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...params, pageSize, offset],
    ),
    query(`SELECT COUNT(*) AS total ${from}`, params),
  ]);
  res.json({
    items: list.rows.map((r) => ({
      studentId: r.student_id,
      name: r.name,
      registerNo: r.register_no,
      email: r.email,
      phone: r.phone,
      department: r.department,
      yearOfStudy: r.year_of_study,
      registeredAt: r.registered_at,
      attempt: r.attempt_id
        ? {
            id: r.attempt_id,
            status: r.status,
            startedAt: r.started_at,
            submittedAt: r.submitted_at,
            deadlineAt: r.deadline_at,
            score: r.score,
            maxScore: r.max_score,
            tabSwitches: r.tab_switches,
            ipAddress: r.ip_address,
            answered: r.answered,
            totalQuestions: r.total_questions,
          }
        : null,
    })),
    total: count.rows[0].total,
    page,
    pageSize,
  });
});

const RESULTS_SQL = `
  SELECT RANK() OVER (ORDER BY a.score DESC, (a.submitted_at - a.started_at)) AS rank,
         a.id AS attempt_id, s.id AS student_id, s.name, s.register_no, s.email, s.phone,
         d.name AS department, s.year_of_study, a.score, a.max_score, a.correct_count, a.wrong_count,
         cardinality(a.question_ids) - a.correct_count - a.wrong_count AS unanswered_count,
         EXTRACT(EPOCH FROM (a.submitted_at - a.started_at))::int AS time_taken_seconds,
         a.started_at, a.submitted_at, a.status, a.tab_switches
    FROM attempts a
    JOIN students s ON s.id = a.student_id
    JOIN departments d ON d.id = s.department_id
   WHERE a.competition_id = $1 AND a.status <> 'in_progress'`;

function toResult(r) {
  return {
    rank: r.rank,
    attemptId: r.attempt_id,
    studentId: r.student_id,
    name: r.name,
    registerNo: r.register_no,
    email: r.email,
    phone: r.phone,
    department: r.department,
    yearOfStudy: r.year_of_study,
    score: r.score,
    maxScore: r.max_score,
    correctCount: r.correct_count,
    wrongCount: r.wrong_count,
    unansweredCount: r.unanswered_count,
    timeTakenSeconds: r.time_taken_seconds,
    startedAt: r.started_at,
    submittedAt: r.submitted_at,
    status: r.status,
    tabSwitches: r.tab_switches,
  };
}

competitionsRouter.get('/competitions/:id/results', async (req, res) => {
  const id = parseId(req.params.id);
  await ensureCompetition(id);
  const { page, pageSize, offset } = pagination(req.query, { defaultSize: 50 });
  const [list, count, summary, departments] = await Promise.all([
    query(`${RESULTS_SQL} ORDER BY rank, s.name LIMIT $2 OFFSET $3`, [id, pageSize, offset]),
    query(`SELECT COUNT(*) AS total FROM attempts WHERE competition_id = $1 AND status <> 'in_progress'`, [id]),
    query(
      `SELECT ROUND(AVG(score), 2) AS average, MAX(score) AS highest, MIN(score) AS lowest,
              ROUND(AVG(EXTRACT(EPOCH FROM (submitted_at - started_at)))) AS average_time_seconds
         FROM attempts WHERE competition_id = $1 AND status <> 'in_progress'`,
      [id],
    ),
    query(
      `SELECT d.name AS department, COUNT(*) AS participants, ROUND(AVG(a.score), 2) AS average_score,
              MAX(a.score) AS top_score
         FROM attempts a
         JOIN students s ON s.id = a.student_id
         JOIN departments d ON d.id = s.department_id
        WHERE a.competition_id = $1 AND a.status <> 'in_progress'
        GROUP BY d.name
        ORDER BY average_score DESC, d.name`,
      [id],
    ),
  ]);
  const s = summary.rows[0];
  res.json({
    items: list.rows.map(toResult),
    total: count.rows[0].total,
    page,
    pageSize,
    summary: {
      average: s.average,
      highest: s.highest,
      lowest: s.lowest,
      averageTimeSeconds: s.average_time_seconds,
    },
    departments: departments.rows.map((d) => ({
      department: d.department,
      participants: d.participants,
      averageScore: d.average_score,
      topScore: d.top_score,
    })),
  });
});

competitionsRouter.get('/competitions/:id/results.csv', async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: comp } = await query('SELECT title FROM competitions WHERE id = $1', [id]);
  if (!comp[0]) throw notFound('Competition not found');
  const { rows } = await query(`${RESULTS_SQL} ORDER BY rank, s.name`, [id]);
  const csv = toCsv(rows.map(toResult), [
    { header: 'Rank', value: (r) => r.rank },
    { header: 'Register No', value: (r) => r.registerNo },
    { header: 'Name', value: (r) => r.name },
    { header: 'Department', value: (r) => r.department },
    { header: 'Year', value: (r) => r.yearOfStudy },
    { header: 'Email', value: (r) => r.email },
    { header: 'Phone', value: (r) => r.phone },
    { header: 'Score', value: (r) => r.score },
    { header: 'Max Score', value: (r) => r.maxScore },
    { header: 'Correct', value: (r) => r.correctCount },
    { header: 'Wrong', value: (r) => r.wrongCount },
    { header: 'Unanswered', value: (r) => r.unansweredCount },
    { header: 'Time Taken (s)', value: (r) => r.timeTakenSeconds },
    { header: 'Submitted At', value: (r) => r.submittedAt },
    { header: 'Submission', value: (r) => (r.status === 'auto_submitted' ? 'Auto (time up)' : 'Manual') },
    { header: 'Tab Switches', value: (r) => r.tabSwitches },
  ]);
  sendCsv(res, `results-${comp[0].title}.csv`, csv);
});

competitionsRouter.post('/competitions/:id/rescore', async (req, res) => {
  const id = parseId(req.params.id);
  await ensureCompetition(id);
  const rescored = await rescoreCompetition(id);
  invalidateCompetition(id);
  res.json({ rescored });
});

/** Lets a student retake the quiz from scratch, e.g. after a genuine technical problem. */
competitionsRouter.delete('/attempts/:attemptId', async (req, res) => {
  const attemptId = parseId(req.params.attemptId);
  const { rows } = await query('DELETE FROM attempts WHERE id = $1 RETURNING competition_id', [attemptId]);
  if (!rows[0]) throw notFound('Attempt not found');
  invalidateCompetition(rows[0].competition_id);
  res.json({ ok: true });
});
