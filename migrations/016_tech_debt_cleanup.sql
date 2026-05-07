-- Migration 016: Tech debt cleanup — drop unused indexes, add NOT NULL to created_at
-- Safe: all changes are additive defaults or index drops (no data loss)

BEGIN;

-- ── Drop confirmed-unused indexes (0 scans since pg_stat reset) ──
-- Kept: crews_invite_code_key (unique constraint, required for correctness)
-- Kept: primary keys and unique constraints

-- Audit log indexes — 0 scans; audit queries use idx_audit_log_created_at + idx_audit_log_actor_id
DROP INDEX IF EXISTS idx_audit_log_action;
DROP INDEX IF EXISTS idx_audit_log_action_created_at;
DROP INDEX IF EXISTS idx_audit_log_actor_created_at;
DROP INDEX IF EXISTS idx_audit_log_request_id;
DROP INDEX IF EXISTS idx_audit_log_target_id;

-- Festival sets — lookup is by festival_id + day via query, not individual indexes
DROP INDEX IF EXISTS idx_festival_sets_artist;
DROP INDEX IF EXISTS idx_festival_sets_day_index;
DROP INDEX IF EXISTS idx_festival_sets_sort;

-- Notification indexes — 0 scans, tables have minimal data
DROP INDEX IF EXISTS idx_notification_counts_festival_id;
DROP INDEX IF EXISTS idx_notification_log_created_at;
DROP INDEX IF EXISTS idx_notification_log_status;

-- Other unused
DROP INDEX IF EXISTS idx_festival_profiles_deleted_at;
DROP INDEX IF EXISTS idx_festival_stages_festival_id;
DROP INDEX IF EXISTS idx_festivals_created_at;
DROP INDEX IF EXISTS idx_users_deleted_at;
DROP INDEX IF EXISTS idx_users_pending_hard_delete;

-- ── Add NOT NULL DEFAULT NOW() to nullable created_at columns ──
-- These columns always have values in practice; this enforces the invariant.

ALTER TABLE audit_log ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE audit_log ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE email_verification_tokens ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE email_verification_tokens ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE password_reset_tokens ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE password_reset_tokens ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE notification_log ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE notification_log ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE device_tokens ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE device_tokens ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE crews ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE crews ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE festival_profiles ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE festival_profiles ALTER COLUMN created_at SET NOT NULL;

-- user_sessions.created_at may be bigint (epoch ms) or timestamptz (after migration 036)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_sessions' AND column_name = 'created_at' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE user_sessions ALTER COLUMN created_at SET DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint;
    ALTER TABLE user_sessions ALTER COLUMN created_at SET NOT NULL;
  ELSE
    ALTER TABLE user_sessions ALTER COLUMN created_at SET DEFAULT NOW();
    ALTER TABLE user_sessions ALTER COLUMN created_at SET NOT NULL;
  END IF;
END $$;

ALTER TABLE festivals ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE festivals ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE refresh_tokens ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE refresh_tokens ALTER COLUMN created_at SET NOT NULL;

-- Record migration
INSERT INTO schema_migrations (version, name, applied_at) VALUES (16, '016_tech_debt_cleanup', NOW())
ON CONFLICT DO NOTHING;

COMMIT;
