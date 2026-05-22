import type { Pool } from 'pg';

export function createEmailTokensStore(pool: Pool) {
  return {
    async findUserByEmail(email: string) {
      const { rows } = await pool.query(
        'SELECT id, username, email FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL',
        [email],
      );
      return rows[0] || null;
    },

    async invalidateResetTokens(userId: string) {
      await pool.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
        [userId],
      );
    },

    async createResetToken(userId: string, tokenHash: string) {
      await pool.query(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')',
        [userId, tokenHash],
      );
    },

    async findVerificationToken(tokenHash: string) {
      const { rows } = await pool.query(
        'SELECT id, user_id, email FROM email_verification_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()',
        [tokenHash],
      );
      return rows[0] || null;
    },

    async markTokenUsed(tokenId: string) {
      await pool.query(
        'UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1',
        [tokenId],
      );
    },

    async updateUserEmail(userId: string, email: string) {
      await pool.query(
        'UPDATE users SET email = $1, email_verified_at = NOW() WHERE id = $2',
        [email, userId],
      );
    },

    async checkEmailExists(email: string, excludeUserId: string) {
      const { rows } = await pool.query(
        'SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL AND id != $2',
        [email, excludeUserId],
      );
      return rows.length > 0;
    },

    async setEmailUnverified(userId: string, email: string) {
      await pool.query(
        'UPDATE users SET email = $1, email_verified_at = NULL WHERE id = $2',
        [email, userId],
      );
    },

    async createVerificationToken(userId: string, tokenHash: string, email: string, ttlHours: any) {
      await pool.query(
        'INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at) VALUES ($1, $2, $3, NOW() + ($4 || \' hours\')::INTERVAL)',
        [userId, tokenHash, email, ttlHours],
      );
    },

    async invalidateVerificationTokens(userId: string) {
      await pool.query(
        'UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
        [userId],
      );
    },

    async consumeResetToken(tokenHash: string) {
      const { rows } = await pool.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING user_id',
        [tokenHash],
      );
      return rows[0] || null;
    },
  };
}
