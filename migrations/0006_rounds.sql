-- A stretch of job hunting is a "round" everywhere now (it was a "search"): the table, the
-- application's column and the setting that holds the current one are renamed to match. SQLite
-- carries indexes and the foreign key over with the renames.
ALTER TABLE searches RENAME TO rounds;
ALTER TABLE applications RENAME COLUMN search_id TO round_id;
UPDATE settings SET key = 'current_round_id' WHERE key = 'current_search_id';
