-- Migration 019: enforce festival_sets.stage_id integrity
-- Tech debt audit 2026-04-07 — item 5
-- festival_stages PK is composite (festival_id, id), so the FK must also be composite.
-- Idempotent: only adds constraints if missing.

BEGIN;

-- Backfill safety: refuse to run if any orphan exists.
DO $$
DECLARE
  null_count INT;
  orphan_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count FROM festival_sets WHERE stage_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce NOT NULL on festival_sets.stage_id: % rows are NULL', null_count;
  END IF;

  SELECT COUNT(*) INTO orphan_count
  FROM festival_sets fs
  LEFT JOIN festival_stages st
    ON st.festival_id = fs.festival_id AND st.id = fs.stage_id
  WHERE fs.stage_id IS NOT NULL AND st.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Cannot add FK festival_sets(festival_id, stage_id) -> festival_stages: % orphan rows', orphan_count;
  END IF;
END $$;

-- NOT NULL (safe re-run: ALTER ... SET NOT NULL is a no-op if already enforced)
ALTER TABLE festival_sets
  ALTER COLUMN stage_id SET NOT NULL;

-- Composite FK (only if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'festival_sets_stage_fkey'
      AND conrelid = 'festival_sets'::regclass
  ) THEN
    ALTER TABLE festival_sets
      ADD CONSTRAINT festival_sets_stage_fkey
      FOREIGN KEY (festival_id, stage_id)
      REFERENCES festival_stages(festival_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Helpful index for the new FK lookup pattern
CREATE INDEX IF NOT EXISTS idx_festival_sets_festival_stage
  ON festival_sets(festival_id, stage_id);

COMMIT;
