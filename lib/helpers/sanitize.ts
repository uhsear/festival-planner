// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * Input sanitization, encoding, and log-safe transformations.
 */

const DANGEROUS_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function safeDataFilename(file: any) {
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) {
    throw new Error(`Unsafe data filename: ${file}`);
  }
  return file;
}

/**
 * Remove UTF-8 BOM from text if present
 */
export function stripBom(text: any) {
  // eslint-disable-next-line no-irregular-whitespace
  return typeof text === 'string' ? text.replace(/^﻿/, '') : text;
}

/**
 * Encode filename for Content-Disposition header (RFC 5987)
 */
export function encodeContentDispositionFilename(filename: any) {
  return encodeURIComponent(String(filename))
    .replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
}

/**
 * Sanitize user-provided string: normalize, remove control chars, trim
 * Removes RTL override chars, zero-width chars, line/paragraph separators,
 * word joiners, interlinear annotations, and other dangerous Unicode sequences
 */
export function sanitizeString(value: any, maxLen = 200) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/[\u061C\u200B\u200E\u200F\u2028-\u202E\u2060\u2066-\u2069\uFFF9-\uFFFB]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLen);
}

/**
 * Normalize a record key (festival/set/profile ID)
 * Returns null if key fails validation or is dangerous
 */
export function normalizeRecordKey(value: any, maxLen = 200) {
  if (typeof value !== 'string') return null;
  const normalized = sanitizeString(value, maxLen);
  if (!normalized || normalized !== value || DANGEROUS_RECORD_KEYS.has(normalized)) return null;
  return normalized;
}

/**
 * Validate identifier is alphanumeric, underscore, hyphen only
 */
export function sanitizeIdentifier(value: any, maxLen = 100) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, maxLen);
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

/**
 * Parse HTTP Cookie header into key-value object
 */
export function parseCookies(cookieHeader: any) {
  const cookies: Record<string, string> = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!key) continue;
    const value = trimmed.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

export function escapeHtml(value: any) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}


export function createAuditLog(action: any, userId: any, details: any = {}) {
  return {
    timestamp: new Date().toISOString(),
    action,
    userId,
    ...details,
  };
}

/**
 * Recursively sanitize an object by redacting sensitive field values
 * Sensitive field names: password, passwordHash, token, secret, cookie,
 * authorization, creditCard, ssn, apiKey
 */
export function sanitizeLogMeta(obj: any): any {
  const sensitiveFields = new Set([
    'password', 'passwordhash', 'token', 'secret', 'cookie',
    'authorization', 'creditcard', 'ssn', 'apikey',
    'email', 'refreshtoken', 'confirmpassword', 'newpassword',
    'currentpassword', 'sessiontoken', 'usertoken',
    'accesstoken', 'clientsecret', 'privatekey', 'credentials',
  ]);

  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeLogMeta(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveFields.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object') {
      sanitized[key] = sanitizeLogMeta(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function getLogSafeRequestInfo(req: any) {
  const sensitiveHeaders = new Set(['authorization', 'cookie', 'x-api-key', 'x-access-token']);
  const safeHeaders: Record<string, any> = {};
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (!sensitiveHeaders.has(key.toLowerCase())) {
      safeHeaders[key] = value;
    }
  }
  return {
    method: req.method,
    path: req.path,
    ip: req.ip,
    headers: safeHeaders,
  };
}
