-- 037_schema_fixes.sql — 2026-05-07
--
-- Tech debt audit schema fixes:
--   1. NOT NULL constraints on columns that should never be NULL
--   2. FK fixes: ON DELETE RESTRICT on crew_polls, crew_poll_votes, crew_meeting_points
--   3. Missing indexes for common query patterns
--   4. Wire purgeDeleted into retention_cleanup() function
--   5. Drop stale audit_log_view (unused by application code)
--
-- Fully idempotent: all operations guarded with IF NOT EXISTS, DO blocks,
-- EXCEPTION handlers, and conditional checks.

-- ============================================================
-- 1. NOT NULL constraints — backfill NULLs then add constraint
--    Only adds constraint if the column currently allows NULL
-- ============================================================

-- festivals.name
DO $$ BEGIN
  UPDATE festivals SET name = '' WHERE name IS NULL;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'festivals' AND column_name = 'name' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE festivals ALTER COLUMN name SET DEFAULT '';
    ALTER TABLE festivals ALTER COLUMN name SET NOT NULL;
  END IF;
END $$;

-- festivals.location
DO $$ BEGIN
  UPDATE festivals SET location = '' WHERE location IS NULL;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'festivals' AND column_name = 'location' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE festivals ALTER COLUMN location SET DEFAULT '';
    ALTER TABLE festivals ALTER COLUMN location SET NOT NULL;
  END IF;
END $$;

-- festival_sets.day_index
DO $$ BEGIN
  UPDATE festival_sets SET day_index = 0 WHERE day_index IS NULL;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'festival_sets' AND column_name = 'day_index' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE festival_sets ALTER COLUMN day_index SET NOT NULL;
  END IF;
END $$;

-- festival_sets.artist
DO $$ BEGIN
  UPDATE festival_sets SET artist = '' WHERE artist IS NULL;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'festival_sets' AND column_name = 'artist' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE festival_sets ALTER COLUMN artist SET DEFAULT '';
    ALTER TABLE festival_sets ALTER COLUMN artist SET NOT NULL;
  END IF;
END $$;

-- festival_stages.name
DO $$ BEGIN
  UPDATE festival_stages SET name = '' WHERE name IS NULL;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'festival_stages' AND column_name = 'name' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE festival_stages ALTER COLUMN name SET DEFAULT '';
    ALTER TABLE festival_stages ALTER COLUMN name SET NOT NULL;
  END IF;
END $$;

-- festival_days.label
DO $$ BEGIN
  UPDATE festival_days SET label = '' WHERE label IS NULL;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'festival_days' AND column_name = 'label' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE festival_days ALTER COLUMN label SET DEFAULT '';
    ALTER TABLE festival_days ALTER COLUMN label SET NOT NULL;
  END IF;
END $$;

-- festival_days.date
DO $$ BEGIN
  UPDATE festival_days SET date = '' WHERE date IS NULL;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'festival_days' AND column_name = 'date' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE festival_days ALTER COLUMN date SET DEFAULT '';
    ALTER TABLE festival_days ALTER COLUMN date SET NOT NULL;
  END IF;
END $$;

-- crews.name
DO $$ BEGIN
  UPDATE crews SET name = '' WHERE name IS NULL;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crews' AND column_name = 'name' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE crews ALTER COLUMN name SET DEFAULT '';
    ALTER TABLE crews ALTER COLUMN name SET NOT NULL;
  END IF;
END $$;

-- ============================================================
-- 2. FK fixes — add ON DELETE RESTRICT where currently implicit
--    NO ACTION (crew_polls, crew_poll_votes, crew_meeting_points)
--    These were missed by migration 031.
-- ============================================================

-- crew_polls.created_by -> users(id) ON DELETE RESTRICT
DO $$ BEGIN
  ALTER TABLE crew_polls DROP CONSTRAINT IF EXISTS crew_polls_created_by_fkey;
  ALTER TABLE crew_polls ADD CONSTRAINT crew_polls_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- crew_poll_votes.user_id -> users(id) ON DELETE RESTRICT
DO $$ BEGIN
  ALTER TABLE crew_poll_votes DROP CONSTRAINT IF EXISTS crew_poll_votes_user_id_fkey;
  ALTER TABLE crew_poll_votes ADD CONSTRAINT crew_poll_votes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- crew_meeting_points.created_by -> users(id) ON DELETE RESTRICT
