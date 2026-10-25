// Adds sample departments and a published demo competition (starting in 2 minutes)
// so you can try the full student flow locally. Safe to run more than once.
import { migrate } from '../src/db/migrate.js';
import { pool, query } from '../src/db/pool.js';

const DEPARTMENTS = [
  ['Computer Science and Engineering', 'CSE'],
  ['Information Technology', 'IT'],
  ['Electronics and Communication Engineering', 'ECE'],
  ['Electrical and Electronics Engineering', 'EEE'],
  ['Mechanical Engineering', 'MECH'],
  ['Civil Engineering', 'CIVIL'],
];

const QUESTIONS = [
  ['Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Mercury'], 1],
  ['What does CPU stand for?', ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Control Processing Unit'], 0],
  ['Which gas do plants absorb from the atmosphere?', ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], 2],
  ['What is the binary representation of decimal 10?', ['1001', '1010', '1100', '1110'], 1],
  ['Who proposed the theory of relativity?', ['Isaac Newton', 'Niels Bohr', 'Albert Einstein', 'Galileo Galilei'], 2],
  ['What is the SI unit of electrical resistance?', ['Volt', 'Ampere', 'Watt', 'Ohm'], 3],
  ['Which data structure works on the FIFO principle?', ['Stack', 'Queue', 'Tree', 'Graph'], 1],
  ['What is the chemical symbol for gold?', ['Ag', 'Gd', 'Au', 'Go'], 2],
  ['How many bits are there in one byte?', ['4', '8', '16', '32'], 1],
  ['Which is the largest ocean on Earth?', ['Atlantic', 'Indian', 'Arctic', 'Pacific'], 3],
  ['Which language is primarily used to style web pages?', ['HTML', 'CSS', 'Python', 'SQL'], 1],
  ['What is the value of π (pi) rounded to two decimals?', ['3.12', '3.14', '3.16', '3.41'], 1],
];

try {
  await migrate();
  for (const [name, code] of DEPARTMENTS) {
    await query('INSERT INTO departments (name, code) VALUES ($1, $2) ON CONFLICT DO NOTHING', [name, code]);
  }
  const { rows } = await query(
    `INSERT INTO competitions (title, description, instructions, starts_at, ends_at, duration_minutes,
       results_visibility, is_published)
     VALUES ('Demo General Knowledge Quiz', 'A short sample quiz to try out the platform.',
             E'Answer all questions. Each correct answer earns 1 mark.\nThere is no negative marking.\nDo not switch tabs during the quiz.',
             now() + interval '2 minutes', now() + interval '2 hours', 10, 'immediate', true)
     RETURNING id`,
  );
  const competitionId = rows[0].id;
  for (const [i, [text, options, correct]] of QUESTIONS.entries()) {
    await query(
      `INSERT INTO questions (competition_id, text, options, correct_option, position) VALUES ($1, $2, $3, $4, $5)`,
      [competitionId, text, JSON.stringify(options), correct, i + 1],
    );
  }
  console.log(`Seeded ${DEPARTMENTS.length} departments and demo competition #${competitionId} (${QUESTIONS.length} questions).`);
} finally {
  await pool.end();
}
