-- Migration 018: Reminder scheduler performance index (Phase 1A)
-- Fast lookup for profiles with active reminders in a given festival

CREATE INDEX IF NOT EXISTS idx_fp_reminders_not_null
  ON festival_profiles (festival_id)
  WHERE reminders_json IS NOT NULL
    AND reminders_json != '{}'::jsonb
    AND deleted_at IS NULL;
