-- Token Quest workshop mode: table teams, one architect (host) per table, up to ten teams a session.
-- Applied with `npx wrangler d1 migrations apply tokenquest-players --remote` from deploy/intake-worker
-- (wrangler runs each file once). No email addresses anywhere in these tables: a team is a table
-- number, a team name and the architect's first name. Codes (session code, host codes, facilitator
-- PIN) are random per session and are only ever compared, never logged.
CREATE TABLE IF NOT EXISTS sessions (
  code TEXT PRIMARY KEY,                       -- 4 characters, no 0/O/1/I
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,                    -- ISO 8601 UTC
  phase TEXT NOT NULL DEFAULT 'brief',         -- brief | build | readout | done
  phase_started_at TEXT,                       -- NULL until the facilitator starts the brief (the lobby)
  started_at TEXT,                             -- when the brief started
  ended_at TEXT,
  brief_minutes INTEGER NOT NULL DEFAULT 5,
  build_minutes INTEGER NOT NULL DEFAULT 36,
  readout_minutes INTEGER NOT NULL DEFAULT 9,
  facilitator_pin TEXT NOT NULL                -- 6 digits
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  session_code TEXT NOT NULL REFERENCES sessions(code) ON DELETE CASCADE,
  number INTEGER NOT NULL,                     -- 1..10, created with the session
  name TEXT,                                   -- NULL until the table joins
  host_name TEXT,                              -- the architect at the table (first name is enough)
  host_code TEXT NOT NULL,                     -- 4 digits, handed to the architect by the facilitator
  created_at TEXT NOT NULL,
  joined_at TEXT,
  submitted_at TEXT,
  UNIQUE (session_code, number)
);
CREATE INDEX IF NOT EXISTS teams_session ON teams (session_code);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  station TEXT NOT NULL,                       -- connectivity | oems | dcpower | cfd
  choices TEXT NOT NULL,                       -- JSON: decision id -> tile id
  pitch TEXT,                                  -- the team's one-sentence rationale
  pitched_at TEXT,
  approved_at TEXT,
  approval TEXT,                               -- approved | sent_back | NULL (not pitched, or pitched and waiting)
  host_note TEXT,                              -- the architect's one-tap reason (cost / power / latency / risk / wrong tool)
  attempts INTEGER NOT NULL DEFAULT 0,         -- pitches so far
  send_backs INTEGER NOT NULL DEFAULT 0,       -- how many times the architect sent it back
  updated_at TEXT NOT NULL,
  UNIQUE (team_id, station)
);
CREATE INDEX IF NOT EXISTS decisions_team ON decisions (team_id);

CREATE TABLE IF NOT EXISTS readouts (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  rank INTEGER,                                -- of the teams in the session, set at the read-out
  went_well TEXT NOT NULL,                     -- JSON array of sentences
  do_differently TEXT NOT NULL,                -- JSON array of sentences
  detail TEXT,                                 -- JSON: the evaluated build the sentences came from
  created_at TEXT NOT NULL
);
