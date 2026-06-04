-- 052_crew_photo_album.sql
-- M6 Crew Photo Wall — Phase 1 (link-out only).
--
-- Festie does NOT host photos yet (the R2 upload pipeline is deferred to a later
-- phase). Phase 1 simply stores a single shared-album URL per crew (e.g. a
-- Google Photos / Apple shared-album link) that members paste and open. The
-- column is nullable: a crew with no album set just hides the section.
--
-- Additive + idempotent per the repo migration convention.

ALTER TABLE crews ADD COLUMN IF NOT EXISTS photo_album_url TEXT;
