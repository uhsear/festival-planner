-- 060_retention_cleanup_owned_crews.sql
-- Fix retention_cleanup() aborting on every run once any soft-deleted user had
-- created a crew.
--
-- Migration 031 changed crews.created_by from ON DELETE CASCADE to ON DELETE
-- RESTRICT (deliberate: a user deletion must not silently destroy a crew that
-- other members are in). retention_cleanup()'s user-purge section (added in 037,
-- fixed in 053) deletes every RESTRICT child EXCEPT the crews the user created,
-- so the final `DELETE FROM users` raises a foreign-key violation and the whole
-- function aborts — the soft-deleted-user purge has been dead for any batch that
-- includes a crew creator.
--
-- This re-issues the function identically to 053 plus a per-crew ownership step
-- in the user-purge section, mirroring users.hardDelete(): transfer ownership to
-- the longest-standing remaining member, or delete the crew only if the purged
-- user was its sole member (crew_id children all cascade). The heir must not be a
-- user in the same purge batch, or ownership would just move to another row that
-- the subsequent DELETE FROM users would fail on.
--
-- CREATE OR REPLACE is idempotent. Additive per the repo migration convention.

CREATE OR REPLACE FUNCTION retention_cleanup() RETURNS void AS $$
BEGIN
  -- ── Existing: metrics and audit log cleanup ─────────────────
  DELETE FROM metrics_rollups
  WHERE bucket_start < now() - interval '90 days';

  DELETE FROM audit_log
  WHERE created_at < now() - interval '1 year';

  -- ── Purge soft-deleted festivals older than 90 days ─────────
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

  -- ── Purge soft-deleted users older than 30 days ─────────────
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

  -- Crews created by a purged user (crews.created_by is ON DELETE RESTRICT since
  -- migration 031). Transfer ownership to the longest-standing member who is NOT
  -- also being purged in this batch; delete the crew only if no such member
  -- exists. Without this the DELETE FROM users below aborts on the FK.
  DECLARE
    _crew_id TEXT;
    _heir TEXT;
  BEGIN
    FOR _crew_id IN
      SELECT id FROM crews WHERE created_by IN (
        SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
      )
    LOOP
      SELECT user_id INTO _heir
      FROM crew_members
      WHERE crew_id = _crew_id
        AND user_id NOT IN (
          SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
        )
      ORDER BY joined_at ASC
      LIMIT 1;

      IF _heir IS NOT NULL THEN
        UPDATE crews SET created_by = _heir, updated_at = NOW() WHERE id = _crew_id;
        UPDATE crew_members SET role = 'owner' WHERE crew_id = _crew_id AND user_id = _heir;
      ELSE
        DELETE FROM crews WHERE id = _crew_id;
      END IF;
    END LOOP;
  END;

  -- Finally delete the user rows themselves
  DELETE FROM users WHERE deleted_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql;
