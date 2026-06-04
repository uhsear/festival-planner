-- Migration 047: Crew carpool / ride board (M2 logistics)
--
-- A lightweight shared ride board so a crew can coordinate carpools — who's
-- driving, how many seats, where they're leaving from and when. Each row is one
-- ride OFFER posted by a member. A new crew sub-resource cloning the existing
-- packing-board pattern exactly (046_crew_packing.sql) — additive, no backfill.
--
-- Mirrors the style of 046_crew_packing.sql / 018_crew_polls.sql.

CREATE TABLE IF NOT EXISTS crew_ride_offers (
  id TEXT PRIMARY KEY,
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  driver TEXT,
  seats INTEGER,
  depart_from TEXT,
  depart_at TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- FK index on crew_id (per the _fk_indexes convention) — every listByCrew
-- filters on it, and the ON DELETE CASCADE benefits from it too.
CREATE INDEX IF NOT EXISTS idx_crew_ride_offers_crew_id ON crew_ride_offers (crew_id);
