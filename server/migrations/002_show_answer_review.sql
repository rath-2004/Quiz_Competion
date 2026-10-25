-- Whether students may see which of their answers were right or wrong (counts + answer review).
-- Off by default: students only see their score and rank.
ALTER TABLE competitions ADD COLUMN show_answer_review BOOLEAN NOT NULL DEFAULT FALSE;
