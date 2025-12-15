-- Migration number: 0001 	 2025-12-15T02:54:34.389Z

-- sessions: session metadata (code for humans, id for internal routing)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL, -- active | ended
  created_at TEXT NOT NULL,
  ended_at TEXT
);

-- invites: auth tokens (admin/mod)
CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL, -- admin | mod
  created_at TEXT NOT NULL,
  label TEXT
);

CREATE INDEX IF NOT EXISTS invites_session_id_idx ON invites(session_id);

-- participants: identity + card (needed to restore from commit log)
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  card_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS participants_session_id_idx ON participants(session_id);

-- draw_commits: commit log for draws (1..75), unique per session
CREATE TABLE IF NOT EXISTS draw_commits (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  number INTEGER NOT NULL, -- 1..75
  committed_at TEXT NOT NULL,
  reach_count INTEGER,
  bingo_count INTEGER,
  new_bingo_count INTEGER,
  PRIMARY KEY (session_id, seq),
  UNIQUE (session_id, number)
);

CREATE INDEX IF NOT EXISTS draw_commits_session_id_idx ON draw_commits(session_id);