DO $$ BEGIN
  ALTER TABLE crew_meeting_points DROP CONSTRAINT IF EXISTS crew_meeting_points_created_by_fkey;
  ALTER TABLE crew_meeting_points ADD CONSTRAINT crew_meeting_points_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 3. Missing indexes for common query patterns
--    CONCURRENTLY cannot run inside a transaction block.
-- ============================================================

-- festival_profiles.festival_id partial index for active profiles
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fp_festival_active
  ON festival_profiles (festival_id) WHERE deleted_at IS NULL;

-- notification_log composite index for listByUser ordering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_log_user_created
  ON notification_log (user_id, created_at DESC);

-- ============================================================
-- 4. Wire purgeDeleted into retention_cleanup()
--    Extends the existing function (from migration 034) to also
--    purge soft-deleted festivals (>90 days) and users (>30 days).
--    Mirrors the child-row cleanup from hardDelete() in
--    lib/db/stores/users.js and lib/db/stores/festivals.js.
-- ============================================================

CREATE OR REPLACE FUNCTION retention_cleanup() RETURNS void AS $$
BEGIN
  -- ── Existing: metrics and audit log cleanup ─────────────────
  DELETE FROM metrics_rollups
  WHERE bucket_start < now() - interval '90 days';

  DELETE FROM audit_log
  WHERE created_at < now() - interval '1 year';

  -- ── NEW: purge soft-deleted festivals older than 90 days ────
  -- Mirror festivals.hardDelete(): child rows under FK RESTRICT
  -- must be deleted before the parent.
  -- Child rows of festival_sets (FK RESTRICT)
  DELETE FROM set_ratings WHERE set_id IN (
    SELECT id FROM festival_sets WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM festival_profile_picks WHERE set_id IN (
    SELECT id FROM festival_sets WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM festival_profile_notes WHERE set_id IN (
    SELECT id FROM festival_sets WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM festival_profile_reminders WHERE set_id IN (
    SELECT id FROM festival_sets WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  -- Festival child tables
  DELETE FROM festival_sets WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM festival_stages WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM festival_days WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM festival_profiles WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM calendar_tokens WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM notification_counts WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM notification_topic_subs WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM message_sequences WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM festival_messages WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  -- Crew child tables for crews belonging to deleted festivals
  DELETE FROM crew_poll_votes WHERE poll_id IN (
    SELECT id FROM crew_polls WHERE crew_id IN (
      SELECT id FROM crews WHERE festival_id IN (
        SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
      )
    )
  );
  DELETE FROM crew_polls WHERE crew_id IN (
    SELECT id FROM crews WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM crew_meeting_points WHERE crew_id IN (
    SELECT id FROM crews WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM crew_expenses WHERE crew_id IN (
    SELECT id FROM crews WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM crew_activity WHERE crew_id IN (
    SELECT id FROM crews WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM crew_members WHERE crew_id IN (
    SELECT id FROM crews WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM crews WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  -- Finally delete the festival rows themselves
  DELETE FROM festivals WHERE deleted_at < now() - interval '90 days';

  -- ── NEW: purge soft-deleted users older than 30 days ────────
  -- Mirror users.hardDelete(): all child rows under FK RESTRICT
  DELETE FROM set_ratings WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM notification_topic_subs WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM notification_preferences WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM notification_log WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM notification_counts WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM device_tokens WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM calendar_tokens WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM festival_profiles WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_poll_votes WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_polls WHERE created_by IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_meeting_points WHERE created_by IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_members WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_expenses WHERE paid_by IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_activity WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM login_failures WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM email_verification_tokens WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM password_reset_tokens WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM refresh_tokens WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM user_sessions WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM user_roles WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  -- festival_messages uses ON DELETE SET NULL — no blocking FK
  -- Finally delete the user rows themselves
  DELETE FROM users WHERE deleted_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. Drop stale audit_log_view (created in 008, unused by app)
-- ============================================================

DROP VIEW IF EXISTS audit_log_view;

-- ============================================================
-- Record migration
-- ============================================================

INSERT INTO schema_migrations (version, name, applied_at)
VALUES (37, '037_schema_fixes', NOW())
ON CONFLICT DO NOTHING;
