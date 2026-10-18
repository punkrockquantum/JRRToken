-- Token Quest scores: one row per game, whichever laptop or browser it was played on.
-- Applied with `npx wrangler d1 migrations apply tokenquest-players --remote` (wrangler keeps a
-- d1_migrations table so each file runs once). Names and email addresses live only here.
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY,
  played_at TEXT NOT NULL,            -- ISO 8601 UTC, when the game finished
  name TEXT NOT NULL,
  email TEXT NOT NULL,                -- lowercased by the Worker
  score INTEGER NOT NULL,
  use_case TEXT,
  scenario TEXT,
  cost_per_mtok REAL,
  profit_per_hour REAL,
  fte_equivalent REAL,
  annual_savings REAL,
  human_hours_per_year REAL,
  consent_at TEXT NOT NULL,           -- ISO 8601 UTC, when the player ticked the consent box
  source TEXT,                        -- "web" (browser on the team URL) or "kiosk" (a laptop's write-through)
  replay_key TEXT UNIQUE              -- email|played_at|score: a re-posted game is stored once
);
CREATE INDEX IF NOT EXISTS attempts_email ON attempts (email);
CREATE INDEX IF NOT EXISTS attempts_score ON attempts (score DESC);
