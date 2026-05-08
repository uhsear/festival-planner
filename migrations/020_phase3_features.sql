-- Migration 018: Phase 3 features — crew expenses, crew activity
-- Run on both prod and test databases

CREATE TABLE IF NOT EXISTS crew_expenses (
  id TEXT PRIMARY KEY,
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  paid_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  split_with JSONB DEFAULT '[]',
  category VARCHAR(20) DEFAULT 'other',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_expenses_crew ON crew_expenses(crew_id);
CREATE INDEX IF NOT EXISTS idx_crew_expenses_paid ON crew_expenses(paid_by);

CREATE TABLE IF NOT EXISTS crew_activity (
  id TEXT PRIMARY KEY,
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_activity_crew ON crew_activity(crew_id, created_at DESC);

-- Calendar sync tokens for ICS Smart Sync
CREATE TABLE IF NOT EXISTS calendar_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, festival_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_tokens_user ON calendar_tokens(user_id);
