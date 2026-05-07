-- 036_session_timestamps.sql — 2026-05-07
--
-- Standardize user_sessions and login_failures timestamp columns from
-- BIGINT epoch-ms to TIMESTAMPTZ, matching every other table in the schema.
--
-- Approach: rename old column, add new TIMESTAMPTZ column, backfill via
-- to_timestamp(), drop old column. Same pattern used for refresh_tokens in 015.
--
-- Idempotent: all operations guarded with data_type checks.

-- ── user_sessions.created_at: BIGINT -> TIMESTAMPTZ ──────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_sessions' AND column_name = 'created_at' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE user_sessions RENAME COLUMN created_at TO created_at_epoch;
    ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
    UPDATE user_sessions SET created_at = to_timestamp(created_at_epoch / 1000.0)
      WHERE created_at_epoch IS NOT NULL;
    ALTER TABLE user_sessions ALTER COLUMN created_at SET DEFAULT NOW();
    ALTER TABLE user_sessions ALTER COLUMN created_at SET NOT NULL;
    ALTER TABLE user_sessions DROP COLUMN created_at_epoch;
  END IF;
END $$;

-- ── user_sessions.last_access: BIGINT -> TIMESTAMPTZ ─────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_sessions' AND column_name = 'last_access' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE user_sessions RENAME COLUMN last_access TO last_access_epoch;
    ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_access TIMESTAMPTZ;
    UPDATE user_sessions SET last_access = to_timestamp(last_access_epoch / 1000.0)
      WHERE last_access_epoch IS NOT NULL;
    ALTER TABLE user_sessions ALTER COLUMN last_access SET DEFAULT NOW();
    ALTER TABLE user_sessions ALTER COLUMN last_access SET NOT NULL;
    ALTER TABLE user_sessions DROP COLUMN last_access_epoch;
  END IF;
END $$;

-- ── login_failures.last_failure_at: BIGINT -> TIMESTAMPTZ ────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'login_failures' AND column_name = 'last_failure_at' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE login_failures RENAME COLUMN last_failure_at TO last_failure_at_epoch;
    ALTER TABLE login_failures ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ;
    UPDATE login_failures SET last_failure_at = to_timestamp(last_failure_at_epoch / 1000.0)
      WHERE last_failure_at_epoch IS NOT NULL;
    ALTER TABLE login_failures DROP COLUMN last_failure_at_epoch;
  END IF;
END $$;

-- ── login_failures.locked_until: BIGINT -> TIMESTAMPTZ ───────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'login_failures' AND column_name = 'locked_until' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE login_failures RENAME COLUMN locked_until TO locked_until_epoch;
    ALTER TABLE login_failures ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
    UPDATE login_failures SET locked_until = to_timestamp(locked_until_epoch / 1000.0)
      WHERE locked_until_epoch IS NOT NULL;
    ALTER TABLE login_failures DROP COLUMN locked_until_epoch;
  END IF;
END $$;

-- ── Rebuild index on the new created_at column ───────────────────────
-- The original idx_user_sessions_created_at was on the BIGINT column;
-- after the column swap it should already point to the new column,
-- but recreate to be safe.
DROP INDEX IF EXISTS idx_user_sessions_created_at;
CREATE INDEX IF NOT EXISTS idx_user_sessions_created_at ON user_sessions (created_at);

-- ── Record migration ─────────────────────────────────────────────────

INSERT INTO schema_migrations (version, name, applied_at)
VALUES (36, '036_session_timestamps', NOW())
ON CONFLICT DO NOTHING;
