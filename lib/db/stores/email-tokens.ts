import type { Pool } from 'pg';

import { withTransaction } from '../connection';

// A pending *change* token is one whose target address is not the address
// already on the account; a signup/resend token carries the address on file.
// `email_verification_tokens` has no `purpose` column, so that comparison is
// the purpose distinction — it lets us supersede change tokens without
// silently killing an unclicked signup token.
const SUPERSEDE_PENDING_CHANGES = `UPDATE email_verification_tokens SET used_at = NOW()
    WHERE user_id = $1 AND used_at IS NULL AND LOWER(email) IS DISTINCT FROM LOWER($2)`;

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

    /**
     * Claim a verification token. The single `UPDATE ... RETURNING` is the
     * whole operation, so exactly one caller can win: the previous
     * find-then-mark pair let two concurrent clicks both pass the find and
     * promote the address twice. Same shape as `consumeResetToken` below.
     * Returns the claimed row, or null when the token is unknown, already
     * used or expired.
     */
    async consumeVerificationToken(tokenHash: string) {
      const { rows } = await pool.query(
        'UPDATE email_verification_tokens SET used_at = NOW() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING id, user_id, email',
        [tokenHash],
      );
      return rows[0] || null;
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

    /**
     * Supersede this user's pending email-*change* tokens and issue a new one,
     * atomically. Two things are load-bearing:
     *   - the `FOR UPDATE` on the users row. A bare transaction is not enough:
     *     under READ COMMITTED the second transaction's UPDATE cannot see the
     *     first's uncommitted INSERT, so two concurrent requests both left a
     *     live token for different addresses. The row lock serialises them.
     *   - `keepEmail` (the address currently on the account) is excluded, so an
     *     unclicked signup/resend token is not collateral damage.
     */
    async replaceVerificationToken(
      userId: string,
      tokenHash: string,
      email: string,
      ttlHours: any,
      keepEmail: string | null,
    ) {
      await withTransaction(pool, async (client) => {
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        await client.query(SUPERSEDE_PENDING_CHANGES, [userId, keepEmail]);
        await client.query(
          'INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at) VALUES ($1, $2, $3, NOW() + ($4 || \' hours\')::INTERVAL)',
          [userId, tokenHash, email, ttlHours],
        );
      });
    },

    /**
     * Kill pending email-change tokens without issuing a replacement. Called
     * from every password rotation: the security notice tells the owner to
     * change their password, so that action must actually revoke the attacker's
     * pending link. `keepEmail` spares a pending signup/resend token.
     */
    async invalidatePendingEmailChanges(userId: string, keepEmail: string | null) {
      await pool.query(SUPERSEDE_PENDING_CHANGES, [userId, keepEmail]);
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
