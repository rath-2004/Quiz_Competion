-- Core schema for the quiz competition platform.

CREATE TABLE admins (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admins_email_key ON admins (lower(email));

CREATE TABLE departments (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX departments_name_key ON departments (lower(name));
CREATE UNIQUE INDEX departments_code_key ON departments (upper(code));

CREATE TABLE students (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  register_no   TEXT NOT NULL,
  phone         TEXT NOT NULL,
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  year_of_study SMALLINT NOT NULL CHECK (year_of_study BETWEEN 1 AND 6),
  password_hash TEXT NOT NULL,
  is_blocked    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX students_email_key ON students (lower(email));
CREATE UNIQUE INDEX students_register_no_key ON students (upper(register_no));
CREATE INDEX students_department_idx ON students (department_id);
CREATE INDEX students_created_at_idx ON students (created_at DESC);

CREATE TABLE competitions (
  id                    SERIAL PRIMARY KEY,
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  instructions          TEXT NOT NULL DEFAULT '',
  starts_at             TIMESTAMPTZ NOT NULL,
  ends_at               TIMESTAMPTZ NOT NULL,
  duration_minutes      INT NOT NULL CHECK (duration_minutes > 0),
  -- NULL means every question in the competition is served.
  questions_per_attempt INT CHECK (questions_per_attempt > 0),
  shuffle_questions     BOOLEAN NOT NULL DEFAULT true,
  shuffle_options       BOOLEAN NOT NULL DEFAULT true,
  results_visibility    TEXT NOT NULL DEFAULT 'after_end'
                          CHECK (results_visibility IN ('immediate', 'after_end', 'hidden')),
  is_published          BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX competitions_starts_at_idx ON competitions (starts_at DESC);

CREATE TABLE questions (
  id             SERIAL PRIMARY KEY,
  competition_id INT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  text           TEXT NOT NULL,
  options        JSONB NOT NULL,           -- array of option strings
  correct_option SMALLINT NOT NULL,        -- index into options
  marks          NUMERIC(6, 2) NOT NULL DEFAULT 1,
  negative_marks NUMERIC(6, 2) NOT NULL DEFAULT 0,
  explanation    TEXT NOT NULL DEFAULT '',
  position       INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(options) = 'array'),
  CHECK (correct_option >= 0 AND correct_option < jsonb_array_length(options))
);
CREATE INDEX questions_competition_idx ON questions (competition_id, position, id);

CREATE TABLE registrations (
  competition_id INT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  student_id     INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  registered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, student_id)
);
CREATE INDEX registrations_student_idx ON registrations (student_id);

CREATE TABLE attempts (
  id             SERIAL PRIMARY KEY,
  competition_id INT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  student_id     INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_ids   INT[] NOT NULL,           -- questions served to this student, in order
  seed           INT NOT NULL,             -- drives the per-student option shuffle
  max_score      NUMERIC(8, 2) NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at    TIMESTAMPTZ NOT NULL,
  submitted_at   TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress', 'submitted', 'auto_submitted')),
  score          NUMERIC(8, 2),
  correct_count  INT,
  wrong_count    INT,
  tab_switches   INT NOT NULL DEFAULT 0,
  ip_address     TEXT,
  UNIQUE (competition_id, student_id)
);
CREATE INDEX attempts_student_idx ON attempts (student_id);
CREATE INDEX attempts_open_deadline_idx ON attempts (deadline_at) WHERE status = 'in_progress';
CREATE INDEX attempts_competition_status_idx ON attempts (competition_id, status);

CREATE TABLE attempt_answers (
  attempt_id      INT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id     INT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option SMALLINT,                -- NULL when the student cleared the answer
  answered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);
