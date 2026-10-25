import { Router } from 'express';
import { query } from '../../db/pool.js';
import { requireAdmin } from '../../lib/auth.js';
import { competitionState } from '../../services/competitions.js';
import { competitionsRouter } from './competitions.js';
import { departmentsRouter } from './departments.js';
import { studentsRouter } from './students.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/stats', async (req, res) => {
  const [totals, competitions, departments] = await Promise.all([
    query(`SELECT
             (SELECT COUNT(*) FROM students) AS students,
             (SELECT COUNT(*) FROM students WHERE created_at > now() - interval '24 hours') AS students_last_24h,
             (SELECT COUNT(*) FROM departments) AS departments,
             (SELECT COUNT(*) FROM competitions) AS competitions,
             (SELECT COUNT(*) FROM attempts WHERE status = 'in_progress') AS active_attempts`),
    query(`SELECT c.*, r.registered, a.in_progress, a.finished
             FROM competitions c
             LEFT JOIN LATERAL (SELECT COUNT(*) AS registered FROM registrations WHERE competition_id = c.id) r ON true
             LEFT JOIN LATERAL (
               SELECT COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
                      COUNT(*) FILTER (WHERE status <> 'in_progress') AS finished
                 FROM attempts WHERE competition_id = c.id) a ON true
            WHERE c.ends_at > now() - interval '3 days'
            ORDER BY c.starts_at`),
    query(`SELECT d.id, d.name, d.code, COUNT(s.id) AS students
             FROM departments d LEFT JOIN students s ON s.department_id = d.id
            GROUP BY d.id ORDER BY students DESC, d.name`),
  ]);
  const t = totals.rows[0];
  const now = new Date();
  res.json({
    totals: {
      students: t.students,
      studentsLast24h: t.students_last_24h,
      departments: t.departments,
      competitions: t.competitions,
      activeAttempts: t.active_attempts,
    },
    competitions: competitions.rows.map((c) => ({
      id: c.id,
      title: c.title,
      startsAt: c.starts_at,
      endsAt: c.ends_at,
      state: competitionState(c, now),
      registered: c.registered,
      inProgress: c.in_progress,
      finished: c.finished,
    })),
    departments: departments.rows,
  });
});

adminRouter.use(competitionsRouter);
adminRouter.use(studentsRouter);
adminRouter.use(departmentsRouter);
