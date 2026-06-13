-- 054_add_festival_timezone.sql
-- Festival timezone — anchor set live-status + reminder fire-times in the
-- festival's own zone instead of each attendee's device zone.
--
-- Until now the client computed set status (LIVE / soon / past) and the backend
-- reminder scheduler computed fire-times using the *device-local* frame. For an
-- attendee whose phone is set to a different zone than the festival, every
-- boundary shifts by their UTC offset — the wrong badge shows and reminders fire
-- at the wrong wall-clock. Storing an optional IANA time_zone per festival lets
-- both sides anchor wall-clock math in the festival's zone (see
-- packages/shared/src/utils/setStatus.ts zonedWallTimeToMs + lib/time-zone.ts).
--
-- Nullable, NO backfill: existing festivals stay NULL, so server + client keep
-- the prior device-local behavior verbatim (zero regression). Admins opt a
-- festival in by setting its zone in the edit form.
--
-- Additive + idempotent per the repo migration convention (the app-managed
-- runner in lib/planner-db-pg.ts records the version — no manual footer).

ALTER TABLE festivals ADD COLUMN IF NOT EXISTS time_zone TEXT;
