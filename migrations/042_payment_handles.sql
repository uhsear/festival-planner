-- 042: Payment handles for settle-up deep links.
--
-- Optional, user-editable payment identifiers used to build prefilled
-- Venmo/Cash App/PayPal links when settling a crew debt. All nullable with no
-- backfill — a user without a handle simply gets no pay-link for that provider.
-- Additive, mirrors the style of 041_user_display_name.sql / 022_festivals_geo.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS venmo_handle     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cashapp_cashtag  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paypal_handle    TEXT;
