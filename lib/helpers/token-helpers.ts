// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Shared helpers for password-reset and email-verification tokens.
 * Extracted from routes/email-auth.js to reduce duplication and enable
 * reuse from routes/admin-users.js.
 */

/**
 * Insert a new password reset token.
 */
export async function createPasswordResetToken(pool: any, userId: any, tokenHash: any, interval = '1 hour') {
  return pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + $3::INTERVAL)`,
    [userId, tokenHash, interval],
  );
}

/**
 * Invalidate all unused password reset tokens for a user.
 */
export async function invalidatePasswordResetTokens(pool: any, userId: any) {
  return pool.query(
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
}

/**
 * Insert a new email verification token.
 */
export async function createEmailVerificationToken(pool: any, userId: any, tokenHash: any, email: any, ttlHours: any) {
  return pool.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at) VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::INTERVAL)`,
    [userId, tokenHash, email, ttlHours],
  );
}

/**
 * Invalidate all unused email verification tokens for a user.
 */
export async function invalidateEmailVerificationTokens(pool: any, userId: any) {
  return pool.query(
    'UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
}
