/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Email-Related Auth Routes (split from auth.js for maintainability)
 * POST /forgot-password   - Request password reset email
 * GET  /verify-email      - Verify email address via token link
 * POST /update-email      - Update email address (authenticated)
 * POST /resend-verification - Resend email verification (authenticated)
 * POST /reset-password    - Reset password via emailed token
 * GET  /reset-password    - Render password reset form page
 *
 * AUDIT FIX (2026-04-14, DEFERRED FIX AGENT 1):
 *   Added per-email password-reset limiter (`passwordResetRateLimit`) to
 *   `/forgot-password` and `/reset-password`. The old IP-keyed `rateLimit()`
 *   middleware is preserved alongside it for defense-in-depth (IP + email
 *   tiers). Legacy inline `_forgotPwLimits` map is left intact — the new
 *   factory is a stricter outer gate, not a replacement, and the inline map
 *   continues to silently cap per-email attempts without revealing rate
 *   limiting (to block enumeration).
 */
const { createPasswordResetRateLimit } = require('../lib/rate-limiting');

module.exports = function createEmailAuthRoutes(deps) {
  const {
    express, config, log,
    hashPassword, verifyPassword, validatePasswordStrength,
    invalidateUserSessions, disconnectUserSockets,
    userAuth, getUserById,
    sendSuccess, sendError, ErrorCodes, rateLimit,
    schemas, validate,
    stores, invalidateUserCache,
    pool, state, createAuditLog, getRequestIp,
    // eslint-disable-next-line no-unused-vars
    createOpaqueId, _hashSessionToken, io,
  } = deps;

  const { sendPasswordResetEmail, sendVerificationEmail } = require('../lib/email');
  const { _renderResetFormPage, _renderResetErrorPage } = require('../lib/reset-pages');
  const crypto = require('crypto');

  // Per-email password-reset limiter (3/hour per normalized email) applied to
  // both /forgot-password and /reset-password. Factory-constructed once per
  // router so buckets persist across requests inside a worker process.
  const passwordResetRateLimit = createPasswordResetRateLimit(config, {
    log,
    sendError,
    ErrorCodes,
  });

  // Per-email rate limiting for forgot-password (3 requests per 60 seconds)
  const _forgotPwLimits = new Map();
  const FORGOT_PW_WINDOW = 60_000;
  const FORGOT_PW_MAX = 3;

  // Per-email rate limiting for resend-verification (3 requests per 5 minutes)
  const _resendVerifyLimits = new Map();
  const RESEND_VERIFY_WINDOW = 5 * 60_000;
  const RESEND_VERIFY_MAX = 3;

  const router = express.Router();

  // ── POST /forgot-password — request password reset email ─────────────
  router.post('/forgot-password', rateLimit(3, 'forgot-password'), passwordResetRateLimit, validate(schemas.forgotPassword), async (req, res) => {
    try {
      const { email } = req.validatedBody;
      const cleanEmail = String(email).trim().toLowerCase();

      // Always return success to prevent email enumeration
      const successMsg = 'If an account with that email exists, a reset link has been sent';

      // Check per-email rate limit (3 requests per 60 seconds)
      const now = Date.now();
      const emailKey = cleanEmail.toLowerCase();
      const entry = _forgotPwLimits.get(emailKey);
      if (entry && now - entry.resetAt < FORGOT_PW_WINDOW && entry.count >= FORGOT_PW_MAX) {
        // Still return 200 to not reveal rate limiting
        return sendSuccess(res, { message: successMsg });
      }
      if (!entry || now - entry.resetAt >= FORGOT_PW_WINDOW) {
        _forgotPwLimits.set(emailKey, { count: 1, resetAt: now });
      } else {
        entry.count += 1;
      }

      const result = await stores.pool.query(
        'SELECT id, username, email FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL',
        [cleanEmail],
      );

      if (result.rows.length === 0) {
        // Timing-safe: add small delay to match the email-send path
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
        return sendSuccess(res, { message: successMsg });
      }

      const user = result.rows[0];

      // Invalidate any existing reset tokens for this user
      await stores.pool.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
        [user.id],
      );

      // Generate new reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      await stores.pool.query(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')',
        [user.id, tokenHash],
      );

      const resetUrl = `${config.PUBLIC_ORIGIN}/reset-password?token=${resetToken}`;
      const sent = await sendPasswordResetEmail({ to: cleanEmail, username: user.username, resetUrl, config, log });
      if (!sent) {
        log.error('forgot-password:email-failed', { userId: user.id });
      }

      log.info('forgot-password:requested', { userId: user.id, email: cleanEmail });
      return sendSuccess(res, { message: successMsg });
    } catch (error) {
      log.error('forgot-password failed', { error: error.message });
      return sendError(res, 500, 'Failed to process request', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /verify-email — verify email address via token link ──────────
  router.get('/verify-email', rateLimit(10, 'verify-email'), async (req, res) => {
    try {
      const token = String(req.query.token || '').trim();
      if (!token || !/^[a-f0-9]{64}$/.test(token)) {
        return res.status(400).send(_verifyEmailPage('Invalid verification link.', false));
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const result = await stores.pool.query(
        'SELECT id, user_id, email FROM email_verification_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()',
        [tokenHash],
      );

      if (result.rows.length === 0) {
        return res.status(400).send(_verifyEmailPage('This verification link has expired or already been used.', false));
      }

      const { id: tokenId, user_id: userId, email: verifiedEmail } = result.rows[0];

      // Mark token as used and update user email_verified_at
      await stores.pool.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1', [tokenId]);
      await stores.pool.query(
        'UPDATE users SET email = $1, email_verified_at = NOW() WHERE id = $2',
        [verifiedEmail, userId],
      );
      invalidateUserCache();

      log.info('email:verified', { userId, email: verifiedEmail });
      return res.send(_verifyEmailPage('Your email has been verified! You can close this page.', true));
    } catch (error) {
      log.error('verify-email failed', { error: error.message });
      return res.status(500).send(_verifyEmailPage('Something went wrong. Please try again.', false));
    }
  });

  // ── POST /update-email — change email address (authenticated) ────────
  router.post('/update-email', userAuth, rateLimit(3, 'update-email'), validate(schemas.updateEmail), async (req, res) => {
    try {
      const { email, password: confirmPassword } = req.validatedBody;
      const cleanEmail = String(email).trim().toLowerCase();

      // Verify password
      const user = await getUserById(req.user.userId);
      if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      if (!await verifyPassword(confirmPassword, user.passwordHash)) {
        return sendError(res, 400, 'Incorrect password', ErrorCodes.PASSWORD_INCORRECT);
      }

      // Check email uniqueness
      const exists = await stores.pool.query(
        'SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL AND id != $2',
        [cleanEmail, req.user.userId],
      );
      if (exists.rows.length > 0) {
        return sendError(res, 400, 'Email address already in use', ErrorCodes.ALREADY_EXISTS);
      }

      // Update email (unverified until confirmed)
      await stores.pool.query(
        'UPDATE users SET email = $1, email_verified_at = NULL WHERE id = $2',
        [cleanEmail, req.user.userId],
      );
      invalidateUserCache();

      // Send verification email
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
      await stores.pool.query(
        'INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at) VALUES ($1, $2, $3, NOW() + ($4 || \' hours\')::INTERVAL)',
        [req.user.userId, tokenHash, cleanEmail, config.EMAIL_VERIFY_TOKEN_TTL_HOURS],
      );
      const verifyUrl = `${config.PUBLIC_ORIGIN}/api/v1/auth/verify-email?token=${verifyToken}`;
      await sendVerificationEmail({ to: cleanEmail, username: user.username, verifyUrl, config, log });

      log.info('email:updated', { userId: req.user.userId, email: cleanEmail });
      return sendSuccess(res, { message: 'Verification email sent to your new address', email: cleanEmail });
    } catch (error) {
      log.error('update-email failed', { error: error.message });
      return sendError(res, 500, 'Failed to update email', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /resend-verification — resend email verification (authenticated) ──
  router.post('/resend-verification', userAuth, rateLimit(2, 'resend-verify'), async (req, res) => {
    try {
      const user = await getUserById(req.user.userId);
      if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      if (!user.email) return sendError(res, 400, 'No email address on file', ErrorCodes.INVALID_INPUT);
      if (user.emailVerifiedAt) return sendError(res, 400, 'Email already verified', ErrorCodes.INVALID_INPUT);

      // Per-email rate limiting (separate from global endpoint limit)
      const emailKey = user.email.toLowerCase();
      const now = Date.now();
      const attempts = _resendVerifyLimits.get(emailKey) || [];
      const recentAttempts = attempts.filter((t) => now - t < RESEND_VERIFY_WINDOW);
      if (recentAttempts.length >= RESEND_VERIFY_MAX) {
        return sendError(res, 429, `Too many verification emails sent to this address. Try again in ${Math.ceil((recentAttempts[0] + RESEND_VERIFY_WINDOW - now) / 1000)}s`, ErrorCodes.RATE_LIMITED);
      }
      recentAttempts.push(now);
      if (_resendVerifyLimits.size >= 10_000) {
        // Evict oldest entry to prevent unbounded growth under enumeration
        _resendVerifyLimits.delete(_resendVerifyLimits.keys().next().value);
      }
      _resendVerifyLimits.set(emailKey, [...recentAttempts, now]);

      // Invalidate old tokens
      await stores.pool.query(
        'UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
        [req.user.userId],
      );

      const verifyToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
      await stores.pool.query(
        'INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at) VALUES ($1, $2, $3, NOW() + ($4 || \' hours\')::INTERVAL)',
        [req.user.userId, tokenHash, user.email, config.EMAIL_VERIFY_TOKEN_TTL_HOURS],
      );
      const verifyUrl = `${config.PUBLIC_ORIGIN}/api/v1/auth/verify-email?token=${verifyToken}`;
      await sendVerificationEmail({ to: user.email, username: user.username, verifyUrl, config, log });

      return sendSuccess(res, { message: 'Verification email sent' });
    } catch (error) {
      log.error('resend-verification failed', { error: error.message });
      return sendError(res, 500, 'Failed to resend verification', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Cleanup interval for stale forgot-password rate limit entries (every 60 seconds)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [emailKey, entry] of _forgotPwLimits.entries()) {
      if (now - entry.resetAt >= FORGOT_PW_WINDOW) {
        _forgotPwLimits.delete(emailKey);
      }
    }
    // Prune expired resend-verification entries (no separate timer needed)
    for (const [emailKey, timestamps] of _resendVerifyLimits.entries()) {
      const active = timestamps.filter((t) => now - t < RESEND_VERIFY_WINDOW);
      if (active.length === 0) {
        _resendVerifyLimits.delete(emailKey);
      } else {
        _resendVerifyLimits.set(emailKey, active);
      }
    }
  }, FORGOT_PW_WINDOW);

  if (deps.state?.timers) {
    deps.state.timers.push(cleanupInterval);
  }

  // POST /reset-password — Validate token and reset password (public, no auth)
  router.post('/reset-password', rateLimit(5, 'reset-password'), passwordResetRateLimit, validate(schemas.resetPasswordPublic), async (req, res) => {
    try {
      const { token, newPassword, confirmPassword } = req.validatedBody;
      if (newPassword !== confirmPassword) {
        return sendError(res, 400, 'Passwords do not match', ErrorCodes.INVALID_INPUT);
      }
      if (!validatePasswordStrength(newPassword)) {
        return sendError(res, 400, 'Password must be 8-100 characters', ErrorCodes.INVALID_INPUT);
      }

      // Validate reset token — check in-memory first, then DB
      let targetUserId = null;
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      if (state._adminResetTokens?.has(token)) {
        const tokenData = state._adminResetTokens.get(token);
        if (Date.now() > tokenData.expiresAt) {
          state._adminResetTokens.delete(token);
          return sendError(res, 400, 'Reset link has expired', ErrorCodes.INVALID_INPUT);
        }
        targetUserId = tokenData.userId;
      }
      // admin_sessions table dropped (migration 013) — cross-worker lookup removed

      // Fallback: check self-service password_reset_tokens table
      // Atomic UPDATE...RETURNING prevents TOCTOU race between concurrent requests
      if (!targetUserId) {
        const selfResult = await pool.query(
          'UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING user_id',
          [tokenHash],
        );
        if (selfResult.rows.length > 0) {
          targetUserId = selfResult.rows[0].user_id;
        }
      }

      if (!targetUserId) {
        return sendError(res, 400, 'Invalid or expired reset link', ErrorCodes.INVALID_INPUT);
      }
      const user = await getUserById(targetUserId);
      if (!user) {
        state._adminResetTokens.delete(token);
        return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      }

      // Update password and invalidate all sessions
      await stores.users.update(targetUserId, { passwordHash: await hashPassword(newPassword) });
      invalidateUserCache();
      await invalidateUserSessions(targetUserId);
      disconnectUserSockets(targetUserId, io);

      // Invalidate the reset token (both in-memory and DB)
      state._adminResetTokens.delete(token);
      // admin_sessions cleanup removed (migration 013)

      const auditLog = createAuditLog('user_reset_password', 'user', {
        userId: targetUserId,
        username: user.username,
        ipAddress: getRequestIp(req),
      });
      log.warn('user:reset-password', { ...auditLog });

      return sendSuccess(res, { success: true, message: 'Password reset successfully' });
    } catch (error) {
      log.error('reset-password failed', { error: error.message });
      return sendError(res, 500, 'Failed to reset password', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
};

// ── Email verification result page ──────────────────────────────────────
function _verifyEmailPage(message, success) {
  const icon = success ? '&#10003;' : '&#10007;';
  const color = success ? '#22c55e' : '#ef4444';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email Verification - Festie</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh">
<div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:48px;text-align:center;max-width:400px">
  <div style="font-size:48px;color:${color};margin-bottom:16px">${icon}</div>
  <h1 style="color:#e4e4e7;font-size:20px;margin:0 0 12px">Festie</h1>
  <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0">${message}</p>
</div>
</body>
</html>`;
}
