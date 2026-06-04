-- 050_meeting_point_coords.sql
-- F4: nullable lat/lng coords on crew_meeting_points (mirrors 022_festivals_geo.sql).
-- Gate for last-synced position, proximity compass, and offline-map pins.
-- Nullable + no backfill: legacy free-text meeting points keep NULL coords and
-- still work unchanged.

ALTER TABLE crew_meeting_points ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE crew_meeting_points ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
