# College Quiz Competition

An online quiz competition platform for a college: students register themselves, join a competition, and take a
timed multiple-choice quiz when it goes live. Organisers manage everything from an admin dashboard — questions,
competitions, students, live progress and results. Built and load-tested for **5,000 students taking a quiz at the
same time**.

- **Student site** — registration (name, register number, email, phone, department, year), login, competition list
  with live countdowns, the quiz screen, results, answer review and leaderboard.
- **Admin dashboard** (`/admin`) — overview, competitions, questions (incl. CSV import), participants with live
  progress, results with department-wise summary and Excel/CSV export, students, departments.

Stack: **Node.js 22 + Express 5** API, **PostgreSQL 16**, **React 19 + Vite** frontend. One process serves both the API
and the built frontend.

---

## Contents

1. [Features](#features)
2. [Quick start (local development)](#quick-start-local-development)
3. [Running a competition — organiser checklist](#running-a-competition--organiser-checklist)
4. [Question CSV format](#question-csv-format)
5. [Deploying to production](#deploying-to-production)
6. [Capacity and load testing](#capacity-and-load-testing)
7. [Configuration](#configuration)
8. [How it works](#how-it-works)
9. [Project structure](#project-structure)
10. [Tests](#tests)
11. [Troubleshooting](#troubleshooting)

---

## Features

### For students

| | |
|---|---|
| Self-registration | Name, register number, email, phone, department (from the admin's list), year of study and a password. Duplicate emails and register numbers are rejected. |
| Login | With register number **or** email + password. Sessions last 12 hours. |
| Competitions | See upcoming / live / past competitions, register for one, live countdown to start. The **Start** button appears automatically when the quiz opens — no refresh needed. |
| Quiz screen | Server-synced timer, one question at a time, question palette (answered / not answered / marked for review), clear answer, keyboard shortcuts (A–F, ← →), mobile-friendly. |
| Never lose answers | Every click is saved to the server. If the connection drops, answers are kept in the browser and retried automatically; reloading or switching device resumes with all answers and the remaining time. |
| Auto-submit | When time runs out the quiz is submitted automatically — even if the student closed the browser. |
| Results | Score, rank, correct / wrong / unanswered, time taken; full answer review with explanations after the competition closes; public top-100 leaderboard. |

### For organisers (admin dashboard)

| | |
|---|---|
| Overview | Registered students, students taking a quiz right now, current and upcoming competitions with live counts, students per department. |
| Competitions | Title, description, instructions, open/close time, per-student time limit, random subset of questions per student, shuffle questions / options, when results are shown (immediately, after close, or hidden until you publish), draft/published. |
| Questions | Add/edit/delete MCQs with 2–6 options, one correct answer, marks, optional negative marks and explanation. **Bulk import from CSV** (Excel / Google Sheets) with row-by-row error reporting. |
| Participants | Every registered student with live status (not started / in progress / submitted), questions answered, tab switches, score. Auto-refreshes while live. Reset a student's attempt after a genuine technical problem. |
| Results | Ranking (score, then time taken), department-wise performance, summary stats, **export to Excel (CSV)**, recalculate scores after fixing an answer key. |
| Students | Search by name / register no / email / phone, filter by department, year and status, view a student's competitions, edit details, block / unblock, reset password (generates a temporary one), delete, export to CSV. |
| Departments | Manage the department list students choose from. |

### Fair play

- Correct answers are **never sent to the browser** while a quiz can still be taken; scoring happens on the server.
- Per-student shuffled question order and option order; optional random subset of questions per student.
- The deadline is enforced on the server (with a 15 s grace for network latency); the timer uses the server clock.
- Leaving the quiz tab is counted and shown to admins (participants list, results and export).
- Copy/right-click deterrents on question text; one attempt per student per competition.

---

## Quick start (local development)

Requirements: **Node.js 22+** and **PostgreSQL 14+** (16 recommended).

```bash
# 1. Install dependencies
npm install

# 2. Create a database
createdb quiz            # or: psql -U postgres -c 'CREATE DATABASE quiz;'

# 3. Configure
cp .env.example .env     # set DATABASE_URL if yours differs from postgres://postgres:postgres@localhost:5432/quiz

# 4. Create tables and your admin account
npm run migrate
npm run create-admin -- --email admin@example.com --password "choose-a-strong-password" --name "Quiz Admin"

# 5. (optional) sample departments + a demo competition that starts in 2 minutes
npm run seed:demo

# 6. Start the API (port 4000) and the React dev server (port 5173)
npm run dev
```

Open <http://localhost:5173> for the student site and <http://localhost:5173/admin> for the dashboard.

---

## Running a competition — organiser checklist

**Before registration opens**

1. **Departments** → add every department (e.g. *Computer Science and Engineering*, code *CSE*). Students cannot register
   until at least one exists.
2. **Competitions → New competition**
   - *Quiz opens at / closes at*: the window in which students can start and answer.
   - *Time limit per student*: each student's timer starts when they press **Start**. A student who starts late is still
     cut off when the quiz closes. For a synchronised start, make the window *start time + time limit + a few minutes*.
   - *Questions per student*: leave empty to give everyone every question, or set a number to give each student a
     random subset of the question bank.
   - *Results*: “after the quiz closes” is recommended so early finishers cannot share answers.
3. **Questions tab** → add questions, or download the CSV template, fill it in Excel / Google Sheets, save as CSV and
   import it.
4. Click **Publish**. Students can now see the competition and register for it.

**On the day**

- Tell students to **log in 10–15 minutes before the start** and keep the competition page open. The **Start** button
  appears by itself at the start time. (Logging in is deliberately CPU-intensive for password security; spreading
  logins out keeps the start instant for everyone. Sessions last 12 hours.)
- Watch the **Participants** tab (auto-refreshes every 10 s) and the **Overview** page.
- If a student has a genuine technical problem they can simply log in again and press **Resume** — answers and time
  are kept. Use **Reset attempt** only if they must restart from scratch.
- Forgotten password: **Students → (student) → Reset password** and give them the temporary password.

**Afterwards**

- **Results tab** → rankings, department-wise summary, **Export to Excel (CSV)**.
- Found a wrong answer key? Edit the question, then **Recalculate scores**.
- If results visibility was *hidden*, switch it in **Settings** when you are ready to announce.

---

## Question CSV format

Download the template from **Questions → Download CSV template**. Columns (header names are not case-sensitive):

| Column | Required | Notes |
|---|---|---|
| `Question` | yes | Question text. |
| `Option A` … `Option F` | A and B | 2 to 6 options; leave unused ones empty. |
| `Correct` | yes | A letter (`B`), the exact option text (`New Delhi`) or the option number (`2`). |
| `Marks` | no | Default 1. |
| `Negative Marks` | no | Marks deducted for a wrong answer. Default 0. |
| `Explanation` | no | Shown in the answer review after the competition closes. |

```csv
Question,Option A,Option B,Option C,Option D,Correct,Marks,Negative Marks,Explanation
"Capital of India?",Mumbai,New Delhi,Chennai,Kolkata,B,2,0.5,
"2 + 2 = ?",3,4,,,B,1,0,
```

If any row is invalid nothing is imported and every problem row is listed (e.g. *Row 7: Choose which option is
correct*). Up to 2,000 questions per file. From Excel use **File → Save As → CSV UTF-8**.

---

## Deploying to production

### Option A — Docker Compose (simplest)

```bash
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, WEB_CONCURRENCY (= CPU cores)
docker compose up -d --build
```

This starts PostgreSQL and the app on port 4000. The database lives in the `pgdata` volume. Migrations run and the
first admin is created automatically on start.

### Option B — Node.js directly (VM / bare metal)

```bash
npm ci
npm run build                      # builds the React app into client/dist
NODE_ENV=production npm start      # serves API + frontend on $PORT
```

Run it under a process manager (systemd, PM2, …) with the variables from `.env.example`. With
`WEB_CONCURRENCY=<cores>` the server forks one worker per core by itself.

### HTTPS and reverse proxy (recommended)

Put the app behind nginx or Caddy with a TLS certificate and set `TRUST_PROXY=1`. Example nginx site:

```nginx
server {
    listen 443 ssl http2;
    server_name quiz.yourcollege.edu;
    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

Plain-HTTP campus LAN without a certificate? Set `COOKIE_SECURE=false`, otherwise browsers drop the login cookie.

### Recommended server size for 5,000 students

- **App + database on one server:** 4–8 vCPU, 8 GB RAM, SSD. `WEB_CONCURRENCY` = number of cores,
  `DB_POOL_MAX=20`, PostgreSQL `max_connections` ≥ `WEB_CONCURRENCY × DB_POOL_MAX + 20`.
- Bigger events: run more app servers behind a load balancer (sessions are stateless JWT cookies, the
  auto-submit job is safe to run on every instance) and give PostgreSQL its own machine.
- **Back up the database** before and after each competition (`pg_dump`).

---

## Capacity and load testing

`npm run loadtest` simulates a full competition against a running server: it seeds N students registered for a live
competition, then every student logs in, starts the quiz, answers every question with a separate request (exactly like
clicking), submits and opens their result. Use a throwaway database:

```bash
createdb quiz_load
DATABASE_URL=postgres://postgres:postgres@localhost:5432/quiz_load WEB_CONCURRENCY=3 PORT=4200 npm start   # terminal 1
DATABASE_URL=postgres://postgres:postgres@localhost:5432/quiz_load npm run loadtest -w server -- \
  --url http://localhost:4200 --students 5000 --questions 25 --concurrency 1000                        # terminal 2
```

Result on a **single 4-core / 16 GB machine** running the app (3 workers), PostgreSQL **and** the load generator, with
**1,000 requests in flight at all times** — far harsher than a real exam hall:

| Phase | Requests | Failed | Throughput | p50 | p95 |
|---|---:|---:|---:|---:|---:|
| Login | 5,000 | 0 | 61 /s | (CPU-bound, see below) | |
| Start quiz | 5,000 | 0 | 511 /s | 1.8 s | 3.4 s |
| Save answer | 125,000 | 0 | 1,022 /s | 0.9 s | 1.4 s |
| Submit | 5,000 | 0 | 890 /s | 1.0 s | 1.5 s |
| View result | 5,000 | 0 | 1,671 /s | 0.6 s | 0.8 s |

All 5,000 attempts were stored and scored correctly. For comparison, 5,000 students answering 25 questions over a
20-minute quiz is about **100 answer saves per second** — roughly a tenth of what this small machine sustained.

Login hashes the password with scrypt on purpose (≈ 60 logins/s per 4 cores). 5,000 simultaneous logins therefore take
about a minute and a half on such a machine; ask students to log in early (see the checklist) or use more cores.

---

## Configuration

All settings are environment variables (or a `.env` file in the project root / `server/`). See `.env.example`.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/quiz` | PostgreSQL connection string. |
| `JWT_SECRET` | dev-only value | **Required in production.** Long random string used to sign login cookies. |
| `PORT` | `4000` | HTTP port. |
| `WEB_CONCURRENCY` | `1` | Worker processes; set to the number of CPU cores. |
| `DB_POOL_MAX` | `20` | Database connections per worker. |
| `COOKIE_SECURE` | `true` in production | HTTPS-only cookies and HSTS. Set `false` only for plain-HTTP LAN setups. |
| `TRUST_PROXY` | `false` | Set to `1` behind one reverse proxy so rate limits see real client IPs. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | — | First admin, created on start if no admin exists. |
| `SUBMIT_GRACE_SECONDS` | `15` | Answers accepted this long after a deadline (network latency). |
| `SWEEP_INTERVAL_SECONDS` | `20` | How often expired attempts are auto-submitted. |
| `REGISTER_LIMIT_PER_IP` | `1000` | Registrations per IP per 10 min (campuses often share one IP). |
| `LOGIN_LIMIT_PER_ACCOUNT` | `20` | Failed logins per account + IP per 15 min. |

Extra admin accounts (or a password reset for an admin): `npm run create-admin -- --email … --password …`.

---

## How it works

- **Timing.** A competition has an open/close window and a per-student time limit. When a student starts, the server
  stores `deadline = min(now + time limit, close time)`. The browser shows a countdown corrected for clock skew using
  the server time sent with each response.
- **Saving answers.** Each click is queued in the browser (and `localStorage`), sent within ~300 ms, and retried with
  back-off when offline. On the server, a single SQL statement validates the attempt (still open, before deadline +
  grace, question belongs to this student's quiz) and upserts the answer while share-locking the attempt row, so no
  answer can slip in after submission.
- **Submitting & auto-submit.** Scoring is one SQL statement (marks for correct answers minus negative marks for wrong
  ones). A background job in every worker auto-submits expired attempts using `FOR UPDATE SKIP LOCKED`, so several
  servers never collide. Any attempt found expired when a student returns is finalised on the spot.
- **Hot-path caching.** Competition settings, questions (without answers) and rankings are cached in memory for a few
  seconds with request de-duplication, so 5,000 students pressing **Start** at once cause one question query, not
  5,000. Admin edits clear the cache in the process that made them and expire elsewhere within 15 s.
- **Security.** scrypt password hashing; HTTP-only, SameSite cookies; separate admin and student sessions; rate-limited
  logins; strict Content-Security-Policy and other headers via Helmet; parameterised SQL everywhere; CSV exports are
  protected against spreadsheet formula injection.

### Main API routes

| Area | Routes |
|---|---|
| Auth | `POST /api/auth/student/register`, `POST /api/auth/student/login`, `GET /api/auth/student/me`, `POST /api/auth/admin/login`, … |
| Public | `GET /api/departments`, `GET /api/competitions`, `GET /api/competitions/:id`, `GET /api/competitions/:id/leaderboard` |
| Student | `POST /api/student/competitions/:id/register`, `…/start`, `PUT …/answers`, `POST …/submit`, `POST …/tab-switch`, `GET …/result` |
| Admin | `/api/admin/stats`, `/api/admin/competitions[/:id[/questions\|/participants\|/results\|/results.csv\|/rescore\|/publish]]`, `/api/admin/questions/:id`, `/api/admin/attempts/:id`, `/api/admin/students[...]`, `/api/admin/departments[...]` |

---

## Project structure

```
├── client/                     React frontend (Vite)
│   └── src/
│       ├── pages/              Student pages (Home, Register, Login, Dashboard, CompetitionPage, Quiz, Result, Leaderboard)
│       ├── pages/admin/        Admin dashboard pages
│       ├── components/         Layouts, competition card, shared UI (modal, toasts, pagination…)
│       ├── lib/                API client, auth context, formatting & clock helpers
│       └── styles.css
├── server/                     Express API
│   ├── migrations/             SQL schema migrations (applied automatically)
│   ├── scripts/                migrate, create-admin, seed-demo, loadtest
│   ├── src/
│   │   ├── routes/             auth, public, student, admin/*
│   │   ├── services/           attempts (start/save/submit/auto-submit/scoring), competitions (caching, ranking), admins
│   │   ├── lib/                auth cookies, password hashing, validation, CSV, errors, shuffling
│   │   ├── app.js              Express app
│   │   └── index.js            Entry point (migrations, cluster workers, auto-submit job)
│   └── test/                   Integration tests (node:test + supertest against PostgreSQL)
├── Dockerfile, docker-compose.yml, .env.example
```

---

## Tests

The integration tests run against a real PostgreSQL database (`quiz_test` by default; override with
`TEST_DATABASE_URL`). They cover registration and login, the full quiz flow and scoring (incl. negative marking),
deadline/grace enforcement, auto-submit, results visibility, CSV import, rescoring and admin tools.

```bash
createdb quiz_test
npm test
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Login seems to work but you are immediately logged out | You are on plain `http://` with `COOKIE_SECURE=true`. Use HTTPS, or set `COOKIE_SECURE=false` for a LAN-only setup. |
| “Registration is not open yet” on the register page | Add departments in the admin dashboard. |
| Students all see “Too many registrations from this network” | Raise `REGISTER_LIMIT_PER_IP`, and set `TRUST_PROXY=1` if you are behind a reverse proxy. |
| `JWT_SECRET must be set when NODE_ENV=production` | Set `JWT_SECRET` to a long random string. |
| “Add at least one question before publishing” | Competitions need questions before students can see them. |
| Can't delete a question | Students have already started; edit it instead and use **Recalculate scores**. |
| Forgot the admin password | `npm run create-admin -- --email <same email> --password <new password>` resets it. |
