-- Add category column to crew_expenses for spend categorization
ALTER TABLE crew_expenses ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT 'other';

-- Index for filtering by category
CREATE INDEX IF NOT EXISTS idx_crew_expenses_category ON crew_expenses(crew_id, category);
