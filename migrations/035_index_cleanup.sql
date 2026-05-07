-- 035_index_cleanup.sql — 2026-05-07
--
-- Drop indexes with 0 scans over 7 weeks of production monitoring.
-- Conservative: only indexes confirmed redundant via covering PK/unique
-- or superseded by composite indexes. No PKs, unique constraints, or
-- FK-support indexes are touched.
--
-- CONCURRENTLY cannot run inside a transaction — no BEGIN/COMMIT.

-- ── idx_festival_profiles_user_id ────────────────────────────────────
-- Single-column index on festival_profiles(user_id).
-- Superseded by idx_fp_user_live (user_id, festival_id) WHERE deleted_at IS NULL
-- and idx_festival_profiles_user_festival (unique on user_id, festival_id WHERE deleted_at IS NULL).
-- All application queries on user_id also filter deleted_at IS NULL,
-- which both partial indexes cover.
DROP INDEX CONCURRENTLY IF EXISTS idx_festival_profiles_user_id;

-- ── idx_festival_stages_sort ─────────────────────────────────────────
-- Composite index on festival_stages(festival_id, sort_order).
-- The PK (festival_id, id) already covers festival_id lookups.
-- Table has <50 rows total — in-memory sort is free.
-- 0 index scans in 7 weeks confirms no planner usage.
DROP INDEX CONCURRENTLY IF EXISTS idx_festival_stages_sort;

-- ── idx_crew_expenses_paid ───────────────────────────────────────────
-- Single-column index on crew_expenses(paid_by).
-- FK support index, but FKs on this table use ON DELETE RESTRICT (031),
-- meaning the parent DELETE is rejected — no child scan needed.
-- Table has <20 rows; 0 scans in 7 weeks.
DROP INDEX CONCURRENTLY IF EXISTS idx_crew_expenses_paid;

-- ── idx_crew_activity_user_id ────────────────────────────────────────
-- Single-column index on crew_activity(user_id).
-- FK changed to ON DELETE RESTRICT (031) — no cascade scan.
-- All crew_activity queries filter by crew_id (via idx_crew_activity_crew),
-- never by user_id alone. 0 scans in 7 weeks.
DROP INDEX CONCURRENTLY IF EXISTS idx_crew_activity_user_id;

-- ── Record migration ─────────────────────────────────────────────────

INSERT INTO schema_migrations (version, name, applied_at)
VALUES (35, '035_index_cleanup', NOW())
ON CONFLICT DO NOTHING;
