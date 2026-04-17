-- 022_festivals_geo.sql
-- Add latitude/longitude columns to festivals for weather integration.
-- These columns existed in production (added out-of-band in an earlier hotfix)
-- but were never captured in a migration, so CI failed once migration-loop
-- was hardened to fail on errors (|| true removed in ci.yml).

ALTER TABLE festivals ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
