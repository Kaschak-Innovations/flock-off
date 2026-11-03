-- Adds report kinds to a database created from the original schema.
-- wrangler d1 execute flock-off-traps --remote --file=./migrations/0002_kind.sql
ALTER TABLE traps ADD COLUMN kind TEXT NOT NULL DEFAULT 'trap';
