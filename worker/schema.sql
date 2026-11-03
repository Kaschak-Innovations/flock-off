-- Flock Off report worker schema (Cloudflare D1 / SQLite).
-- Apply with: npm run db:init   (remote)   or   npm run db:init:local
-- Existing databases created before report kinds existed: run migrations/0002_kind.sql instead.

CREATE TABLE IF NOT EXISTS traps (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'trap',   -- 'trap' (hours) | 'camera' (weeks, unverified sighting)
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  heading REAL,
  reported_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirms INTEGER NOT NULL DEFAULT 1,
  gone INTEGER NOT NULL DEFAULT 0,
  reporter TEXT NOT NULL                -- SHA-256 of the app's random install id, never the raw id
);
CREATE INDEX IF NOT EXISTS idx_traps_active ON traps (expires_at, lat, lon);

CREATE TABLE IF NOT EXISTS votes (
  trap_id TEXT NOT NULL,
  device TEXT NOT NULL,                 -- hashed install id
  vote TEXT NOT NULL,                   -- 'still' | 'gone'
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trap_id, device)
);

CREATE TABLE IF NOT EXISTS report_log (
  device TEXT NOT NULL,                 -- hashed install id, for rate limiting only
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_log ON report_log (device, created_at);
