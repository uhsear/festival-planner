-- 053_fix_retention_cleanup.sql
-- Fix retention_cleanup() crashing on every pg_cron run.
--
-- Migration 037 defined retention_cleanup() with DELETE statements against
-- festival_profile_reminders, message_sequences, and festival_messages — all
-- three of which were dropped in migration 013. PL/pgSQL resolves table names
-- at call time, so the function was accepted at CREATE but aborts at runtime
-- with "relation ... does not exist" on the first dropped-table DELETE, leaving
-- the entire soft-delete purge dead since 037.
--
-- This re-issues the function identically minus those three DELETE blocks (and
-- the stale festival_messages comment). CREATE OR REPLACE is idempotent.
--
-- Additive + idempotent per the repo migration convention.

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
  -- Finally delete the user rows themselves
  DELETE FROM users WHERE deleted_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql;
