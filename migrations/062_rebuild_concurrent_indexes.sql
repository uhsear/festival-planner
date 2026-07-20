-- 062_rebuild_concurrent_indexes.sql
-- Defensive rebuild of the two indexes migration 037 built CONCURRENTLY. A
-- concurrent build that loses its lock race or is killed mid-scan leaves the
-- index present but INVALID (pg_index.indisvalid = false): the planner never
-- uses it, it can never self-heal, and every later idempotent re-issue of the
-- same name -- including 040's re-issue of idx_notification_log_user_created --
-- sees the invalid stub, skips it, and the hot path silently seq-scans forever
-- with no drift signal.
-- (WF4 deep-findings, tech-debt-2026-07-16-deep-findings.md: "A failed
-- concurrent index build leaves an INVALID index that a later idempotent
-- re-issue then skips forever". These are the only two concurrent index builds
-- in the 032+037 pair the finding anchors -- 032 itself only drops indexes;
-- both builds are in 037 lines 149 and 153.)
--
-- Fix: drop then rebuild each one NON-concurrently. This file uses no
-- CONCURRENTLY keyword in executable SQL, so the runner applies the whole body
-- inside one BEGIN/COMMIT (lib/planner-db-pg.ts). A non-concurrent index build
-- inside a transaction can NEVER be left invalid -- it either commits fully
-- valid or rolls back entirely. The IF-EXISTS drop clears any pre-existing
-- invalid stub that a bare idempotent build would skip; the IF-NOT-EXISTS build
-- then produces a guaranteed-valid index. Idempotent and correct whether the
-- index is currently valid, invalid, or absent.
--
-- Additive / forward-only: identical names and definitions to 037, so live
-- instances mid-rollout keep using the same index -- no schema-shape change. The
-- one-time rebuild takes a brief SHARE lock (blocks writes, not reads) on each
-- table during this boot-applied migration; acceptable at deploy time.
-- ponytail: unconditional rebuild rather than an indisvalid-checked DO block --
-- a currently-valid index is briefly dropped and rebuilt inside the txn, a
-- non-event for a migration that applies exactly once. Add the boot/CI
-- `WHERE NOT indisvalid` detector separately if invalid indexes ever recur.

-- 037 line 149 -- festival_profiles active-profile lookup (getByFestival / orphan-claim)
DROP INDEX IF EXISTS idx_fp_festival_active;
CREATE INDEX IF NOT EXISTS idx_fp_festival_active
  ON festival_profiles (festival_id) WHERE deleted_at IS NULL;

-- 037 line 153 (also re-issued at 040 line 7) -- notification_log per-user fan-out ordering
DROP INDEX IF EXISTS idx_notification_log_user_created;
CREATE INDEX IF NOT EXISTS idx_notification_log_user_created
  ON notification_log (user_id, created_at DESC);
