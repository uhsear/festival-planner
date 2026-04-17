-- Migration 007: ToS acceptance tracking and soft-delete cleanup job support

-- Track when users accepted Terms of Service
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_version INTEGER DEFAULT 1;

-- Index for finding accounts pending hard-delete (soft-deleted > 30 days ago)
CREATE INDEX IF NOT EXISTS idx_users_pending_hard_delete
  ON users(deleted_at) WHERE deleted_at IS NOT NULL;
