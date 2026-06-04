-- 048: per-type opt-out columns for the M3 re-engagement triggers.
--
-- M3 adds three after-festival growth notifications — lineup_drop, crew_reformed,
-- wrap_ready (see docs/plans/feature-roadmap-2026-06-03.md M3). Each gets its own
-- opt-out boolean on notification_preferences, mirroring the existing core toggles
-- (crew_updates / set_reminders / schedule_changes) which are INTEGER 0/1 columns
-- defaulting to 1 (opted-in). send.ts's PREF_MAP routes:
--   lineup_drop   -> lineup_drops
--   crew_reformed -> crew_reformed
--   wrap_ready    -> wrap_ready
-- A NULL/absent value is treated as opted-in by the read path (store.get defaults
-- to 1), so existing rows need no backfill — DEFAULT 1 covers new rows and the
-- column reads as 1 for any row written before this migration via the store's
-- COALESCE-free default object.
--
-- Additive, idempotent (ADD COLUMN IF NOT EXISTS), default 1 / opted-in, mirrors
-- the style of 043_crew_lineage.sql / 045_crew_expense_planned.sql. No backfill.
-- NOTE: prod migrations do NOT auto-apply — apply manually as part of deploy.

ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS lineup_drops INTEGER DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS crew_reformed INTEGER DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS wrap_ready INTEGER DEFAULT 1;
