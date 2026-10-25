import { Router } from 'express';
import { many, one, query, transaction } from '../../db.js';
import { parseCsv, sendCsv, toCsv } from '../../lib/csv.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { paginationSchema, questionSchema, validate, z } from '../../lib/validate.js';
import { assertQuestionsEditable } from './competitions.js';

const router = Router();
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const idParam = (req) => validate(z.coerce.number().int().positive(), req.params.id);

const listSchema = paginationSchema.extend({
  category: z.string().trim().max(100).optional().default(''),
  difficulty: z.enum(['easy', 'medium', 'hard', '']).optional().default(''),
  excludeCompetition: z.coerce.number().int().positive().optional(),
});

function buildFilter({ q, category, difficulty, excludeCompetition }) {
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(q.text ILIKE $${params.length} OR q.options::text ILIKE $${params.length})`);
  }
  if (category) {
    params.push(category);
    where.push(`q.category = $${params.length}`);
  }
  if (difficulty) {
    params.push(difficulty);
    where.push(`q.difficulty = $${params.length}`);
  }
  if (excludeCompetition) {
    params.push(excludeCompetition);
    where.push(`NOT EXISTS (SELECT 1 FROM competition_questions x WHERE x.question_id = q.id AND x.competition_id = $${params.length})`);
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

router.get('/', async (req, res) => {
  const opts = validate(listSchema, req.query);
  const { where, params } = buildFilter(opts);
  const [items, total] = await Promise.all([
    many(
      `SELECT q.*, (SELECT COUNT(*) FROM competition_questions cq WHERE cq.question_id = q.id) AS used_in
         FROM questions q ${where}
        ORDER BY q.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.pageSize, (opts.page - 1) * opts.pageSize],
    ),
    one(`SELECT COUNT(*) AS n FROM questions q ${where}`, params),
  ]);
  res.json({ items, total: total.n, page: opts.page, pageSize: opts.pageSize });
});

router.get('/categories', async (_req, res) => {
  res.json({ categories: await many('SELECT category, COUNT(*) AS count FROM questions GROUP BY category ORDER BY category') });
});

router.get('/export', async (_req, res) => {
  const rows = await many('SELECT * FROM questions ORDER BY id');
  const columns = [
    { header: 'question', key: 'text' },
    ...LETTERS.map((l, i) => ({ header: `option_${l.toLowerCase()}`, value: (r) => r.options[i] ?? '' })),
    { header: 'correct', value: (r) => LETTERS[r.correct_option] },
    { header: 'category', key: 'category' },
    { header: 'difficulty', key: 'difficulty' },
    { header: 'marks', key: 'marks' },
    { header: 'explanation', key: 'explanation' },
    { header: 'image_url', key: 'image_url' },
  ];
  sendCsv(res, 'questions.csv', toCsv(columns, rows));
});

router.get('/:id', async (req, res) => {
  const question = await one('SELECT * FROM questions WHERE id = $1', [idParam(req)]);
  if (!question) throw notFound('Question not found');
  res.json({ question });
});

router.post('/', async (req, res) => {
  const q = validate(questionSchema, req.body);
  const question = await one(
    `INSERT INTO questions (text, image_url, options, correct_option, explanation, category, difficulty, marks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [q.text, q.image_url, JSON.stringify(q.options), q.correct_option, q.explanation, q.category, q.difficulty, q.marks],
  );
  res.status(201).json({ question });
});

router.put('/:id', async (req, res) => {
  const id = idParam(req);
  const q = validate(questionSchema, req.body);
  // Changing the number of options would invalidate option orders stored in existing attempts.
  const used = await one(
    `SELECT jsonb_array_length(options) AS option_count,
            EXISTS (SELECT 1 FROM attempt_answers WHERE question_id = $1) AS answered
       FROM questions WHERE id = $1`,
    [id],
  );
  if (!used) throw notFound('Question not found');
  if (used.answered && used.option_count !== q.options.length) {
    throw conflict('Students have already answered this question, so the number of options cannot change');
  }
  const question = await one(
    `UPDATE questions SET text = $1, image_url = $2, options = $3, correct_option = $4, explanation = $5,
            category = $6, difficulty = $7, marks = $8, updated_at = now()
      WHERE id = $9 RETURNING *`,
    [q.text, q.image_url, JSON.stringify(q.options), q.correct_option, q.explanation, q.category, q.difficulty, q.marks, id],
  );
  res.json({ question });
});

router.delete('/:id', async (req, res) => {
  const id = idParam(req);
  const used = await one('SELECT COUNT(*) AS n FROM competition_questions WHERE question_id = $1', [id]);
  if (used.n > 0) throw conflict(`This question is used in ${used.n} competition(s). Remove it from them first.`);
  const { rowCount } = await query('DELETE FROM questions WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Question not found');
  res.json({ deleted: true });
});

/** Converts a CSV row (question, option_a..option_f, correct, ...) into question input. */
function rowToQuestion(row) {
  const options = LETTERS.map((l) => row[`option_${l.toLowerCase()}`] ?? row[l.toLowerCase()] ?? '').filter((o) => o !== '');
  const correctRaw = String(row.correct ?? row.answer ?? row.correct_option ?? '').trim().toUpperCase();
  let correct = LETTERS.indexOf(correctRaw);
  if (correct === -1 && /^[1-6]$/.test(correctRaw)) correct = Number(correctRaw) - 1;
  return {
    text: row.question ?? row.text ?? '',
    options,
    correct_option: correct,
    category: row.category || 'General',
    difficulty: (row.difficulty || 'medium').toLowerCase(),
    marks: row.marks || 1,
    explanation: row.explanation || null,
    image_url: row.image_url || null,
  };
}

const importSchema = z.object({
  csv: z.string().max(10 * 1024 * 1024),
  competitionId: z.number().int().positive().nullable().optional(),
});

router.post('/import', async (req, res) => {
  const { csv, competitionId } = validate(importSchema, req.body);
  const rows = parseCsv(csv);
  if (rows.length > 20000) throw badRequest('Import at most 20,000 questions at a time');

  const valid = [];
  const errors = [];
  rows.forEach((row, i) => {
    try {
      valid.push(validate(questionSchema, rowToQuestion(row)));
    } catch (err) {
      errors.push({ row: i + 2, message: err.message });
    }
  });

  const inserted = await transaction(async (db) => {
    if (competitionId) await assertQuestionsEditable(db, competitionId);
    if (valid.length === 0) return 0;
    const { rows: ids } = await db.query(
      `INSERT INTO questions (text, image_url, options, correct_option, explanation, category, difficulty, marks)
       SELECT text, image_url, options, correct_option, explanation, category, difficulty, marks
         FROM jsonb_to_recordset($1::jsonb) AS x(text text, image_url text, options jsonb, correct_option smallint,
              explanation text, category text, difficulty text, marks numeric)
       RETURNING id`,
      [JSON.stringify(valid)],
    );
    if (competitionId) {
      await db.query(
        `INSERT INTO competition_questions (competition_id, question_id, position)
         SELECT $1, id, COALESCE((SELECT MAX(position) FROM competition_questions WHERE competition_id = $1), 0) + ord
           FROM unnest($2::int[]) WITH ORDINALITY AS t(id, ord)
         ON CONFLICT DO NOTHING`,
        [competitionId, ids.map((r) => r.id)],
      );
    }
    return ids.length;
  });

  res.json({ inserted, failed: errors.length, errors: errors.slice(0, 200) });
});

export default router;
