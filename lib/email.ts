// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

import { Resend } from 'resend';
import { escapeHtml } from './helpers';

let _resend: any = null;

function getClient(apiKey: any) {
  if (!_resend && apiKey) _resend = new Resend(apiKey);
  return _resend;
}

// P3.4: Idempotency guard — prevents duplicate sends on retry/double-click
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _recentSends = new Map(); // key → timestamp

function _idempotencyKey(to: any, subject: any) {
  return `${to}:${subject}`;
}

function _checkIdempotency(to: any, subject: any, log: any) {
  const key = _idempotencyKey(to, subject);
  const lastSent = _recentSends.get(key);
  if (lastSent && Date.now() - lastSent < IDEMPOTENCY_TTL_MS) {
    log.warn('email:duplicate-suppressed', { to, subject, lastSentMs: Date.now() - lastSent });
    return true; // duplicate
  }
  return false;
}

function _recordSend(to: any, subject: any) {
  const key = _idempotencyKey(to, subject);
  _recentSends.set(key, Date.now());
  // Evict stale entries to prevent unbounded growth
  if (_recentSends.size > 500) {
    const now = Date.now();
    for (const [k, ts] of _recentSends) {
      if (now - ts > IDEMPOTENCY_TTL_MS) _recentSends.delete(k);
    }
  }
}

/**
 * Send a transactional email via Resend.
 * Gracefully degrades if RESEND_API_KEY is not set (logs warning, returns false).
 * Idempotent: suppresses duplicate sends to the same address+subject within 5 minutes.
 */
export async function sendEmail({ to, subject, html, text, config, log, _client }: any) {
  const apiKey = config.RESEND_API_KEY;
  if (!apiKey) {
    log.warn('email:skip', { reason: 'RESEND_API_KEY not configured' });
    return false;
  }

  if (_checkIdempotency(to, subject, log)) return true;

  const client = _client || getClient(apiKey);
  const from = config.EMAIL_FROM || 'Festie <uhsear@gmail.com>';

  try {
    const result = await client.emails.send({ from, to: [to], subject, html, text });
    if (result.error) {
      log.error('email:send-error', { to, subject, error: result.error.message });
      return false;
    }
    _recordSend(to, subject);
    log.debug('email:sent', { to, subject, id: result.data?.id });
    return true;
  } catch (error: any) {
    log.error('email:send-failed', { to, subject, error: error.message });
    return false;
  }
}

function _wrapTemplate(title: any, bodyHtml: any) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden">
  <tr><td style="padding:32px 32px 24px;text-align:center">
    <h1 style="margin:0 0 4px;color:#e4e4e7;font-size:22px;font-weight:600">Festie</h1>
    <p style="margin:0;color:rgba(255,255,255,0.5);font-size:13px">${title}</p>
  </td></tr>
  <tr><td style="padding:0 32px 24px">${bodyHtml}</td></tr>
  <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06)">
    <p style="color:rgba(255,255,255,0.3);font-size:12px;line-height:1.5;margin:0">If you didn't request this, you can safely ignore this email.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function _buttonHtml(url: any, label: any) {
  return `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:10px">${label}</a>
    </td></tr></table>`;
}

function _urlFallback(url: any) {
  return `<p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.5;margin:24px 0 0">If the button doesn't work, copy and paste this URL into your browser:</p>
    <p style="color:#a78bfa;font-size:12px;line-height:1.5;word-break:break-all;margin:8px 0 0">${escapeHtml(url)}</p>`;
}

/**
 * Send password reset email.
 */
export async function sendPasswordResetEmail({ to, username, resetUrl, config, log, _client }: any) {
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username)}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">We received a request to reset your password. Click the button below to choose a new one. This link expires in 60 minutes.</p>
    ${_buttonHtml(resetUrl, 'Reset Password')}
    ${_urlFallback(resetUrl)}`;

  const html = _wrapTemplate('Password Reset Request', bodyHtml);
  const text = `Hey ${username},\n\nWe received a request to reset your Festie password.\n\nReset your password: ${resetUrl}\n\nThis link expires in 60 minutes.\n\nIf you didn't request this, you can safely ignore this email.`;

  return sendEmail({ to, subject: 'Reset your Festie password', html, text, config, log, _client });
}

/**
 * Send email verification email.
 */
export async function sendVerificationEmail({ to, username, verifyUrl, config, log, _client }: any) {
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username)}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">Thanks for signing up! Please verify your email address by clicking the button below. This link expires in 24 hours.</p>
    ${_buttonHtml(verifyUrl, 'Verify Email')}
    ${_urlFallback(verifyUrl)}`;

  const html = _wrapTemplate('Verify Your Email', bodyHtml);
  const text = `Hey ${username},\n\nThanks for signing up for Festie!\n\nVerify your email: ${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't create this account, you can safely ignore this email.`;

  return sendEmail({ to, subject: 'Verify your Festie email', html, text, config, log, _client });
}
