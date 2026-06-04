-- 049: Spotify user-OAuth accounts (M4).
--
-- Per-user third-party token store for the Spotify Authorization-Code + PKCE
-- flow. Mirrors the encryption-at-rest pattern: the REFRESH token is stored
-- AES-256-GCM encrypted (see lib/db/stores/spotify-accounts.ts) and is NEVER
-- returned to the client or logged. Access tokens are never persisted — they
-- are minted on demand from the refresh token.
--
-- One row per user (PRIMARY KEY on user_id) — connecting again simply upserts.
-- ON DELETE CASCADE: deleting a user removes their Spotify link automatically.
-- Additive; mirrors the style of 042_payment_handles.sql / 048_reengagement_prefs.sql.
CREATE TABLE IF NOT EXISTS spotify_accounts (
  user_id                 TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  spotify_user_id         TEXT,
  refresh_token_encrypted TEXT,
  scopes                  TEXT,
  connected_at            TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

-- FK index: keeps user-delete CASCADE cleanup and lookups by user fast.
CREATE INDEX IF NOT EXISTS idx_spotify_accounts_user_id ON spotify_accounts (user_id);
