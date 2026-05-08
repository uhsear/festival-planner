// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

/**
 * Shared helpers for password-reset and email-verification tokens.
 * Extracted from routes/email-auth.js to reduce duplication and enable
 * reuse from routes/admin-users.js.
 */

/**
 * Insert a new password reset token.
 * @param {import('pg').Pool} pool
 * @param {string} userId
 * @param {string} tokenHash - SHA-256 hex digest of the raw token
 * @param {string} [interval='1 hour'] - PostgreSQL interval for expiry
 * @returns {Promise<import('pg').QueryResult>}
 */
async function createPasswordResetToken(pool, userId, tokenHash, interval = '1 hour') {
  return pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + $3::INTERVAL)`,
    [userId, tokenHash, interval],
  );
}

/**
 * Invalidate all unused password reset tokens for a user.
 * @param {import('pg').Pool} pool
 * @param {string} userId
 * @returns {Promise<import('pg').QueryResult>}
 */
async function invalidatePasswordResetTokens(pool, userId) {
  return pool.query(
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
}

/**
 * Insert a new email verification token.
 * @param {import('pg').Pool} pool
 * @param {string} userId
 * @param {string} tokenHash - SHA-256 hex digest of the raw token
 * @param {string} email - The email address being verified
 * @param {number} ttlHours - Token TTL in hours
 * @returns {Promise<import('pg').QueryResult>}
 */
async function createEmailVerificationToken(pool, userId, tokenHash, email, ttlHours) {
  return pool.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at) VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::INTERVAL)`,
    [userId, tokenHash, email, ttlHours],
  );
}

/**
 * Invalidate all unused email verification tokens for a user.
 * @param {import('pg').Pool} pool
 * @param {string} userId
 * @returns {Promise<import('pg').QueryResult>}
 */
async function invalidateEmailVerificationTokens(pool, userId) {
  return pool.query(
    'UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
}

module.exports = {
  createPasswordResetToken,
  invalidatePasswordResetTokens,
  createEmailVerificationToken,
  invalidateEmailVerificationTokens,
};
