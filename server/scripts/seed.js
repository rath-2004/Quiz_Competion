// Seeds demo data: admin, a sample question bank, two competitions and demo students.
// Usage: npm run seed                 (demo data)
//        npm run seed -- --students 5000   (also bulk-create N synthetic students for load testing)
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { hashPassword } from '../src/lib/password.js';
import { ensureAdmin, migrate } from '../src/migrate.js';

const QUESTIONS = [
  ['General Knowledge', 'easy', 'What is the capital of India?', ['Mumbai', 'New Delhi', 'Kolkata', 'Chennai'], 1],
  ['General Knowledge', 'easy', 'Which planet is known as the Red Planet?', ['Venus', 'Jupiter', 'Mars', 'Mercury'], 2],
  ['General Knowledge', 'medium', 'Who wrote the national anthem of India, "Jana Gana Mana"?', ['Bankim Chandra Chatterjee', 'Rabindranath Tagore', 'Sarojini Naidu', 'Subramania Bharati'], 1],
  ['General Knowledge', 'medium', 'Which is the longest river in the world?', ['Amazon', 'Nile', 'Yangtze', 'Ganga'], 1],
  ['General Knowledge', 'easy', 'How many continents are there on Earth?', ['5', '6', '7', '8'], 2],
  ['General Knowledge', 'medium', 'ISRO\'s Chandrayaan-3 landed near which region of the Moon?', ['North pole', 'South pole', 'Equator', 'Far side centre'], 1],
  ['General Knowledge', 'hard', 'In which year was the Indian Constitution adopted by the Constituent Assembly?', ['1947', '1949', '1950', '1952'], 1],
  ['General Knowledge', 'easy', 'Which gas do plants absorb from the atmosphere for photosynthesis?', ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], 2],
  ['General Knowledge', 'medium', 'What is the chemical symbol for gold?', ['Go', 'Gd', 'Au', 'Ag'], 2],
  ['General Knowledge', 'hard', 'Which Indian scientist won the Nobel Prize in Physics in 1930?', ['Homi Bhabha', 'C. V. Raman', 'S. N. Bose', 'Meghnad Saha'], 1],
  ['Aptitude', 'easy', 'What is 15% of 200?', ['20', '25', '30', '35'], 2],
  ['Aptitude', 'medium', 'A train travels 360 km in 4 hours. What is its average speed?', ['80 km/h', '90 km/h', '100 km/h', '120 km/h'], 1],
  ['Aptitude', 'medium', 'Find the next number in the series: 2, 6, 12, 20, 30, ?', ['40', '42', '44', '36'], 1],
  ['Aptitude', 'easy', 'If 5 pens cost ₹60, how much do 8 pens cost?', ['₹80', '₹90', '₹96', '₹100'], 2],
  ['Aptitude', 'hard', 'A can finish a work in 12 days and B in 18 days. Working together, how many days will they take?', ['6.0', '7.2', '8.0', '9.0'], 1],
  ['Aptitude', 'medium', 'The average of 5 consecutive odd numbers is 27. What is the largest number?', ['29', '31', '33', '35'], 1],
  ['Aptitude', 'hard', 'In how many ways can the letters of the word "LEVEL" be arranged?', ['20', '30', '60', '120'], 1],
  ['Aptitude', 'easy', 'Simplify: 3/4 + 1/8', ['7/8', '5/8', '1', '4/12'], 0],
  ['Aptitude', 'medium', 'A shopkeeper sells an item for ₹540 at a 20% profit. What was the cost price?', ['₹420', '₹432', '₹450', '₹480'], 2],
  ['Aptitude', 'hard', 'What is the probability of getting a sum of 7 when two dice are thrown?', ['1/12', '1/9', '1/6', '1/3'], 2],
  ['Computer Science', 'easy', 'What does CPU stand for?', ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Control Processing Unit'], 0],
  ['Computer Science', 'easy', 'Which of these is NOT a programming language?', ['Python', 'Java', 'HTML', 'C++'], 2],
  ['Computer Science', 'medium', 'What is the time complexity of binary search on a sorted array?', ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], 1],
  ['Computer Science', 'medium', 'Which data structure works on the LIFO principle?', ['Queue', 'Stack', 'Linked list', 'Tree'], 1],
  ['Computer Science', 'medium', 'Which SQL command is used to remove all rows from a table but keep its structure?', ['DROP', 'DELETE TABLE', 'TRUNCATE', 'REMOVE'], 2],
  ['Computer Science', 'hard', 'Which layer of the OSI model is responsible for routing?', ['Data link', 'Transport', 'Network', 'Session'], 2],
  ['Computer Science', 'easy', 'What does "HTTP" stand for?', ['HyperText Transfer Protocol', 'High Transfer Text Protocol', 'Hyperlink Text Transport Program', 'Host Transfer Type Protocol'], 0],
  ['Computer Science', 'hard', 'What is the worst-case time complexity of QuickSort?', ['O(n log n)', 'O(n)', 'O(n²)', 'O(log n)'], 2],
  ['Computer Science', 'medium', 'In binary, what is the decimal number 13?', ['1101', '1011', '1110', '1001'], 0],
  ['Computer Science', 'hard', 'Which of the following is a non-volatile memory?', ['RAM', 'Cache', 'Registers', 'ROM'], 3],
];

