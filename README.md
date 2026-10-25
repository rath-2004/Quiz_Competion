# Quiz Competition Platform

An online quiz platform for inter-college competitions, built and load-tested for **5,000 students taking a quiz at the same time**.

- **Students** register with their college details, sign up for competitions and take timed quizzes from a phone or computer.
- **Organisers (admins)** manage the question bank, competitions and student records, watch live progress, and publish results and leaderboards.

| Student | Admin |
| --- | --- |
| Self-registration (name, email, phone, college, roll no., department, year) | Dashboard: totals, live competitions, sign-ups, top colleges |
| Competition list: live / upcoming / past, one-click registration | Question bank: add/edit, categories, difficulty, marks, explanations, images, CSV import/export |
| Timed quiz with server-side timer, question palette, mark-for-review, keyboard shortcuts | Competitions: schedule window + duration, random subset per student, shuffling, negative marking, tab-switch limit |
| Every answer saved instantly; refresh or reconnect and resume where you left off | Assign questions from the bank, at random by category/difficulty, or by CSV |
| Auto-submit when time runs out | Participants: live status, scores, tab switches; reset an attempt; bulk-register students |
| Score, rank and answer review with explanations once results are published | Leaderboard (overall + by college), results CSV export, publish/unpublish results, re-score, force submit |
| Profile and password management | Students: search/filter 5k+ records, view history, edit, block, reset password, CSV import/export |

**Stack:** Node.js (Express 5) · PostgreSQL · React 19 (Vite). No other services needed.

---

## Quick start (local development)

Prerequisites: **Node.js 20+** and **PostgreSQL 14+**.

```bash
# 1. Database
createuser -P quiz          # password: quiz
createdb -O quiz quiz_competition

# 2. Install & configure
npm install
cp .env.example server/.env   # edit if your DB credentials differ

# 3. Create tables + demo data (admin, 30 sample questions, a live demo competition, 3 students)
npm run seed

# 4. Run API (port 4000) + React dev server (port 5173)
npm run dev
```

Open http://localhost:5173

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@quiz.local` | `Admin@123` |
| Student | `aarav@student.demo` (also `priya@`, `rahul@`) | `Student@123` |

## Deploy to the cloud (Render)

`render.yaml` sets up the app and its PostgreSQL database on [Render](https://render.com) in a few clicks:

1. Sign up at render.com with your GitHub account.
2. **New → Blueprint**, choose this repository and the branch with the code, click **Apply**.
3. Enter an **ADMIN_EMAIL** and **ADMIN_PASSWORD** when asked (your organiser login).
4. Wait ~5 minutes for the first build. Your site is at `https://quiz-competition-xxxx.onrender.com`.

It starts on Render's **free** plans with demo data (`SEED_DEMO=true`): good for trying it out, but the free web service sleeps after 15 idle minutes (the next visit takes ~1 minute to wake it) and the free database expires after 30 days. **For the real event**, in the Render dashboard: move the web service to a paid instance with 2–4 CPUs and set `WEB_CONCURRENCY` to the CPU count, move the database to a paid plan, set `SEED_DEMO=false`, and delete the demo competition.

## Production with Docker Compose

```bash
cp .env.example .env
# Edit .env: set JWT_SECRET (openssl rand -hex 32), ADMIN_EMAIL, ADMIN_PASSWORD, POSTGRES_PASSWORD,
# WEB_CONCURRENCY (= CPU cores) and HTTPS (true if served over https://).
docker compose up -d --build
```

The app listens on port 4000 (`PORT` in `.env`). Database migrations and the admin account are applied automatically on start. Data lives in the `pgdata` volume — back it up with `docker compose exec db pg_dump -U quiz quiz_competition > backup.sql`.

For an internet-facing site, put it behind a reverse proxy with a TLS certificate (e.g. Caddy: `quiz.example.edu { reverse_proxy localhost:4000 }`) and set `HTTPS=true`, `TRUST_PROXY=1`.

