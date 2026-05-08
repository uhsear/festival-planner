-- 039_additional_query_indexes.sql — 2026-05-08
--
-- Additional indexes identified by database query optimization scan.
-- All statements use IF NOT EXISTS — safe to re-run.
-- CONCURRENTLY cannot run inside a transaction block.

-- ── 1. crew_poll_votes: poll_id index for JOIN in polls.listByCrew ────
-- polls.listByCrew: LEFT JOIN crew_poll_votes v ON p.id = v.poll_id
-- PK is (poll_id, user_id) which DOES cover poll_id-leading lookups,
-- but an explicit index helps the planner and covers DELETE cascades.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cpv_poll_id
  ON crew_poll_votes (poll_id);

-- ── 2. festival_profiles: composite for getByFestival query ──────────
-- profiles.getByFestival: WHERE festival_id = $1 AND deleted_at IS NULL
--                         ORDER BY created_at ASC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fp_festival_active_created
  ON festival_profiles (festival_id, created_at ASC)
  WHERE deleted_at IS NULL;

-- ── 3. crew_activity: user_id for hard-delete cascade ────────────────
-- users.hardDelete: DELETE FROM crew_activity WHERE user_id = $1
-- No existing index covers user_id-leading lookups.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crew_activity_user_id
  ON crew_activity (user_id);

-- ── Record migration ─────────────────────────────────────────────────
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (39, '039_additional_query_indexes', NOW())
ON CONFLICT DO NOTHING;