const DEMO_STUDENTS = [
  ['Aarav Sharma', 'aarav@student.demo', 'Government Engineering College', 'CSE', 3, 'GEC2023CS001'],
  ['Priya Nair', 'priya@student.demo', 'St. Joseph\'s College', 'Physics', 2, 'SJC22PH014'],
  ['Rahul Verma', 'rahul@student.demo', 'National Institute of Technology', 'ECE', 4, 'NIT21EC045'],
];
const DEMO_PASSWORD = 'Student@123';

const args = process.argv.slice(2);
const bulkIndex = args.indexOf('--students');
const bulkCount = bulkIndex >= 0 ? Number(args[bulkIndex + 1]) : 0;

try {
  await migrate();
  if (config.admin.password) await ensureAdmin(config.admin);

  const { rows: [{ n: questionCount }] } = await pool.query('SELECT COUNT(*)::int AS n FROM questions');
  let questionIds;
  if (questionCount === 0) {
    const { rows } = await pool.query(
      `INSERT INTO questions (category, difficulty, text, options, correct_option, explanation, marks)
       SELECT category, difficulty, text, options, correct_option, NULL, CASE difficulty WHEN 'hard' THEN 2 ELSE 1 END
         FROM jsonb_to_recordset($1::jsonb) AS x(category text, difficulty text, text text, options jsonb, correct_option smallint)
       RETURNING id`,
      [JSON.stringify(QUESTIONS.map(([category, difficulty, text, options, correct_option]) => ({ category, difficulty, text, options, correct_option })))],
    );
    questionIds = rows.map((r) => r.id);
    console.log(`Inserted ${rows.length} sample questions`);
  } else {
    questionIds = (await pool.query('SELECT id FROM questions ORDER BY id')).rows.map((r) => r.id);
    console.log(`Question bank already has ${questionCount} questions; leaving it unchanged`);
  }

  let { rows: [demo] } = await pool.query("SELECT id FROM competitions WHERE title = 'Inter-College Quiz Championship (Demo)'");
  if (!demo) {
    ({ rows: [demo] } = await pool.query(
      `INSERT INTO competitions (title, description, rules, start_time, end_time, duration_minutes, question_count,
         negative_mark, max_tab_switches, status, show_result_immediately)
       VALUES ('Inter-College Quiz Championship (Demo)',
               'A demo competition covering General Knowledge, Aptitude and Computer Science.',
               E'1. 20 questions, 20 minutes.\\n2. Each wrong answer deducts 0.25 marks.\\n3. Do not switch tabs — after 3 switches your quiz is submitted automatically.\\n4. Answers are saved automatically.',
               now() - interval '1 hour', now() + interval '30 days', 20, 20, 0.25, 3, 'published', TRUE)
       RETURNING id`,
    ));
    await pool.query(
      `INSERT INTO competition_questions (competition_id, question_id, position)
       SELECT $1, id, ord FROM unnest($2::int[]) WITH ORDINALITY AS t(id, ord)`,
      [demo.id, questionIds],
    );
    await pool.query(
      `INSERT INTO competitions (title, description, start_time, end_time, duration_minutes, status)
       VALUES ('National Science Quiz — Round 1', 'Upcoming round. Register now!', now() + interval '7 days',
               now() + interval '7 days 3 hours', 30, 'published')`,
    );
    console.log('Created demo competitions');
  }

  const demoHash = await hashPassword(DEMO_PASSWORD);
  for (const [name, email, college, department, year, roll] of DEMO_STUDENTS) {
    const { rows } = await pool.query(
      `INSERT INTO users (role, name, email, college, department, year_of_study, roll_number, password_hash)
       VALUES ('student', $1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING id`,
      [name, email, college, department, year, roll, demoHash],
    );
    if (rows[0]) {
      await pool.query('INSERT INTO registrations (competition_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [demo.id, rows[0].id]);
    }
  }
  console.log(`Demo students: ${DEMO_STUDENTS.map((s) => s[1]).join(', ')} (password ${DEMO_PASSWORD})`);

  if (bulkCount > 0) {
    const colleges = ['Government Engineering College', 'St. Joseph\'s College', 'National Institute of Technology', 'City Arts & Science College', 'Model Polytechnic'];
    const { rowCount } = await pool.query(
      `INSERT INTO users (role, name, email, college, department, year_of_study, roll_number, password_hash)
       SELECT 'student', 'Load Student ' || g, 'load' || g || '@student.demo', ($2::text[])[1 + g % 5], 'CSE', 1 + g % 4,
              'LOAD' || lpad(g::text, 6, '0'), $3
         FROM generate_series(1, $1) AS g
       ON CONFLICT DO NOTHING`,
      [bulkCount, colleges, demoHash],
    );
    await pool.query(
      `INSERT INTO registrations (competition_id, user_id)
       SELECT $1, id FROM users WHERE email LIKE 'load%@student.demo' ON CONFLICT DO NOTHING`,
      [demo.id],
    );
    console.log(`Created ${rowCount} synthetic students (load1..load${bulkCount}@student.demo, password ${DEMO_PASSWORD})`);
  }
  console.log('Seed complete.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