> **Important:** if students open the site over plain `http://` (e.g. a college LAN IP), `HTTPS` must be `false`, otherwise browsers drop the login cookie and nobody can log in.

## Production without Docker

```bash
npm ci
npm run build                     # builds the React app into client/dist (served by the API server)
cd server
NODE_ENV=production JWT_SECRET=... DATABASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run migrate
NODE_ENV=production WEB_CONCURRENCY=4 JWT_SECRET=... DATABASE_URL=... npm start
```

Run it under systemd/PM2 with `LimitNOFILE=65535` (each connected student holds a socket). More admins: `npm run create-admin -- "Name" email@college.edu 'Password123'`.

---

## Running a competition (organiser guide)

1. **Build the question bank** — *Question Bank → Add question* or *Import CSV* (template downloadable from the dialog).
2. **Create the competition** — *Competitions → New competition*. Set the window (opens/closes), time per student, questions per student, negative marking, tab-switch limit, and whether students see their score right after submitting.
3. **Assign questions** — on the competition's *Questions* tab: pick from the bank, add random questions by category/difficulty (e.g. 10 easy + 10 medium + 5 hard), or import a CSV straight into the competition. If *questions per student* is smaller than the pool, each student gets a different random subset.
4. **Publish** — students now see it and can register. You can also bulk-register (all students or one college) from *Overview → Controls*, or while importing students from CSV.
5. **On the day** — ask students to **log in 15–30 minutes before the start**. Watch *Participants* (refreshes every 10 s) and the admin dashboard. If a student has a genuine technical problem, *Reset* their attempt so they can start again.
6. **After it closes** — any unfinished attempts are auto-submitted within a minute. Check the *Leaderboard*, fix any wrong answer key in the bank and click *Re-score* if needed, then **Publish results** so students see their rank and the answer review. *Results CSV* exports the full ranked list.

**Timing rules:** a student's deadline is `start + duration`, but never later than the competition's closing time. Late joiners get less time. For a fixed-time event, make the window only slightly longer than the duration (e.g. 30 min quiz, 40 min window).

**Ranking:** higher score first; ties broken by less time taken.

### Integrity measures

- Correct answers never reach the browser during a quiz; scoring happens on the server.
- The timer is enforced by the server (the browser clock is only used for display).
- Question order and option order are shuffled per student; optionally a random subset per student.
- Leaving the quiz tab/app is counted (shown to admins); exceeding the limit auto-submits.
- Copy and right-click are disabled on the quiz page; one attempt per student per competition.
- Blocking a student signs them out everywhere.

A browser quiz cannot stop someone using a second device — for high-stakes rounds, combine with invigilation in college labs.

## CSV formats

**Questions** (`question` + at least 2 options + `correct` are required):

```csv
question,option_a,option_b,option_c,option_d,option_e,option_f,correct,category,difficulty,marks,explanation,image_url
"What is the capital of India?",Mumbai,New Delhi,Kolkata,Chennai,,,B,General Knowledge,easy,1,"New Delhi is the capital.",
```

`correct` is a letter A–F (or 1–6); `difficulty` is easy / medium / hard.

**Students** (`name`, `email`, `college`, `roll_number` are required):

```csv
name,email,phone,college,department,year,roll_number,password
Aarav Sharma,aarav@example.com,9876543210,Government Engineering College,CSE,3,GEC2023CS001,
```

Rows without a password get the *default password* entered in the import dialog. Existing emails or (college + roll number) pairs are skipped, never overwritten. Invalid rows are reported with their row numbers; valid rows are still imported. Save Excel/Google Sheets files as **CSV UTF-8**.

---

## Capacity & load test

`server/scripts/loadtest.js` simulates students logging in, starting together, answering every question and submitting. Results on a single **4-vCPU** machine running the app (3 workers), PostgreSQL *and* the load generator together:

