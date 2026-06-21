// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Helper utilities for the Festie server.
 * Sub-modules handle specific domains:
 *   helpers/sanitize.ts    — input sanitization, encoding, log-safe transforms
 *   helpers/validation.ts  — input validation for festivals, users, forms
 *   helpers/export-utils.ts — HTML export generation, set timing, crew overlap, serialization
 * This file keeps identity, CSP, serialization, and retry functions,
 * and re-exports everything from sub-modules for backward compatibility.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import * as exportUtils from './helpers/export-utils.js';
import type { PublicUser } from './types/app-context';

const { buildAvatarUrl } = exportUtils;

const INLINE_HASH_FILES = [
  'index.html',
  'export-template.html',
  'privacy.html',
  'terms.html',
  'security-whitepaper.html',
  'offline.html',
];

// ── Sub-module re-exports ─────────────────────────────────────────────────────
export * from './helpers/sanitize.js';
export * from './helpers/validation.js';
export * from './helpers/export-utils.js';

// ════════════════════════════════════════════════════════════════════════════════
// Identity & Crypto (kept here — tiny, used everywhere)
// ════════════════════════════════════════════════════════════════════════════════

export function createOpaqueId(prefix: any) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createVersionToken() {
  return crypto.randomUUID();
}

// ════════════════════════════════════════════════════════════════════════════════
// User Serialization (kept here — used by routes, not export-specific)
// ════════════════════════════════════════════════════════════════════════════════

export function serializePublicUser(user: any): PublicUser {
  return {
    id: user.id,
    username: user.username,
    // Editable display name; null when unset so clients fall back to username.
    name: user.displayName || null,
    avatarUrl: buildAvatarUrl(user),
    email: user.email || null,
    emailVerified: !!user.emailVerifiedAt,
    // Payment handles for settle-up deep links. Public identifiers (the same
    // strings users hand out to get paid), surfaced so the owner can edit them
    // in account settings and crewmates can build a prefilled pay link.
    venmoHandle: user.venmoHandle || null,
    cashappCashtag: user.cashappCashtag || null,
    paypalHandle: user.paypalHandle || null,
  };
}

export function collectInlineHashes(publicDir: any) {
  const hashes: { script: Set<string>; style: Set<string> } = { script: new Set(), style: new Set() };

  for (const file of INLINE_HASH_FILES) {
    const filePath = path.join(publicDir, file);
    if (!fs.existsSync(filePath)) continue;
    const html = fs.readFileSync(filePath, 'utf8');
    const tagRegex = /<(script|style)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let match = tagRegex.exec(html);
    while (match) {
      const tagName = match[1]!.toLowerCase() as 'script' | 'style';
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

export function buildContentSecurityPolicy(config: any, inlineHashes: any, options: any = {}) {
  const allowStyleAttributes = Boolean(options.allowStyleAttributes);
  const firebaseScriptSrc = config.FIREBASE_CREDENTIALS_PATH ? 'https://www.gstatic.com/firebasejs/' : '';
  const scriptParts = ["'self'", 'https://static.cloudflareinsights.com'];
  if (firebaseScriptSrc) scriptParts.push(firebaseScriptSrc);
  scriptParts.push(...inlineHashes.script);
  const scriptSrc = scriptParts.join(' ');
  // SECURITY TRADEOFF: 'unsafe-inline' in style-src.
  //
  // motion/react (formerly framer-motion) sets inline styles at runtime via
  // direct DOM mutation (transform, opacity, will-change) that cannot be
  // covered by SHA-256 hashes — the style strings are dynamic per-frame and
  // differ on every animation tick. Adding nonces is impractical because
  // motion injects styles outside React's render cycle (via WAAPI fallback).
  //
  // Risk: an attacker who can inject HTML (but not script) could exfiltrate
  // data via CSS selectors (e.g., `input[value^="x"] { background: url(...) }`).
  // Mitigations already in place:
  //   - script-src does NOT include 'unsafe-inline' (XSS vector blocked)
  //   - All user-generated text is sanitized server-side (sanitizeString)
  //   - CSP frame-ancestors 'none' prevents UI-redress / clickjacking
  //   - CSRF protection via origin enforcement
  //
  // Accepted because: the CSS exfiltration attack requires pre-existing HTML
  // injection which is already mitigated, and removing 'unsafe-inline' would
  // break all motion/react animations across the app.
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
  // Crew map (MapLibre) raster tiles + Sentry error ingest. The OSM tile host is
  // also added to img-src (raster tiles load as images); Sentry's RN/web SDK
  // POSTs envelopes to *.sentry.io.
  connectParts.push('https://tile.openstreetmap.org https://*.sentry.io');
  const connectSrc = connectParts.join(' ');

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob: https://i.scdn.co https://tile.openstreetmap.org",
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

  directives.push('report-uri /api/csp-report');
  directives.push('report-to csp-endpoint');

  return directives.join('; ');
}

// ════════════════════════════════════════════════════════════════════════════════
// Retry Utility
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Retry async function with exponential backoff (from promptfoo/MiroFish patterns)
 * @param fn - Async function to retry
 * @param opts - Options
 * @param opts.maxAttempts - Max retry attempts (default: 3)
 * @param opts.baseDelay - Base delay in ms (default: 500)
 * @param opts.maxDelay - Max delay in ms (default: 10000)
 * @param opts.isRetryable - Predicate to check if error is retryable (default: all errors)
 * @returns Result of fn
 */
export async function withRetry(
  fn: any,
  { maxAttempts = 3, baseDelay = 500, maxDelay = 10000, isRetryable = () => true }: any = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryable(error)) throw error;
      const jitter = Math.random() * 200;
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1) + jitter, maxDelay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
