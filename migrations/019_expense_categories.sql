-- Add category column to crew_expenses for spend categorization
-- Table is created in 020_phase3_features.sql; guard against ordering
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'crew_expenses') THEN
    ALTER TABLE crew_expenses ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT 'other';
    CREATE INDEX IF NOT EXISTS idx_crew_expenses_category ON crew_expenses(crew_id, category);
  END IF;
END $$;
