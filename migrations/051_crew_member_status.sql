-- 051_crew_member_status.sql
-- M5: last-synced "on my way / ETA to [meeting point]" per crew member.
--
-- IMPORTANT — this is NOT live GPS. A row here is a degraded-sync snapshot the
-- member set (often offline) and that delivered on the next signal blip. The UI
-- renders it with honest staleness ("as of N ago"), never "live". One row per
-- (crew, user): the latest status replaces the prior one (offline toggles
-- collapse on a deterministic clientId before they ever reach here).
--
-- target_meeting_point_id is a free TEXT reference (NOT a hard FK) to a
-- crew_meeting_points row: the point may be deactivated/removed independently
-- and a dangling reference simply renders without an ETA target. Additive +
-- idempotent per the repo migration convention.

CREATE TABLE IF NOT EXISTS crew_member_status (
  crew_id                 TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id                 TEXT NOT NULL,
  status                  TEXT,
  target_meeting_point_id TEXT,
  eta_minutes             INTEGER,
  note                    TEXT,
  updated_at              TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (crew_id, user_id)
);

-- FK index per the repo _fk_indexes convention (PRIMARY KEY already covers
-- crew_id-leading lookups, but an explicit FK index keeps ON DELETE CASCADE
-- and crew-scoped scans fast and matches the convention used elsewhere).
CREATE INDEX IF NOT EXISTS crew_member_status_crew_id_fk_idx ON crew_member_status (crew_id);
