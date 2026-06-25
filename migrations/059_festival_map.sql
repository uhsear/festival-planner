-- 059_festival_map.sql
-- Festival site-map data model (mirrors 050_meeting_point_coords.sql / 022_festivals_geo.sql).
-- (1) Per-stage GPS pins: nullable lat/lng on festival_stages so a stage can be
--     placed on the festival map. Nullable + no backfill — stages without coords
--     simply don't render a pin, and festivals never mapped keep the "not mapped
--     yet" fallback.
-- (2) Festival-level map_config jsonb: optional center/bounds, amenity & zone
--     GeoJSON FeatureCollections, and an optional georeferenced site-plan overlay.
--     Nullable — existing festivals have NULL map_config and still work unchanged.

ALTER TABLE festival_stages ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE festival_stages ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE festivals ADD COLUMN IF NOT EXISTS map_config jsonb;
