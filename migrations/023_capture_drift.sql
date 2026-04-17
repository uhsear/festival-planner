-- 023_capture_drift.sql
-- Capture schema drift discovered by pg_dump diff between production
-- and a fresh DB built from migrations 001-022. Each block is idempotent
-- so it can be re-applied safely.

-- set_ratings: user's 1-5 rating + note for a performance set.
-- Table existed in prod (added out-of-band for Phase 3 ratings/wrap feature)
-- but was never captured as a migration.
CREATE TABLE IF NOT EXISTS set_ratings (
  id         uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  set_id     text NOT NULL REFERENCES festival_sets(id) ON DELETE CASCADE,
  rating     smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  note       text DEFAULT '',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (user_id, set_id)
);
CREATE INDEX IF NOT EXISTS idx_set_ratings_set  ON set_ratings(set_id);
CREATE INDEX IF NOT EXISTS idx_set_ratings_user ON set_ratings(user_id);

-- refresh_tokens: prod has three _ts mirror columns from an in-flight
-- timestamp migration that was never cleaned up. Keep them so fresh
-- CI DBs match prod shape.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS expires_at_ts timestamptz;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS created_at_ts timestamptz;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS rotated_at_ts timestamptz;

-- Prod dropped NOT NULL on these columns out-of-band. Match prod state
-- so inserts with undefined values don't break in CI but work in prod.
-- If this turns out to be incorrect, revisit by backfilling and re-adding NOT NULL.
-- festival_sets.artists and festivals.b2b_separator were originally created by
-- retired migration 014. Add them defensively here so fresh DBs (CI) don't fail
-- on the ALTER COLUMN below; idempotent on prod where both columns already exist.
ALTER TABLE festival_sets ADD COLUMN IF NOT EXISTS artists       jsonb DEFAULT '[]'::jsonb;
ALTER TABLE festivals     ADD COLUMN IF NOT EXISTS b2b_separator text  DEFAULT 'b2b';
ALTER TABLE festival_sets ALTER COLUMN artists       DROP NOT NULL;
ALTER TABLE festivals     ALTER COLUMN b2b_separator DROP NOT NULL;

-- Prod simplified idx_festival_profiles_user_festival predicate
-- (the user_id IS NOT NULL clause was redundant because the column is NOT NULL).
DROP INDEX IF EXISTS idx_festival_profiles_user_festival;
CREATE UNIQUE INDEX IF NOT EXISTS idx_festival_profiles_user_festival
  ON festival_profiles (user_id, festival_id)
  WHERE deleted_at IS NULL;
