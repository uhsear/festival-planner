// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

/**
 * Input sanitization, encoding, and log-safe transformations.
 */

const DANGEROUS_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function safeDataFilename(file) {
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) {
    throw new Error(`Unsafe data filename: ${file}`);
  }
  return file;
}

/**
 * Remove UTF-8 BOM from text if present
 * @param {string} text - Text potentially with BOM
 * @returns {string} - Text without BOM
 */
function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : text;
}

/**
 * Encode filename for Content-Disposition header (RFC 5987)
 * @param {string} filename - Filename
 * @returns {string} - Encoded filename
 */
function encodeContentDispositionFilename(filename) {
  return encodeURIComponent(String(filename))
    .replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
}

/**
 * Sanitize user-provided string: normalize, remove control chars, trim
  * Removes RTL override chars, zero-width chars, line/paragraph separators,
  * word joiners, interlinear annotations, and other dangerous Unicode sequences
 * @param {number} maxLen - Maximum length (default 200)
 * @returns {string} - Sanitized string
 */
function sanitizeString(value, maxLen = 200) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/[\u061C\u200B\u200E\u200F\u2028-\u202E\u2060\u2066-\u2069\uFFF9-\uFFFB]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

/**
 * Normalize a record key (festival/set/profile ID)
 * Returns null if key fails validation or is dangerous
 * @param {string} value - Key to validate
 * @param {number} maxLen - Maximum length (default 200)
 * @returns {string|null} - Normalized key or null
 */
function normalizeRecordKey(value, maxLen = 200) {
  if (typeof value !== 'string') return null;
  const normalized = sanitizeString(value, maxLen);
  if (!normalized || normalized !== value || DANGEROUS_RECORD_KEYS.has(normalized)) return null;
  return normalized;
}

/**
 * Validate identifier is alphanumeric, underscore, hyphen only
 * @param {string} value - Identifier to validate
 * @param {number} maxLen - Maximum length (default 100)
 * @returns {string|null} - Validated identifier or null
 */
function sanitizeIdentifier(value, maxLen = 100) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, maxLen);
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

/**
 * Parse HTTP Cookie header into key-value object
 * @param {string} cookieHeader - Cookie header value
 * @returns {Object} - Cookie key-value pairs (handles malformed cookies gracefully)
 */
function parseCookies(cookieHeader) {
  const cookies = {};
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}


function createAuditLog(action, userId, details = {}) {
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
 * @param {any} obj - Object to sanitize (returns new object, doesn't mutate)
 * @returns {any} - Sanitized copy with sensitive values redacted
 */
function sanitizeLogMeta(obj) {
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

  const sanitized = {};
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

function getLogSafeRequestInfo(req) {
  const sensitiveHeaders = new Set(['authorization', 'cookie', 'x-api-key', 'x-access-token']);
  const safeHeaders = {};
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

module.exports = {
  safeDataFilename, stripBom, encodeContentDispositionFilename,
  sanitizeString, normalizeRecordKey, sanitizeIdentifier,
  parseCookies, escapeHtml, createAuditLog, sanitizeLogMeta, getLogSafeRequestInfo,
};
