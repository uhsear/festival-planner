-- P3.12: Soft delete audit trail — track who deleted and why
-- Adds deleted_by and deletion_reason columns to soft-deletable tables

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

ALTER TABLE festival_profiles ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE festival_profiles ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

ALTER TABLE festivals ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS deletion_reason TEXT;
