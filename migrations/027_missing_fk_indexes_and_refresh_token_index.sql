-- 027_missing_fk_indexes_and_refresh_token_index.sql
-- Date: 2026-04-14
-- Adds indexes for 3 un-indexed FK columns (audit-flagged) + a lookup index for refresh_tokens.
-- All statements are IF NOT EXISTS / guarded — safe to re-run.

BEGIN;

-- FK columns missing indexes (slow DELETE cascade + missed read optimization)
CREATE INDEX IF NOT EXISTS idx_crew_meeting_points_created_by
  ON crew_meeting_points (created_by);

CREATE INDEX IF NOT EXISTS idx_crew_polls_created_by
  ON crew_polls (created_by);

CREATE INDEX IF NOT EXISTS idx_crew_activity_user_id
  ON crew_activity (user_id);

-- refresh_tokens shows 1440:1 seq_scan:idx_scan ratio on 162 rows — lookup column likely missing coverage.
-- Check which column is the query target; token_hash is a common pattern for SHA-256 hashed refresh tokens.
-- If column name differs, adjust. We conditionally create the index only if the column exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='refresh_tokens' AND column_name='token_hash') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens (token_hash)';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name='refresh_tokens' AND column_name='token') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens (token)';
  END IF;
END $$;


COMMIT;
