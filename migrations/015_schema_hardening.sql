-- 015: Schema hardening — NOT NULL constraints + refresh_tokens type standardization
-- Safe: verified 0 NULL rows in festival_profiles.user_id, audit_log.created_at already has DEFAULT NOW()
-- Idempotent: all operations guarded with IF NOT EXISTS / DO blocks

-- festival_profiles.user_id: should never be NULL (FK to users, 0 nulls in prod)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'festival_profiles' AND column_name = 'user_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE festival_profiles ALTER COLUMN user_id SET NOT NULL;
  END IF;
END $$;

-- audit_log.created_at: already has DEFAULT now() but allows NULL
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'created_at' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE audit_log ALTER COLUMN created_at SET NOT NULL;
  END IF;
END $$;

-- refresh_tokens: convert BIGINT epoch-ms columns to TIMESTAMPTZ
-- Only run the rename-and-swap if expires_at is still BIGINT
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refresh_tokens' AND column_name = 'expires_at' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS expires_at_ts TIMESTAMPTZ;
    UPDATE refresh_tokens SET expires_at_ts = to_timestamp(expires_at / 1000.0) WHERE expires_at IS NOT NULL AND expires_at_ts IS NULL;
    ALTER TABLE refresh_tokens RENAME COLUMN expires_at TO expires_at_epoch;
    ALTER TABLE refresh_tokens RENAME COLUMN expires_at_ts TO expires_at;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refresh_tokens' AND column_name = 'created_at' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS created_at_ts TIMESTAMPTZ;
    UPDATE refresh_tokens SET created_at_ts = to_timestamp(created_at / 1000.0) WHERE created_at IS NOT NULL AND created_at_ts IS NULL;
    ALTER TABLE refresh_tokens RENAME COLUMN created_at TO created_at_epoch;
    ALTER TABLE refresh_tokens RENAME COLUMN created_at_ts TO created_at;
  END IF;
END $$;

ALTER TABLE refresh_tokens ALTER COLUMN created_at SET DEFAULT NOW();

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refresh_tokens' AND column_name = 'rotated_at' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS rotated_at_ts TIMESTAMPTZ;
    UPDATE refresh_tokens SET rotated_at_ts = to_timestamp(rotated_at / 1000.0) WHERE rotated_at IS NOT NULL AND rotated_at_ts IS NULL;
    ALTER TABLE refresh_tokens RENAME COLUMN rotated_at TO rotated_at_epoch;
    ALTER TABLE refresh_tokens RENAME COLUMN rotated_at_ts TO rotated_at;
  END IF;
END $$;

-- Rebuild the expires_at lookup index on the new column
DROP INDEX IF EXISTS idx_refresh_tokens_expires;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens (expires_at);

-- Drop NOT NULL from old epoch columns so new INSERTs don't fail
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'refresh_tokens' AND column_name = 'expires_at_epoch') THEN
    ALTER TABLE refresh_tokens ALTER COLUMN expires_at_epoch DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'refresh_tokens' AND column_name = 'created_at_epoch') THEN
    ALTER TABLE refresh_tokens ALTER COLUMN created_at_epoch DROP NOT NULL;
  END IF;
END $$;
-- rotated_at was already nullable (only set on rotation)

-- Old epoch columns kept for rollback safety: expires_at_epoch, created_at_epoch, rotated_at_epoch
-- Drop them in migration 016 after verification.
