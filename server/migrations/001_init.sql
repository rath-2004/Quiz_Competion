-- Users: admins and students share one table, distinguished by role.
CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'student')),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  college         TEXT,
  department      TEXT,
  year_of_study   SMALLINT,
  roll_number     TEXT,
  password_hash   TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  token_version   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE UNIQUE INDEX users_college_roll_uq ON users (lower(college), lower(roll_number))
  WHERE role = 'student' AND roll_number IS NOT NULL AND college IS NOT NULL;
CREATE INDEX users_role_created_idx ON users (role, created_at DESC);

-- Question bank (single-correct multiple choice).
CREATE TABLE questions (
  id              SERIAL PRIMARY KEY,
  text            TEXT NOT NULL,
  image_url       TEXT,
  options         JSONB NOT NULL,          -- array of 2..6 strings
  correct_option  SMALLINT NOT NULL,       -- 0-based index into options
  explanation     TEXT,
  category        TEXT NOT NULL DEFAULT 'General',
  difficulty      TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  marks           NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (marks > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(options) = 'array'),
  CHECK (correct_option >= 0 AND correct_option < jsonb_array_length(options))
);
CREATE INDEX questions_category_idx ON questions (category);

CREATE TABLE competitions (
  id                      SERIAL PRIMARY KEY,
  title                   TEXT NOT NULL,
  description             TEXT,
  rules                   TEXT,
  start_time              TIMESTAMPTZ NOT NULL,
  end_time                TIMESTAMPTZ NOT NULL,
  duration_minutes        INTEGER NOT NULL CHECK (duration_minutes > 0),
  question_count          INTEGER CHECK (question_count IS NULL OR question_count > 0), -- NULL = all assigned questions
  shuffle_questions       BOOLEAN NOT NULL DEFAULT TRUE,
  shuffle_options         BOOLEAN NOT NULL DEFAULT TRUE,
  negative_mark           NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (negative_mark >= 0),
  max_tab_switches        INTEGER CHECK (max_tab_switches IS NULL OR max_tab_switches >= 0), -- NULL = unlimited
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  registration_open       BOOLEAN NOT NULL DEFAULT TRUE,
  show_result_immediately BOOLEAN NOT NULL DEFAULT FALSE,
  results_published       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX competitions_window_idx ON competitions (status, start_time, end_time);

CREATE TABLE competition_questions (
  competition_id  INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  question_id     INTEGER NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  position        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (competition_id, question_id)
);
CREATE INDEX competition_questions_question_idx ON competition_questions (question_id);

CREATE TABLE registrations (
  id              SERIAL PRIMARY KEY,
  competition_id  INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, user_id)
);
CREATE INDEX registrations_user_idx ON registrations (user_id);

-- One attempt per student per competition.
CREATE TABLE attempts (
  id                SERIAL PRIMARY KEY,
  competition_id    INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline          TIMESTAMPTZ NOT NULL,
  submitted_at      TIMESTAMPTZ,
  auto_submitted    BOOLEAN NOT NULL DEFAULT FALSE,
  -- [{ "q": questionId, "o": [original option indexes in display order] }, ...]
  question_order    JSONB NOT NULL,
  total_questions   INTEGER NOT NULL,
  max_score         NUMERIC(8,2) NOT NULL,
  score             NUMERIC(8,2),
  correct_count     INTEGER,
  wrong_count       INTEGER,
  unanswered_count  INTEGER,
  tab_switches      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (competition_id, user_id)
);
CREATE INDEX attempts_leaderboard_idx ON attempts (competition_id, status, score DESC);
CREATE INDEX attempts_open_deadline_idx ON attempts (deadline) WHERE status = 'in_progress';
CREATE INDEX attempts_user_idx ON attempts (user_id);

CREATE TABLE attempt_answers (
  attempt_id       INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id      INTEGER NOT NULL,
  selected_option  SMALLINT,               -- original (unshuffled) option index; NULL = cleared
  marked_review    BOOLEAN NOT NULL DEFAULT FALSE,
  answered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);
