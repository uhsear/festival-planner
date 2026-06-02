-- 041: Editable display name for users.
--
-- Username remains the immutable, unique @handle (CITEXT). display_name is an
-- optional, user-editable friendly name. When NULL, clients fall back to the
-- username (the UI already does `name || username`), so no backfill is needed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
