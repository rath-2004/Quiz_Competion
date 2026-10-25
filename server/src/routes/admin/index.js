import { Router } from 'express';
import { many, one } from '../../db.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import competitions from './competitions.js';
import questions from './questions.js';
import students from './students.js';

const router = Router();
router.use(authenticate, requireRole('admin'));

router.get('/stats', async (_req, res) => {
  const [totals, live, upcoming, signups, colleges] = await Promise.all([
    one(`SELECT
           (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
           (SELECT COUNT(*) FROM users WHERE role = 'student' AND NOT is_active) AS blocked_students,
           (SELECT COUNT(DISTINCT college) FROM users WHERE role = 'student') AS colleges,
           (SELECT COUNT(*) FROM questions) AS questions,
           (SELECT COUNT(*) FROM competitions) AS competitions,
           (SELECT COUNT(*) FROM registrations) AS registrations,
           (SELECT COUNT(*) FROM attempts WHERE status = 'submitted') AS submissions,
           (SELECT COUNT(*) FROM attempts WHERE status = 'in_progress') AS in_progress`),
    many(`SELECT c.id, c.title, c.start_time, c.end_time,
                 (SELECT COUNT(*) FROM registrations r WHERE r.competition_id = c.id) AS registered_count,
                 (SELECT COUNT(*) FROM attempts a WHERE a.competition_id = c.id AND a.status = 'in_progress') AS in_progress_count,
                 (SELECT COUNT(*) FROM attempts a WHERE a.competition_id = c.id AND a.status = 'submitted') AS submitted_count
            FROM competitions c
           WHERE c.status = 'published' AND now() BETWEEN c.start_time AND c.end_time
           ORDER BY c.end_time`),
    many(`SELECT c.id, c.title, c.start_time, c.end_time, c.status,
                 (SELECT COUNT(*) FROM registrations r WHERE r.competition_id = c.id) AS registered_count
            FROM competitions c WHERE c.start_time > now() ORDER BY c.start_time LIMIT 5`),
    many(`SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(u.id) AS count
            FROM generate_series(current_date - 13, current_date, interval '1 day') AS d
            LEFT JOIN users u ON u.role = 'student' AND u.created_at >= d AND u.created_at < d + interval '1 day'
           GROUP BY d ORDER BY d`),
    many(`SELECT college, COUNT(*) AS count FROM users WHERE role = 'student'
           GROUP BY college ORDER BY count DESC LIMIT 8`),
  ]);
  res.json({ totals, live, upcoming, signups, colleges, serverNow: new Date() });
});

router.use('/questions', questions);
router.use('/competitions', competitions);
router.use('/students', students);

export default router;
