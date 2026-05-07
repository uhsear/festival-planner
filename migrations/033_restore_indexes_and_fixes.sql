-- 033_restore_indexes_and_fixes.sql — 2026-05-07
--
-- A) Re-add audit_log indexes dropped by 032. The audit_log table is the
--    fastest-growing table (9K+ rows) and the audit store filters on
--    actor_id, action, target_type, and created_at.
-- B) Add partial index on notification_topic_subs for unsubscribed lookups.
--
-- CONCURRENTLY cannot run inside a transaction — no BEGIN/COMMIT here.

-- ── A. Restore audit_log indexes ─────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_created_desc
  ON audit_log (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_actor_id
  ON audit_log (actor_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_action_created
  ON audit_log (action, created_at DESC);

-- ── B. Partial index for unsubscribed topic lookups ──────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nts_festival_topic
  ON notification_topic_subs (festival_id, topic) WHERE (subscribed = 0);

-- ── C. Record migration ──────────────────────────────────────────────

INSERT INTO schema_migrations (version, name, applied_at)
VALUES (33, 'restore_indexes_and_fixes', NOW())
ON CONFLICT DO NOTHING;
