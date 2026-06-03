-- 043: Crew lineage for "reform crew for next festival".
--
-- Crews are festival-scoped (crews.festival_id NOT NULL) — there is no
-- cross-festival crew identity. "Reforming" a crew therefore CREATES a new crew
-- in the target festival and invites the prior roster. `reformed_from` records
-- which crew the new one was reformed from so the UI can show "your crew last
-- year". Nullable, self-referential FK with ON DELETE SET NULL so deleting the
-- old crew never blocks or cascades into the new one — the lineage simply
-- forgets its parent.
--
-- Additive, mirrors the style of 041_user_display_name.sql /
-- 042_payment_handles.sql / 022_festivals_geo.sql. No backfill — existing crews
-- have no parent and stay NULL.
ALTER TABLE crews ADD COLUMN IF NOT EXISTS reformed_from TEXT REFERENCES crews(id) ON DELETE SET NULL;

-- FK index per the repo's _fk_indexes convention (lets "find crews reformed
-- from X" + the ON DELETE SET NULL scan stay index-backed).
CREATE INDEX IF NOT EXISTS crews_reformed_from_idx ON crews (reformed_from);