| Scenario: 5,000 students | Requests | Throughput | p50 | p95 | p99 | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| Start-time rush (all click *Start*) | 5,000 | ~500/s | 0.9 s | 1.3 s | 1.6 s | 0 |
| Answering, realistic pace (pause up to 20 s per question) | 100,000 | 345/s | **4 ms** | 16 ms | 95 ms | 0 |
| Answering, worst case (no pause at all) | 100,000 | ~1,100/s | 3.8 s | 8.3 s | 8.7 s | 0 |
| Submit | 5,000 | ~850/s | 0.5 s | 0.9 s | 1.9 s | 0 |
| Login burst (all 5,000 at the same second) | 5,000 | ~60/s | 7 s | 11 s | 11 s | 0 |

Login is deliberately slow (scrypt password hashing); spread over the 15–30 minutes before a quiz it is negligible, and sessions last 12 hours. Real students take 30–60 s per question, i.e. ~100–170 saves/s for 5,000 students.

**Recommended for 5,000 concurrent students:** 4 vCPU / 8 GB RAM (app + PostgreSQL on one machine) with `WEB_CONCURRENCY=4`, or a separate managed PostgreSQL. Run your own test before the event:

```bash
cd server
npm run seed -- --students 5000        # load1..load5000@student.demo, registered for the demo competition
node scripts/loadtest.js --url http://your-server:4000 --students 5000 --concurrency 500 --think 20000
```

(Don't run the seed's `--students` option against your production database.)

---

## Configuration

All settings are environment variables (see `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | local `quiz_competition` | PostgreSQL connection string |
| `JWT_SECRET` | dev-only value | **Required in production.** Signs login sessions |
| `JWT_EXPIRES_IN` | `12h` | Session length |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | `admin@quiz.local` / `Admin@123` (dev) | Admin created on start if missing |
| `WEB_CONCURRENCY` | `1` | Server processes; set to CPU cores |
| `DB_POOL_SIZE` | `10` | DB connections per process |
| `HTTPS` | `true` in production | Secure cookies + HSTS. Set `false` for plain-http deployments |
| `TRUST_PROXY` | off | Number of reverse proxies in front (for correct client IPs) |
| `SUBMIT_GRACE_SECONDS` | `15` | Network grace after a deadline for in-flight answer saves |
| `AUTO_SUBMIT_INTERVAL_MS` | `30000` | How often expired attempts are finalised |
| `LOGIN_RATE_LIMIT` / `REGISTER_RATE_LIMIT` | `20` / `500` | Per 15 min, per email+IP / per IP (colleges often share one IP) |

## Development

```bash
npm test          # API integration tests (needs a PostgreSQL database `quiz_test`, see server/test/setup.js)
npm run build     # production build of the client
```

```
server/
  migrations/        SQL schema (applied in order by `npm run migrate`)
  scripts/           migrate, seed, create-admin, loadtest
  src/
    app.js           Express app (also serves client/dist in production)
    index.js         HTTP server, cluster workers, auto-submit sweeper
    services/quiz.js Quiz engine: start, save answer, submit, scoring, results
    routes/          auth, student, admin/{questions,competitions,students}
  test/              node:test + supertest integration tests
client/src/
  pages/student/     Dashboard, Competition, Quiz, Result, Profile
  pages/admin/       Dashboard, Questions, Competitions, CompetitionForm, CompetitionDetail, Students, StudentDetail
```

### API overview

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/register`, `/login`, `/logout`, `/change-password` · `GET/PUT /api/auth/me` |
| Student | `GET /api/student/competitions[/:id]` · `POST …/:id/register`, `/start`, `/tab-switch`, `/submit` · `GET …/:id/attempt`, `/result` · `PUT …/:id/answer` |
| Admin | `GET /api/admin/stats` · CRUD + `import`/`export` under `/api/admin/questions` and `/api/admin/students` · `/api/admin/competitions` CRUD, `/:id/questions`, `/questions/random`, `/participants`, `/leaderboard`, `/export`, `/publish-results`, `/rescore`, `/force-submit`, `/registrations`, `/attempts/:userId` |
