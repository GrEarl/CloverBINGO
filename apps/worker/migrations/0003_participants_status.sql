-- Migration number: 0003 	 2025-12-17T05:27:00.000Z

-- participants: allow moderators to disable/restore specific participants (exclude from stats/spotlight)
ALTER TABLE participants ADD COLUMN status TEXT NOT NULL DEFAULT 'active'; -- active | disabled
ALTER TABLE participants ADD COLUMN disabled_at TEXT;
ALTER TABLE participants ADD COLUMN disabled_reason TEXT;
ALTER TABLE participants ADD COLUMN disabled_by TEXT;

CREATE INDEX IF NOT EXISTS participants_session_status_idx ON participants(session_id, status);
