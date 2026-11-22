-- Board order: a job's place within its lane, set by dragging (null = not placed by hand yet;
-- those sit at the top, newest activity first). Moving to another lane clears it.
ALTER TABLE applications ADD COLUMN board_position REAL;

-- Companies as their own records: several jobs can be at one company. A job points at its
-- company; the company's details (and logo) live here. The application keeps its company_*
-- columns as a copy of its company's, kept in step by the app, so older readers still work.
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  linkedin TEXT,
  hq TEXT,
  size TEXT,
  industry TEXT,
  funding TEXT,
  logo_key TEXT,
  logo_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX companies_name ON companies (lower(trim(name)));
ALTER TABLE applications ADD COLUMN company_id TEXT REFERENCES companies (id) ON DELETE SET NULL;

-- One company per company name already used (ignoring case and spaces at the ends), with the
-- details from its most recently updated job; a domain without a website becomes the website.
INSERT INTO companies (id, name, website, linkedin, hq, size, industry, funding, created_at, updated_at)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
  trim(a.company),
  COALESCE(a.company_website, CASE WHEN a.company_domain IS NOT NULL THEN 'https://' || a.company_domain END),
  a.company_linkedin, a.company_hq, a.company_size, a.company_industry, a.company_funding,
  a.created_at, a.updated_at
FROM applications a
WHERE a.rowid = (
  SELECT a2.rowid FROM applications a2
  WHERE lower(trim(a2.company)) = lower(trim(a.company))
  ORDER BY a2.updated_at DESC LIMIT 1
);
UPDATE applications SET company_id = (
  SELECT c.id FROM companies c WHERE lower(trim(c.name)) = lower(trim(applications.company))
);
