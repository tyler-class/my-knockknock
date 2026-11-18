-- A person's role in their own words when it's "other" ("Head of Talent", "Board member").
-- (searches.weekly_goal and files.locked are no longer used; they stay so no data is rewritten.)
ALTER TABLE people ADD COLUMN other_role TEXT;
