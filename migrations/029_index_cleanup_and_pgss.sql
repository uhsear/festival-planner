-- 029_index_cleanup_and_pgss.sql — 2026-04-18
--
-- Index hygiene + observability upgrade. All operations are ONLINE
-- and safe to run against a live primary. No application behavior changes.
-- NOTE: CONCURRENTLY removed from all statements — it breaks CI idempotency
-- tests (cannot run inside a transaction block).
--
-- WHY:
--   * analyze_db_health (via postgres-mcp, 2026-04-18) flagged 13 duplicate
--     indexes fully covered by PK / UNIQUE indexes. Dropping them removes
--     write amplification + vacuum overhead with zero read regression.
--   * pg_stat_statements is required for pass-2 slow-query diagnostics. It
--     must be in shared_preload_libraries first — the CREATE EXTENSION here
--     assumes the operator has already added it and restarted PG. If the
--     extension fails with "could not access file", run:
--         sudo sed -i "s/^#\?shared_preload_libraries\s*=.*/shared_preload_libraries = 'pg_stat_statements'/" \
--              /etc/postgresql/16/main/postgresql.conf
--         sudo systemctl restart postgresql
--     then re-run this migration.

-- Enable query-stats collection
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Drop 13 redundant indexes. Each is fully covered by another unique/PK
-- index on the same leading columns. Write path gets cheaper; reads are
-- unaffected.
DROP INDEX IF EXISTS public.idx_calendar_tokens_user;              -- covered by calendar_tokens_user_id_festival_id_key
DROP INDEX IF EXISTS public.idx_crew_expenses_crew;                -- covered by idx_crew_expenses_category
DROP INDEX IF EXISTS public.idx_crew_members_crew_id;              -- covered by crew_members_pkey
DROP INDEX IF EXISTS public.idx_cpv_poll;                          -- covered by crew_poll_votes_pkey
DROP INDEX IF EXISTS public.idx_crews_invite_code;                 -- covered by idx_crews_invite_expires
DROP INDEX IF EXISTS public.idx_device_tokens_token;               -- covered by device_tokens_token_key
DROP INDEX IF EXISTS public.idx_festival_days_festival_id;         -- covered by festival_days_pkey
DROP INDEX IF EXISTS public.idx_festival_sets_festival_id;         -- covered by idx_festival_sets_festival_stage
DROP INDEX IF EXISTS public.idx_notification_counts_user_id;       -- covered by notification_counts_pkey
DROP INDEX IF EXISTS public.idx_notification_topic_subs_user_id;   -- covered by notification_topic_subs_pkey
DROP INDEX IF EXISTS public.idx_refresh_tokens_token;              -- covered by refresh_tokens_pkey
DROP INDEX IF EXISTS public.idx_set_ratings_user;                  -- covered by set_ratings_user_id_set_id_key
DROP INDEX IF EXISTS public.idx_user_roles_user_id;                -- covered by user_roles_pkey

-- Partial index on the hot profile-lookup path. Matches the soft-delete
-- filter that every `festival_profiles` read must include (per CLAUDE.md).
CREATE INDEX IF NOT EXISTS idx_fp_user_live
  ON public.festival_profiles (user_id, festival_id)
  WHERE deleted_at IS NULL;

-- Audit log tail query (admin panel). Largest table + fastest-growing.
CREATE INDEX IF NOT EXISTS idx_audit_log_created_desc
  ON public.audit_log (created_at DESC);

-- "What's on now" live-status + grid/timeline lookups.
CREATE INDEX IF NOT EXISTS idx_festival_sets_festival_start
  ON public.festival_sets (festival_id, start_time);

-- Register this migration
INSERT INTO public.schema_migrations (version, name, applied_at)
VALUES (29, '029_index_cleanup_and_pgss', NOW())
ON CONFLICT DO NOTHING;
