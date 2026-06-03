-- Migration 046: Crew packing board (M2 logistics)
--
-- A lightweight shared checklist so a crew can coordinate "who's bringing what"
-- (tent, cooler, sunscreen). Each row is one item with an optional `brought_by`
-- owner and a `claimed` flag. A new crew sub-resource cloning the existing
-- poll / meeting-point pattern exactly — additive, no backfill.
--
-- Mirrors the style of 017_meeting_points.sql / 018_crew_polls.sql.

CREATE TABLE IF NOT EXISTS crew_packing_items (
  id TEXT PRIMARY KEY,
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  label TEXT NOT NULL,
  brought_by TEXT,
  claimed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- FK index on crew_id (per the _fk_indexes convention) — every listByCrew
-- filters on it, and the ON DELETE CASCADE benefits from it too.
CREATE INDEX IF NOT EXISTS idx_crew_packing_items_crew_id ON crew_packing_items (crew_id);
