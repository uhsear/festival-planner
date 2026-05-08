-- 038_db_audit_indexes.sql — 2026-05-07
--
-- Database layer audit: add missing indexes for common query patterns
-- discovered by cross-referencing WHERE clauses in lib/db/stores/*.js
-- and routes/*.js against existing indexes.
--
-- All statements use IF NOT EXISTS — safe to re-run.
-- CONCURRENTLY cannot run inside a transaction block.

-- ── 1. crew_polls: partial index for active polls by crew ───────────
-- polls.listByCrew filters: crew_id = $1 AND closed = FALSE
-- Existing idx_cp_crew already covers this (WHERE closed = FALSE).
-- No new index needed.

-- ── 2. crew_poll_votes: user_id index for user hard-delete ─────────
-- users.hardDelete deletes from crew_poll_votes WHERE user_id = $1.
-- PK is (poll_id, user_id) — does NOT support user_id-leading lookups.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cpv_user_id
  ON crew_poll_votes (user_id);

-- ── 3. crew_meeting_points: crew_id + active composite ─────────────
-- meetingPoints.countByCrew: WHERE crew_id = $1 AND active = TRUE
-- Existing idx_cmp_crew covers this.
-- No new index needed.

-- ── 4. festival_profiles: orphan claim functional index ─────────────
-- profiles.claimOrphan: WHERE user_id IS NULL AND LOWER(name) = LOWER($2)
-- profiles.claimOrphanProfiles: WHERE user_id IS NULL AND LOWER(name) = LOWER($2)
-- Without this, the query does a sequential scan over all profiles.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fp_orphan_name
  ON festival_profiles (LOWER(name))
  WHERE user_id IS NULL AND deleted_at IS NULL;

-- ── 5. users: email lookup for registration uniqueness check ────────
-- auth.js register: WHERE LOWER(email) = $1 AND deleted_at IS NULL
-- Existing idx_users_email already covers this.
-- No new index needed.

-- ── 6. user_sessions: last_access for session cleanup ordering ──────
-- sessions.deleteExpiredUserSessions: WHERE created_at <= $1
-- Existing idx_user_sessions_created_at covers this.
-- No new index needed.

-- ── 7. crew_expenses: crew_id + created_at DESC for getByCrew ───────
-- expenses.getByCrew: WHERE crew_id = $1 ORDER BY created_at DESC
-- idx_crew_expenses_category covers (crew_id, category) but not ordering.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crew_expenses_crew_created
  ON crew_expenses (crew_id, created_at DESC);

-- ── 8. metrics_rollups: composite for range + ordering ──────────────
-- metricsRollups.query: WHERE bucket_start >= $1 AND bucket_start < $2
--                       ORDER BY bucket_start DESC
-- Existing idx_metrics_rollups_bucket covers ascending but the query
-- sorts descending. Postgres can reverse-scan a btree, so existing
-- index suffices. No new index needed.

-- ── Record migration ─────────────────────────────────────────────────

INSERT INTO schema_migrations (version, name, applied_at)
VALUES (38, '038_db_audit_indexes', NOW())
ON CONFLICT DO NOTHING;
