-- Questions to ask in interviews, prepared like stories.
-- The bank: questions reused across jobs and meetings.
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Questions for one job: copied from the bank (question_id), or written just for it. They come up
-- in every call for the job. (Questions for one meeting live on the meeting itself.)
CREATE TABLE job_questions (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  question_id TEXT REFERENCES questions (id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_job_questions_application ON job_questions (application_id);
