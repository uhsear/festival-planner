-- Migration 026: Add invite_expires_at to crews
-- Invite codes expire after 7 days (TTL set on create/regenerate)

ALTER TABLE crews ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ;

-- Set existing rows to expire 7 days from now
UPDATE crews SET invite_expires_at = NOW() + INTERVAL '7 days' WHERE invite_expires_at IS NULL;

-- Plain composite index for quick expiry checks
CREATE INDEX IF NOT EXISTS idx_crews_invite_expires ON crews (invite_code, invite_expires_at);
