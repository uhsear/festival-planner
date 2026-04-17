-- Crew Polls — Phase 2C
CREATE TABLE IF NOT EXISTS crew_polls (
  id TEXT PRIMARY KEY,
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  question TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]',
  closes_at TIMESTAMPTZ,
  closed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crew_poll_votes (
  poll_id TEXT NOT NULL REFERENCES crew_polls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  option_index INTEGER NOT NULL,
  voted_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (poll_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cpv_poll ON crew_poll_votes (poll_id);
CREATE INDEX IF NOT EXISTS idx_cp_crew ON crew_polls (crew_id) WHERE closed = FALSE;

