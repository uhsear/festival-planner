// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

const ErrorCodes = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  PASSWORD_INCORRECT: 'PASSWORD_INCORRECT',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_FIELD: 'MISSING_FIELD',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  MAX_LIMIT_REACHED: 'MAX_LIMIT_REACHED',
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
};

// Errors that are safe to retry (transient failures)
const RETRYABLE_CODES = new Set([
  ErrorCodes.RATE_LIMITED,
  ErrorCodes.INTERNAL_ERROR,
  ErrorCodes.SERVICE_UNAVAILABLE,
  ErrorCodes.VERSION_MISMATCH,
]);

function sendSuccess(res, data, meta = null, config = null) {
  const body = { data, error: null };
  if (meta && Object.keys(meta).length > 0) {
    const keys = Object.keys(meta);
    if (keys.length > 10) {
      const trimmed = {};
      for (let i = 0; i < 10; i++) trimmed[keys[i]] = meta[keys[i]];
      body.meta = trimmed;
    } else {
      body.meta = meta;
    }
  }
  if (config?.API_VERSION) {
    res.setHeader('X-API-Version', config.API_VERSION);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.json(body);
}

function sendError(res, status, message, code = null, details = null) {
  const error = { message, status };
  if (code) {
    error.code = code;
    error.retryable = RETRYABLE_CODES.has(code);
  } else {
    error.retryable = status >= 500;
  }
  if (details && Object.keys(details).length > 0) Object.assign(error, details);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json({ data: null, error });
}

module.exports = { ErrorCodes, sendSuccess, sendError, RETRYABLE_CODES };
