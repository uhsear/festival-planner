-- 034: Dead-column cleanup, time format constraints, retention policies
-- Idempotent: all operations guarded with IF EXISTS / DO blocks

-- ============================================================
-- 1. Drop 6 dead epoch/drift columns from refresh_tokens
--    Migration 015 renamed BIGINT epoch cols to *_epoch, then
--    migration 023 re-added *_ts columns for drift capture.
--    Neither set is referenced by application code.
-- ============================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refresh_tokens' AND column_name = 'expires_at_epoch'
  ) THEN
    ALTER TABLE refresh_tokens DROP COLUMN expires_at_epoch;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refresh_tokens' AND column_name = 'created_at_epoch'
  ) THEN
    ALTER TABLE refresh_tokens DROP COLUMN created_at_epoch;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refresh_tokens' AND column_name = 'rotated_at_epoch'
  ) THEN
    ALTER TABLE refresh_tokens DROP COLUMN rotated_at_epoch;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refresh_tokens' AND column_name = 'expires_at_ts'
  ) THEN
    ALTER TABLE refresh_tokens DROP COLUMN expires_at_ts;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refresh_tokens' AND column_name = 'created_at_ts'
  ) THEN
    ALTER TABLE refresh_tokens DROP COLUMN created_at_ts;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refresh_tokens' AND column_name = 'rotated_at_ts'
  ) THEN
    ALTER TABLE refresh_tokens DROP COLUMN rotated_at_ts;
  END IF;
END $$;

-- ============================================================
-- 2. CHECK constraints on festival_sets.start_time / end_time
--    Format: HH:MM (validated by Zod schema on input).
--    Allow NULL and empty string (schema permits both).
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_festival_sets_start_time'
  ) THEN
    ALTER TABLE festival_sets
      ADD CONSTRAINT chk_festival_sets_start_time
      CHECK (start_time IS NULL OR start_time = '' OR start_time ~ '^\d{2}:\d{2}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_festival_sets_end_time'
  ) THEN
    ALTER TABLE festival_sets
      ADD CONSTRAINT chk_festival_sets_end_time
      CHECK (end_time IS NULL OR end_time = '' OR end_time ~ '^\d{2}:\d{2}$');
  END IF;
END $$;

-- ============================================================
-- 3. Retention: metrics_rollups — delete rows older than 90 days
--    Runs as a callable function; invoke via pg_cron or app-level
--    scheduled task (e.g. node-cron, PM2 cron_restart).
-- ============================================================
CREATE OR REPLACE FUNCTION retention_cleanup() RETURNS void AS $$
BEGIN
  -- metrics_rollups: keep 90 days
  DELETE FROM metrics_rollups
  WHERE bucket_start < now() - interval '90 days';

  -- audit_log: keep 1 year (no archive table exists — hard delete)
  DELETE FROM audit_log
  WHERE created_at < now() - interval '1 year';
END;
$$ LANGUAGE plpgsql;

-- Schedule via pg_cron if the extension is available.
-- Runs daily at 03:00 UTC. Silently skipped when pg_cron is not installed.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'
  ) THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    -- Unschedule previous job if it exists (idempotent re-run)
    PERFORM cron.unschedule('retention_cleanup')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'retention_cleanup'
    );

    PERFORM cron.schedule(
      'retention_cleanup',
      '0 3 * * *',
      'SELECT retention_cleanup()'
    );
  END IF;
END $$;
