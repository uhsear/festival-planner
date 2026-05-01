// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

/**
 * Helper utilities for the Festie server.
 * Sub-modules handle specific domains:
 *   helpers/sanitize.js    — input sanitization, encoding, log-safe transforms
 *   helpers/validation.js  — input validation for festivals, users, forms
 *   helpers/export-utils.js — HTML export generation, set timing, crew overlap, serialization
 * This file keeps identity, CSP, serialization, and retry functions,
 * and re-exports everything from sub-modules for backward compatibility.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INLINE_HASH_FILES = ['index.html', 'export-template.html', 'privacy.html', 'terms.html', 'security-whitepaper.html', 'offline.html'];

// ── Sub-module re-exports ─────────────────────────────────────────────────────
const sanitize = require('./helpers/sanitize');
const validation = require('./helpers/validation');
const exportUtils = require('./helpers/export-utils');
const { buildAvatarUrl} = exportUtils;

// ════════════════════════════════════════════════════════════════════════════════
// Identity & Crypto (kept here — tiny, used everywhere)
// ════════════════════════════════════════════════════════════════════════════════

function createOpaqueId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createVersionToken() {
  return crypto.randomUUID();
}


// ════════════════════════════════════════════════════════════════════════════════
// User Serialization (kept here — used by routes, not export-specific)
// ════════════════════════════════════════════════════════════════════════════════

function serializePublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    avatarUrl: buildAvatarUrl(user),
    email: user.email || null,
    emailVerified: !!user.emailVerifiedAt,
  };
}


function collectInlineHashes(publicDir) {
  const hashes = { script: new Set(), style: new Set() };

  for (const file of INLINE_HASH_FILES) {
    const filePath = path.join(publicDir, file);
    if (!fs.existsSync(filePath)) continue;
    const html = fs.readFileSync(filePath, 'utf8');
    const tagRegex = /<(script|style)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let match = tagRegex.exec(html);
    while (match) {
      const tagName = match[1].toLowerCase();
      const attrs = match[2] || '';
      const body = match[3] || '';
      if (body.trim()) {
        if (tagName !== 'script' || !/\ssrc\s*=/.test(attrs)) {
          const digest = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
          hashes[tagName].add(`'sha256-${digest}'`);
        }
      }
      match = tagRegex.exec(html);
    }
  }

  return {
    script: [...hashes.script],
    style: [...hashes.style],
  };
}

function buildContentSecurityPolicy(config, inlineHashes, options = {}) {
  const allowStyleAttributes = Boolean(options.allowStyleAttributes);
  const firebaseScriptSrc = config.FIREBASE_CREDENTIALS_PATH ? 'https://www.gstatic.com/firebasejs/' : '';
  const scriptParts = ["'self'", 'https://static.cloudflareinsights.com'];
  if (firebaseScriptSrc) scriptParts.push(firebaseScriptSrc);
  scriptParts.push(...inlineHashes.script);
  const scriptSrc = scriptParts.join(' ');
  // motion/react sets inline styles at runtime via direct DOM mutation
  // (transform, opacity, will-change) that cannot be covered by SHA-256
  // hashes — the style strings are dynamic per-frame. Adding 'unsafe-inline'
  // to style-src mirrors what we already allow on style-src-attr and matches
  // standard React + Tailwind + motion/styled-components deployments. Kills
  // the per-page-load CSP violation console spam.
  const styleSrc = ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'].join(' ');
  const websocketOrigin = config.PUBLIC_ORIGIN
    ? config.PUBLIC_ORIGIN.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
    : null;
  const fcmEndpoints = config.FIREBASE_CREDENTIALS_PATH
    ? 'https://fcm.googleapis.com https://fcmregistrations.googleapis.com https://firebaseinstallations.googleapis.com'
    : '';
  const connectParts = ["'self'"];
  if (websocketOrigin) connectParts.push(websocketOrigin);
  if (fcmEndpoints) connectParts.push(fcmEndpoints);
  // Allow html-to-image to fetch the Google Fonts CSS (already allowed in
  // style-src, but html-to-image uses fetch() which is governed by connect-src)
  // so exported wrap PNGs include the custom Syncopate/Space Grotesk glyphs
  // instead of falling back to system fonts.
  connectParts.push('https://fonts.googleapis.com https://fonts.gstatic.com');
  const connectSrc = connectParts.join(' ');

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    `style-src ${styleSrc}`,
    `script-src ${scriptSrc}`,
    "script-src-attr 'none'",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "child-src 'self'",
  ];

  if (allowStyleAttributes) directives.push("style-src-attr 'unsafe-inline'");
  directives.push("frame-src 'self' https://open.spotify.com");
  directives.push("media-src 'none'");

  // Auto-upgrade http→https sub-requests in production (prevents mixed-content downgrade)
  if (config.PUBLIC_ORIGIN && String(config.PUBLIC_ORIGIN).startsWith('https://')) {
    directives.push('upgrade-insecure-requests');
  }

  directives.push("report-uri /api/csp-report");

  return directives.join('; ');
}

// ════════════════════════════════════════════════════════════════════════════════
// Retry Utility
// ════════════════════════════════════════════════════════════════════════════════


/**
 * Retry async function with exponential backoff (from promptfoo/MiroFish patterns)
 * @param {Function} fn - Async function to retry
 * @param {Object} opts - Options
 * @param {number} opts.maxAttempts - Max retry attempts (default: 3)
 * @param {number} opts.baseDelay - Base delay in ms (default: 500)
 * @param {number} opts.maxDelay - Max delay in ms (default: 10000)
 * @param {Function} opts.isRetryable - Predicate to check if error is retryable (default: all errors)
 * @returns {Promise} - Result of fn
 */
async function withRetry(fn, { maxAttempts = 3, baseDelay = 500, maxDelay = 10000, isRetryable = () => true } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryable(error)) throw error;
      const jitter = Math.random() * 200;
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1) + jitter, maxDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

module.exports = {
  // Re-exported from helpers/sanitize.js
  ...sanitize,
  // Re-exported from helpers/validation.js
  ...validation,
  // Re-exported from helpers/export-utils.js
  ...exportUtils,
  // Kept in helpers.js
  createOpaqueId,
  createVersionToken,
  serializePublicUser,
  collectInlineHashes,
  buildContentSecurityPolicy,
  withRetry,
};
