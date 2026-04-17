-- 012: Add crew home base columns for meeting point coordination
ALTER TABLE crews ADD COLUMN IF NOT EXISTS home_base_location TEXT DEFAULT NULL;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS home_base_time TEXT DEFAULT NULL;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS home_base_updated_at TIMESTAMPTZ DEFAULT NULL;
