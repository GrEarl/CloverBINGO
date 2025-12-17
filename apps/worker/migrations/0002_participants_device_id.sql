-- Migration number: 0002 	 2025-12-17T03:14:00.000Z

-- participants: prevent duplicate joins from the same device (per session)
ALTER TABLE participants ADD COLUMN device_id TEXT;

-- Allow NULL (legacy rows), but ensure that a device_id is unique within a session when present.
CREATE UNIQUE INDEX IF NOT EXISTS participants_session_device_uq ON participants(session_id, device_id);
CREATE INDEX IF NOT EXISTS participants_session_device_idx ON participants(session_id, device_id);
