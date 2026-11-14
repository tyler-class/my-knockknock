-- Knock Knock schema v1.
-- ids are TEXT (uuids); timestamps are ISO-8601 UTC strings; calendar dates are YYYY-MM-DD;
-- string lists and type-specific event fields are JSON stored as TEXT.

-- A stretch of looking for work. Applications belong to one.
CREATE TABLE searches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'accepted', 'ended')),
  started_on TEXT,
  ended_on TEXT,
  weekly_goal INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per job you might apply to (or did). status is a cache of the timeline: the newest
-- created/status event by occurred_at decides it, and the API recomputes it on every change.
CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL REFERENCES searches (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'saved' CHECK (
    status IN ('saved', 'applied', 'screening', 'interviewing', 'offer', 'accepted', 'rejected', 'declined', 'ghosted')
  ),
  closed_from TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  company_domain TEXT,
  company_website TEXT,
  company_linkedin TEXT,
  company_hq TEXT,
  company_size TEXT,
  company_industry TEXT,
  company_funding TEXT,
  url TEXT,
  source TEXT,
  location TEXT,
  work_mode TEXT CHECK (work_mode IN ('remote', 'hybrid', 'onsite')),
  seniority TEXT,
  reports_to TEXT,
  team TEXT,
  employment_type TEXT,
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT,
  salary_period TEXT CHECK (salary_period IN ('year', 'month', 'hour')),
  salary_text TEXT,
  posted_on TEXT,
  description TEXT,
  must_haves TEXT NOT NULL DEFAULT '[]',
  nice_to_haves TEXT NOT NULL DEFAULT '[]',
  inferred TEXT NOT NULL DEFAULT '[]',
  applied_on TEXT,
  resume_file_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);
CREATE INDEX idx_applications_search ON applications (search_id, status);
CREATE INDEX idx_applications_url ON applications (url);

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  title TEXT,
  role TEXT NOT NULL DEFAULT 'other'
    CHECK (role IN ('recruiter', 'hiring_manager', 'interviewer', 'referrer', 'other')),
  linkedin TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_people_application ON people (application_id);
CREATE INDEX idx_people_email ON people (email);

-- The timeline. data holds the type's own fields (meeting: kind, state, join_url, attendees…;
-- email: direction, category, key_points…; status: from, to, reason, caused_by).
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('created', 'status', 'meeting', 'email', 'note')),
  occurred_at TEXT NOT NULL,
  title TEXT,
  body TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'agent')),
  source_name TEXT,
  external_ref TEXT,
  parent_id TEXT REFERENCES events (id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_events_application ON events (application_id, occurred_at);
CREATE INDEX idx_events_type ON events (type, occurred_at);
-- The one duplicate check the app makes: the same Gmail message or calendar event can't be
-- logged twice on one application. Anything fuzzier is the assistant's call.
CREATE UNIQUE INDEX idx_events_external ON events (application_id, external_ref)
  WHERE external_ref IS NOT NULL;

-- Custom story frameworks. The built-in ones (STAR, Introduction, …) live in code.
CREATE TABLE frameworks (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  blurb TEXT NOT NULL DEFAULT '',
  sections TEXT NOT NULL,
  questions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The story bank: templates that get copied to jobs.
CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  framework_key TEXT NOT NULL,
  title TEXT NOT NULL,
  hook TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  sections TEXT NOT NULL DEFAULT '{}',
  questions TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A story copied to one application. Edits stay here unless pushed back to the bank.
CREATE TABLE job_stories (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  story_id TEXT REFERENCES stories (id) ON DELETE SET NULL,
  source_version INTEGER,
  framework_key TEXT NOT NULL,
  section_defs TEXT NOT NULL DEFAULT '[]',
  title TEXT NOT NULL,
  hook TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  sections TEXT NOT NULL DEFAULT '{}',
  questions TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  angle TEXT,
  base_hash TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_job_stories_application ON job_stories (application_id, position);
CREATE INDEX idx_job_stories_story ON job_stories (story_id);

-- Stories told in interviews: who heard which one.
CREATE TABLE story_tells (
  id TEXT PRIMARY KEY,
  job_story_id TEXT NOT NULL REFERENCES job_stories (id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events (id) ON DELETE SET NULL,
  told_at TEXT NOT NULL,
  heard_by TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_story_tells_story ON story_tells (job_story_id);

-- Files live in R2 under files/<id>; text is kept for transcripts and other text files so
-- assistants can read them.
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  application_id TEXT REFERENCES applications (id) ON DELETE SET NULL,
  event_id TEXT REFERENCES events (id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'other'
    CHECK (kind IN ('resume', 'cover_letter', 'transcript', 'offer', 'posting', 'other')),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  label TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_files_application ON files (application_id);

-- One-time upload links, handed out by assistants over MCP so a file can be added from a
-- phone or laptop without signing in. Only a hash of the token is stored; 30-minute expiry.
CREATE TABLE upload_links (
  token_hash TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  event_id TEXT,
  uploads INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_upload_links_expires ON upload_links (expires_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
CREATE INDEX idx_login_attempts_ip ON login_attempts (ip, attempted_at);
