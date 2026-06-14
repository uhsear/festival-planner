-- 055_offline_presence_and_recurring_meets.sql
-- Two research-backed no-signal regrouping capabilities, both EXTENDING existing
-- tables (no new tables).
--
-- (A) OFFLINE PRESENCE BREADCRUMB on crew_member_status (migration 051).
--     The #1 festival pain is regrouping with no signal. crew_member_status
--     already stores a last-synced "on my way / ETA" snapshot per (crew, user).
--     We add a last-known LOCATION breadcrumb: a coord the member captured
--     (often OFFLINE) that delivers on the next signal blip and persists.
--
--     IMPORTANT — this is NOT live GPS. It is a degraded-sync breadcrumb the UI
--     renders with HONEST STALENESS ("last seen near X, as of N ago"), never
--     "live". location_captured_at is when the member's device stamped the fix
--     (offline), distinct from updated_at (when the row last synced). All three
--     columns are nullable: a status with no breadcrumb keeps NULL coords and
--     behaves exactly as before (zero regression for existing rows).
--
-- (B) MEETING-POINTS-WITH-RECURRING-TIME on crew_meeting_points (migration 017).
--     crew_meeting_points already has meet_at TIMESTAMPTZ + stage_reference TEXT.
--     We add daily recurrence so a crew can set "regroup 3pm & 9pm at the tree" /
--     a per-stage default that repeats each festival day — the most-upvoted
--     no-signal answer. recurs_daily defaults FALSE so every existing point keeps
--     its current one-shot behavior unchanged.
--
-- Additive + idempotent per the repo migration convention (every statement is
-- guarded with IF NOT EXISTS). The app-managed runner in lib/planner-db-pg.ts
-- records the version — no manual footer.

ALTER TABLE crew_member_status ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE crew_member_status ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE crew_member_status ADD COLUMN IF NOT EXISTS location_captured_at TIMESTAMPTZ;

ALTER TABLE crew_meeting_points ADD COLUMN IF NOT EXISTS recurs_daily BOOLEAN DEFAULT FALSE;
