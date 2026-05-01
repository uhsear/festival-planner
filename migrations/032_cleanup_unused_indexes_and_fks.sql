-- 032_cleanup_unused_indexes_and_fks.sql — 2026-05-01
--
-- Drop unused indexes (0 scans in production) and fix duplicate FKs.
-- CONCURRENTLY cannot run in a transaction — no BEGIN/COMMIT.

-- ── A. Drop unused indexes (0 scans in pg_stat_user_indexes) ──────────

DROP INDEX CONCURRENTLY IF EXISTS idx_audit_log_created_desc;
DROP INDEX CONCURRENTLY IF EXISTS idx_install_events_created_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_install_events_platform_event;
DROP INDEX CONCURRENTLY IF EXISTS idx_fp_user_live;
DROP INDEX CONCURRENTLY IF EXISTS idx_crew_meeting_points_created_by;
DROP INDEX CONCURRENTLY IF EXISTS idx_crew_polls_created_by;
DROP INDEX CONCURRENTLY IF EXISTS idx_festival_sets_festival_start;
DROP INDEX CONCURRENTLY IF EXISTS idx_crews_invite_expires;
DROP INDEX CONCURRENTLY IF EXISTS idx_cmp_expires;
DROP INDEX CONCURRENTLY IF EXISTS idx_fp_reminders_not_null;

-- ── B. Fix duplicate FKs on festival_sets ─────────────────────────────
--
-- Baseline (004) created an inline FK: festival_id REFERENCES festivals(id)
-- which PostgreSQL auto-named "festival_sets_festival_id_fkey".
-- Migration 021 added a composite FK "festival_sets_stage_fkey" on
-- (festival_id, stage_id) -> festival_stages(festival_id, id).
-- Since festival_stages itself has a FK to festivals, the single-column
-- festival_sets_festival_id_fkey is redundant — every valid (festival_id,
-- stage_id) in festival_stages already guarantees festival_id exists in
-- festivals.  Drop the redundant single-column FK.

ALTER TABLE festival_sets DROP CONSTRAINT IF EXISTS festival_sets_festival_id_fkey;

INSERT INTO public.schema_migrations (version, name, applied_at)
VALUES (32, '032_cleanup_unused_indexes_and_fks', NOW())
ON CONFLICT DO NOTHING;
