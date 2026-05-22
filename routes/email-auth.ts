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

import crypto from 'crypto';
import type { Router } from 'express';
import { createPasswordResetRateLimit } from '../lib/rate-limiting';
import { sendPasswordResetEmail, sendVerificationEmail } from '../lib/email';
import { renderResetFormPage, renderResetErrorPage } from '../lib/reset-pages';
import { escapeHtml } from '../lib/helpers/sanitize';

export default function createEmailAuthRoutes(deps: any): Router {
  const {
    express, config, log,
    hashPassword, verifyPassword, validatePasswordStrength,
    invalidateUserSessions, disconnectUserSockets,
    userAuth, getUserById,
    sendSuccess, sendError, ErrorCodes, rateLimit,
    schemas, validate,
    stores, invalidateUserCache,
    state, createAuditLog, getRequestIp,
    io,
  } = deps;

  // Per-email password-reset limiter (3/hour per normalized email) applied to
  // both /forgot-password and /reset-password. Factory-constructed once per
  // router so buckets persist across requests inside a worker process.
  const passwordResetRateLimit = createPasswordResetRateLimit(config, {
    log,
    sendError,
    ErrorCodes,
    redis: deps.redis,
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
  router.post('/forgot-password', rateLimit(3, 'forgot-password'), passwordResetRateLimit, validate(schemas.forgotPassword), async (req: any, res: any) => {
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

      const user = await stores.emailTokens.findUserByEmail(cleanEmail);

      if (!user) {
        // Timing-safe: add small delay to match the email-send path
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
        return sendSuccess(res, { message: successMsg });
      }

      // Invalidate any existing reset tokens for this user
      await stores.emailTokens.invalidateResetTokens(user.id);

      // Generate new reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      await stores.emailTokens.createResetToken(user.id, tokenHash);

      const resetUrl = `${config.PUBLIC_ORIGIN}/reset-password?token=${resetToken}`;
      const sent = await sendPasswordResetEmail({ to: cleanEmail, username: user.username, resetUrl, config, log });
      if (!sent) {
        log.error('forgot-password:email-failed', { userId: user.id });
      }

      log.info('forgot-password:requested', { userId: user.id, email: cleanEmail });
      return sendSuccess(res, { message: successMsg });
    } catch (error: any) {
      log.error('forgot-password failed', { error: error.message });
      return sendError(res, 500, 'Failed to process request', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /verify-email — verify email address via token link ──────────
  router.get('/verify-email', rateLimit(10, 'verify-email'), async (req: any, res: any) => {
    try {
      const token = String(req.query.token || '').trim();
      if (!token || !/^[a-f0-9]{64}$/.test(token)) {
        return res.status(400).send(_verifyEmailPage('Invalid verification link.', false));
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const tokenRow = await stores.emailTokens.findVerificationToken(tokenHash);

      if (!tokenRow) {
        return res.status(400).send(_verifyEmailPage('This verification link has expired or already been used.', false));
      }

      const { id: tokenId, user_id: userId, email: verifiedEmail } = tokenRow;

      // Mark token as used and update user email_verified_at
      await stores.emailTokens.markTokenUsed(tokenId);
      await stores.emailTokens.updateUserEmail(userId, verifiedEmail);
      invalidateUserCache();

      log.info('email:verified', { userId, email: verifiedEmail });
      return res.send(_verifyEmailPage('Your email has been verified! You can close this page.', true));
    } catch (error: any) {
      log.error('verify-email failed', { error: error.message });
      return res.status(500).send(_verifyEmailPage('Something went wrong. Please try again.', false));
    }
  });

  // ── POST /update-email — change email address (authenticated) ────────
  router.post('/update-email', userAuth, rateLimit(3, 'update-email'), validate(schemas.updateEmail), async (req: any, res: any) => {
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
      const emailTaken = await stores.emailTokens.checkEmailExists(cleanEmail, req.user.userId);
      if (emailTaken) {
        return sendError(res, 400, 'Email address already in use', ErrorCodes.ALREADY_EXISTS);
      }

      // Update email (unverified until confirmed)
      await stores.emailTokens.setEmailUnverified(req.user.userId, cleanEmail);
      invalidateUserCache();

      // Send verification email
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
      await stores.emailTokens.createVerificationToken(req.user.userId, tokenHash, cleanEmail, config.EMAIL_VERIFY_TOKEN_TTL_HOURS);
      const verifyUrl = `${config.PUBLIC_ORIGIN}/api/v1/auth/verify-email?token=${verifyToken}`;
      await sendVerificationEmail({ to: cleanEmail, username: user.username, verifyUrl, config, log });

      log.info('email:updated', { userId: req.user.userId, email: cleanEmail });
      return sendSuccess(res, { message: 'Verification email sent to your new address', email: cleanEmail });
    } catch (error: any) {
      log.error('update-email failed', { error: error.message });
      return sendError(res, 500, 'Failed to update email', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /resend-verification — resend email verification (authenticated) ──
  router.post('/resend-verification', userAuth, rateLimit(2, 'resend-verify'), async (req: any, res: any) => {
    try {
      const user = await getUserById(req.user.userId);
      if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      if (!user.email) return sendError(res, 400, 'No email address on file', ErrorCodes.INVALID_INPUT);
      if (user.emailVerifiedAt) return sendError(res, 400, 'Email already verified', ErrorCodes.INVALID_INPUT);

      // Per-email rate limiting (separate from global endpoint limit)
      const emailKey = user.email.toLowerCase();
      const now = Date.now();
      const attempts = _resendVerifyLimits.get(emailKey) || [];
      const recentAttempts = attempts.filter((t: number) => now - t < RESEND_VERIFY_WINDOW);
      if (recentAttempts.length >= RESEND_VERIFY_MAX) {
        return sendError(res, 429, `Too many verification emails sent to this address. Try again in ${Math.ceil((recentAttempts[0] + RESEND_VERIFY_WINDOW - now) / 1000)}s`, ErrorCodes.RATE_LIMITED);
      }
      if (_resendVerifyLimits.size >= 10_000) {
        _resendVerifyLimits.delete(_resendVerifyLimits.keys().next().value);
      }
      _resendVerifyLimits.set(emailKey, [...recentAttempts, now]);

      // Invalidate old tokens
      await stores.emailTokens.invalidateVerificationTokens(req.user.userId);

      const verifyToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
      await stores.emailTokens.createVerificationToken(req.user.userId, tokenHash, user.email, config.EMAIL_VERIFY_TOKEN_TTL_HOURS);
      const verifyUrl = `${config.PUBLIC_ORIGIN}/api/v1/auth/verify-email?token=${verifyToken}`;
      await sendVerificationEmail({ to: user.email, username: user.username, verifyUrl, config, log });

      return sendSuccess(res, { message: 'Verification email sent' });
    } catch (error: any) {
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
      const active = timestamps.filter((t: number) => now - t < RESEND_VERIFY_WINDOW);
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

  /**
   * Resolve the reset token to a userId. Checks in-memory admin tokens
   * first, then falls back to self-service DB tokens.
   * Returns { userId } or { error } with status/message/code.
   */
  async function resolveResetToken(token: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    if (state._adminResetTokens?.has(tokenHash)) {
      const tokenData = state._adminResetTokens.get(tokenHash);
      if (Date.now() > tokenData.expiresAt) {
        state._adminResetTokens.delete(tokenHash);
        return { error: { status: 400, message: 'Reset link has expired', code: ErrorCodes.INVALID_INPUT } };
      }
      return { userId: tokenData.userId };
    }

    const consumed = await stores.emailTokens.consumeResetToken(tokenHash);
    if (consumed) return { userId: consumed.user_id };

    return { error: { status: 400, message: 'Invalid or expired reset link', code: ErrorCodes.INVALID_INPUT } };
  }

  // POST /reset-password — Validate token and reset password (public, no auth)
  router.post('/reset-password', rateLimit(5, 'reset-password'), passwordResetRateLimit, validate(schemas.resetPasswordPublic), async (req: any, res: any) => {
    try {
      const { token, newPassword, confirmPassword } = req.validatedBody;
      if (newPassword !== confirmPassword) {
        return sendError(res, 400, 'Passwords do not match', ErrorCodes.INVALID_INPUT);
      }
      if (!validatePasswordStrength(newPassword)) {
        return sendError(res, 400, 'Password must be 8-100 characters', ErrorCodes.INVALID_INPUT);
      }

      const resolved = await resolveResetToken(token);
      if (resolved.error) {
        return sendError(res, resolved.error.status, resolved.error.message, resolved.error.code);
      }
      const { userId: targetUserId } = resolved;
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const user = await getUserById(targetUserId);
      if (!user) {
        state._adminResetTokens.delete(tokenHash);
        return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      }

      await stores.users.update(targetUserId, { passwordHash: await hashPassword(newPassword) });
      invalidateUserCache();
      await invalidateUserSessions(targetUserId);
      disconnectUserSockets(targetUserId, io);
      state._adminResetTokens.delete(tokenHash);

      const auditLog = createAuditLog('user_reset_password', 'user', {
        userId: targetUserId,
        username: user.username,
        ipAddress: getRequestIp(req),
      });
      log.warn('user:reset-password', { ...auditLog });

      return sendSuccess(res, { success: true, message: 'Password reset successfully' });
    } catch (error: any) {
      log.error('reset-password failed', { error: error.message });
      return sendError(res, 500, 'Failed to reset password', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}

// ── Email verification result page ──────────────────────────────────────
function _verifyEmailPage(message: string, success: boolean) {
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
  <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0">${escapeHtml(message)}</p>
</div>
</body>
</html>`;
}
