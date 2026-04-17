-- Install funnel analytics
-- Captures PWA install events across platforms for conversion measurement
CREATE TABLE IF NOT EXISTS install_events (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android','desktop')),
  event TEXT NOT NULL CHECK (event IN ('shown','accepted','dismissed','native_fired','inapp_blocked')),
  reason TEXT,
  engagement_ms INTEGER,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_install_events_created_at ON install_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_install_events_platform_event ON install_events (platform, event);
