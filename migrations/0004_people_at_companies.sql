-- People work at a company and can be on several of its jobs, or none yet (added from the
-- company's page). The table is rebuilt so a person needn't hang off a job: application_id (the
-- first job they were added to) becomes optional, company_id says where they work, and
-- job_people says which jobs they're on. Everyone already added stays on their job, at that
-- job's company. Nothing else points at people yet, so the rebuild touches no other table.
CREATE TABLE people_new (
  id TEXT PRIMARY KEY,
  application_id TEXT REFERENCES applications (id) ON DELETE SET NULL,
  company_id TEXT REFERENCES companies (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  title TEXT,
  role TEXT NOT NULL DEFAULT 'other'
    CHECK (role IN ('recruiter', 'hiring_manager', 'interviewer', 'referrer', 'other')),
  other_role TEXT,
  linkedin TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO people_new (id, application_id, company_id, name, email, title, role, other_role,
  linkedin, notes, created_at, updated_at)
SELECT p.id, p.application_id,
  (SELECT a.company_id FROM applications a WHERE a.id = p.application_id),
  p.name, p.email, p.title, p.role, p.other_role, p.linkedin, p.notes, p.created_at, p.updated_at
FROM people p;
DROP TABLE people;
ALTER TABLE people_new RENAME TO people;
CREATE INDEX idx_people_application ON people (application_id);
CREATE INDEX idx_people_company ON people (company_id);
CREATE INDEX idx_people_email ON people (email);

CREATE TABLE job_people (
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (application_id, person_id)
);
CREATE INDEX job_people_person ON job_people (person_id);
INSERT INTO job_people (application_id, person_id, created_at)
SELECT application_id, id, created_at FROM people WHERE application_id IS NOT NULL;
