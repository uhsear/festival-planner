-- Migration 017: Crew meeting points (Phase 1B)
-- Multiple typed meeting points per crew, replacing single home_base

CREATE TABLE IF NOT EXISTS crew_meeting_points (
  id TEXT PRIMARY KEY,
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  location TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'during',
  meet_at TIMESTAMPTZ,
  stage_reference TEXT,
  expires_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmp_crew ON crew_meeting_points (crew_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_cmp_expires ON crew_meeting_points (expires_at) WHERE active = TRUE AND expires_at IS NOT NULL;

-- Backfill existing home base data into meeting points
INSERT INTO crew_meeting_points (id, crew_id, created_by, label, location, type, active, created_at, updated_at)
SELECT
  'mp_' || c.id,
  c.id,
  c.created_by,
  'Home Base',
  c.home_base_location,
  'general',
  TRUE,
  COALESCE(c.home_base_updated_at, NOW()),
  COALESCE(c.home_base_updated_at, NOW())
FROM crews c
WHERE c.home_base_location IS NOT NULL
  AND c.home_base_location != ''
  AND NOT EXISTS (SELECT 1 FROM crew_meeting_points WHERE id = 'mp_' || c.id);
