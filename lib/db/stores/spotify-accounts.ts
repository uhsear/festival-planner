/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Per-user Spotify OAuth account store (M4).
 *
 * Mirrors the third-party-token-store pattern (calendar-tokens.ts) but, unlike
 * calendar tokens, this persists a SECRET — the Spotify *refresh token*. That
 * token is stored ENCRYPTED AT REST (AES-256-GCM) and is NEVER returned to the
 * client and NEVER logged. Access tokens are not persisted at all; they are
 * minted on demand from the refresh token by lib/spotify-oauth.ts.
 *
 * The encryption key is derived (scrypt) from SESSION_SECRET — already required
 * to be a strong random value in production (see server startup validation).
 * If SESSION_SECRET is empty (local dev), a fixed dev key is used so the store
 * still functions; production always has a real secret.
 */
import crypto from 'crypto';
import type { Pool } from 'pg';

const ALGO = 'aes-256-gcm';
// Static salt for key derivation. The secret (SESSION_SECRET) is the entropy;
// a constant salt is acceptable here and keeps the derived key stable across
// restarts so previously-encrypted rows remain decryptable.
const KEY_SALT = 'festie-spotify-refresh-token-v1';

function deriveKey(sessionSecret: string): Buffer {
  const secret = sessionSecret && sessionSecret.length > 0 ? sessionSecret : 'festie-dev-spotify-key';
  return crypto.scryptSync(secret, KEY_SALT, 32);
}

/**
 * Encrypt a refresh token. Output format: base64(iv).base64(authTag).base64(ciphertext).
 * Returns null for empty input.
 */
export function encryptRefreshToken(plaintext: string, sessionSecret: string): string | null {
  if (!plaintext) return null;
  const key = deriveKey(sessionSecret);
  const iv = crypto.randomBytes(12); // 96-bit nonce, recommended for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${authTag.toString('base64')}.${ciphertext.toString('base64')}`;
}

/**
 * Decrypt a stored refresh token. Returns null on any malformed/invalid input
 * (never throws to the caller — a tampered or undecryptable token is treated
 * as "not connected" upstream).
 */
export function decryptRefreshToken(stored: string | null | undefined, sessionSecret: string): string | null {
  if (!stored || typeof stored !== 'string') return null;
  const parts = stored.split('.');
  if (parts.length !== 3) return null;
  try {
    const key = deriveKey(sessionSecret);
    const iv = Buffer.from(parts[0]!, 'base64');
    const authTag = Buffer.from(parts[1]!, 'base64');
    const ciphertext = Buffer.from(parts[2]!, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    return null;
  }
}

export function createSpotifyAccountsStore(pool: Pool, opts: { sessionSecret?: string } = {}) {
  const sessionSecret = opts.sessionSecret || '';

  return {
    /**
     * Upsert a user's Spotify connection. Encrypts the refresh token at rest.
     * Returns the public-safe row (NO refresh token).
     */
    async upsert({
      userId,
      spotifyUserId,
      refreshToken,
      scopes,
    }: {
      userId: string;
      spotifyUserId?: string | null;
      refreshToken: string;
      scopes?: string | null;
    }) {
      const encrypted = encryptRefreshToken(refreshToken, sessionSecret);
      const { rows } = await pool.query(
        `INSERT INTO spotify_accounts (user_id, spotify_user_id, refresh_token_encrypted, scopes, connected_at, updated_at)
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (user_id) DO UPDATE SET
           spotify_user_id = EXCLUDED.spotify_user_id,
           refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
           scopes = EXCLUDED.scopes,
           updated_at = now()
         RETURNING user_id, spotify_user_id, scopes, connected_at, updated_at`,
        [userId, spotifyUserId ?? null, encrypted, scopes ?? null],
      );
      return rows[0] || null;
    },

    /**
     * Update only the encrypted refresh token (Spotify may rotate it on refresh).
     */
    async updateRefreshToken(userId: string, refreshToken: string) {
      const encrypted = encryptRefreshToken(refreshToken, sessionSecret);
      await pool.query(
        `UPDATE spotify_accounts SET refresh_token_encrypted = $2, updated_at = now() WHERE user_id = $1`,
        [userId, encrypted],
      );
    },

    /**
     * Public-safe connection status — NEVER includes the refresh token.
     * Returns null if not connected.
     */
    async getStatus(userId: string) {
      const { rows } = await pool.query(
        `
  SELECT
    user_id,
    spotify_user_id,
    scopes,
    connected_at,
    updated_at
  FROM
    spotify_accounts
  WHERE
    user_id = $1
`,
        [userId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        userId: row.user_id,
        spotifyUserId: row.spotify_user_id,
        scopes: row.scopes,
        connectedAt: row.connected_at,
        updatedAt: row.updated_at,
      };
    },

    async isConnected(userId: string): Promise<boolean> {
      const { rows } = await pool.query(
        `SELECT 1 FROM spotify_accounts WHERE user_id = $1 AND refresh_token_encrypted IS NOT NULL`,
        [userId],
      );
      return rows.length > 0;
    },

    /**
     * INTERNAL ONLY — returns the decrypted refresh token for server-side token
     * minting. Callers must never expose this to the client or log it. Returns
     * null if not connected or the stored token is undecryptable.
     */
    async getDecryptedRefreshToken(userId: string): Promise<string | null> {
      const { rows } = await pool.query(`SELECT refresh_token_encrypted FROM spotify_accounts WHERE user_id = $1`, [
        userId,
      ]);
      if (!rows[0]) return null;
      return decryptRefreshToken(rows[0].refresh_token_encrypted, sessionSecret);
    },

    async disconnect(userId: string) {
      await pool.query('DELETE FROM spotify_accounts WHERE user_id = $1', [userId]);
    },
  };
}

export type SpotifyAccountsStore = ReturnType<typeof createSpotifyAccountsStore>;
