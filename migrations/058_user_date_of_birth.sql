-- Date of birth, collected at registration for the 18+ age gate and stored per
-- the privacy policy. Additive + idempotent (nullable for pre-existing rows).
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
