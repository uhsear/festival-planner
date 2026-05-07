'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { ErrorCodes, sendSuccess, sendError, RETRYABLE_CODES } = require('../lib/response');

// Mock Express response object
function createMockRes() {
  const headers = {};
  let statusCode = 200;
  let jsonBody = null;
  const res = {
    get statusCode() { return statusCode; },
    setHeader(key, value) { headers[key] = value; },
    status(code) { statusCode = code; return res; },
    json(body) { jsonBody = body; return res; },
    _headers: headers,
    _getBody() { return jsonBody; },
    _getStatus() { return statusCode; },
  };
  return res;
}

describe('response: ErrorCodes', () => {
  it('contains all expected error codes', () => {
    const expected = [
      'AUTH_REQUIRED', 'INVALID_CREDENTIALS', 'PASSWORD_INCORRECT',
      'TOKEN_EXPIRED', 'VALIDATION_ERROR', 'INVALID_INPUT',
      'MISSING_FIELD', 'NOT_FOUND', 'FORBIDDEN', 'ALREADY_EXISTS',
      'MAX_LIMIT_REACHED', 'VERSION_MISMATCH', 'RATE_LIMITED',
      'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE', 'ACCOUNT_LOCKED',
    ];
    for (const code of expected) {
      assert.ok(code in ErrorCodes, `Missing error code: ${code}`);
      assert.equal(ErrorCodes[code], code);
    }
  });

  it('error code values equal their keys', () => {
    for (const [key, value] of Object.entries(ErrorCodes)) {
      assert.equal(key, value);
    }
  });
});

describe('response: RETRYABLE_CODES', () => {
  it('includes RATE_LIMITED, INTERNAL_ERROR, SERVICE_UNAVAILABLE, VERSION_MISMATCH', () => {
    assert.ok(RETRYABLE_CODES.has(ErrorCodes.RATE_LIMITED));
    assert.ok(RETRYABLE_CODES.has(ErrorCodes.INTERNAL_ERROR));
    assert.ok(RETRYABLE_CODES.has(ErrorCodes.SERVICE_UNAVAILABLE));
    assert.ok(RETRYABLE_CODES.has(ErrorCodes.VERSION_MISMATCH));
  });

  it('does not include non-retryable codes', () => {
    assert.ok(!RETRYABLE_CODES.has(ErrorCodes.AUTH_REQUIRED));
    assert.ok(!RETRYABLE_CODES.has(ErrorCodes.NOT_FOUND));
    assert.ok(!RETRYABLE_CODES.has(ErrorCodes.FORBIDDEN));
    assert.ok(!RETRYABLE_CODES.has(ErrorCodes.VALIDATION_ERROR));
  });
});

describe('response: sendSuccess', () => {
  it('returns { data, error: null } structure', () => {
    const res = createMockRes();
    sendSuccess(res, { id: 1, name: 'test' });
    const body = res._getBody();
    assert.deepEqual(body.data, { id: 1, name: 'test' });
    assert.equal(body.error, null);
  });

  it('sets Content-Type header', () => {
    const res = createMockRes();
    sendSuccess(res, {});
    assert.equal(res._headers['Content-Type'], 'application/json; charset=utf-8');
  });

  it('includes meta when provided', () => {
    const res = createMockRes();
    sendSuccess(res, {}, { cursor: 'abc', total: 42 });
    const body = res._getBody();
    assert.deepEqual(body.meta, { cursor: 'abc', total: 42 });
  });

  it('omits meta when null', () => {
    const res = createMockRes();
    sendSuccess(res, {}, null);
    const body = res._getBody();
    assert.ok(!('meta' in body));
  });

  it('omits meta when empty object', () => {
    const res = createMockRes();
    sendSuccess(res, {}, {});
    const body = res._getBody();
    assert.ok(!('meta' in body));
  });

  it('trims meta to 10 keys when it has more', () => {
    const res = createMockRes();
    const bigMeta = {};
    for (let i = 0; i < 15; i++) bigMeta[`key${i}`] = i;
    sendSuccess(res, {}, bigMeta);
    const body = res._getBody();
    assert.equal(Object.keys(body.meta).length, 10);
  });

  it('sets X-API-Version header when config has API_VERSION', () => {
    const res = createMockRes();
    sendSuccess(res, {}, null, { API_VERSION: '2' });
    assert.equal(res._headers['X-API-Version'], '2');
  });

  it('does not set X-API-Version without config', () => {
    const res = createMockRes();
    sendSuccess(res, {});
    assert.ok(!('X-API-Version' in res._headers));
  });

  it('handles null data', () => {
    const res = createMockRes();
    sendSuccess(res, null);
    const body = res._getBody();
    assert.equal(body.data, null);
    assert.equal(body.error, null);
  });
});

describe('response: sendError', () => {
  it('returns { data: null, error } structure', () => {
    const res = createMockRes();
    sendError(res, 400, 'Bad input', ErrorCodes.INVALID_INPUT);
    const body = res._getBody();
    assert.equal(body.data, null);
    assert.equal(body.error.message, 'Bad input');
    assert.equal(body.error.status, 400);
    assert.equal(body.error.code, ErrorCodes.INVALID_INPUT);
  });

  it('sets HTTP status code', () => {
    const res = createMockRes();
    sendError(res, 404, 'Not found');
    assert.equal(res._getStatus(), 404);
  });

  it('sets Content-Type header', () => {
    const res = createMockRes();
    sendError(res, 500, 'Server error');
    assert.equal(res._headers['Content-Type'], 'application/json; charset=utf-8');
  });

  it('marks retryable codes as retryable=true', () => {
    const res = createMockRes();
    sendError(res, 429, 'Rate limited', ErrorCodes.RATE_LIMITED);
    assert.equal(res._getBody().error.retryable, true);
  });

  it('marks non-retryable codes as retryable=false', () => {
    const res = createMockRes();
    sendError(res, 403, 'Forbidden', ErrorCodes.FORBIDDEN);
    assert.equal(res._getBody().error.retryable, false);
  });

  it('marks 5xx without code as retryable=true', () => {
    const res = createMockRes();
    sendError(res, 500, 'Server error');
    assert.equal(res._getBody().error.retryable, true);
  });

  it('marks 4xx without code as retryable=false', () => {
    const res = createMockRes();
    sendError(res, 400, 'Bad request');
    assert.equal(res._getBody().error.retryable, false);
  });

  it('merges details into error object', () => {
    const res = createMockRes();
    sendError(res, 400, 'Validation failed', ErrorCodes.VALIDATION_ERROR, {
      fields: [{ path: 'name', message: 'required' }],
    });
    const body = res._getBody();
    assert.ok(Array.isArray(body.error.fields));
    assert.equal(body.error.fields[0].path, 'name');
  });

  it('ignores empty details object', () => {
    const res = createMockRes();
    sendError(res, 400, 'Error', ErrorCodes.INVALID_INPUT, {});
    const body = res._getBody();
    assert.ok(!('fields' in body.error));
  });

  it('ignores null details', () => {
    const res = createMockRes();
    sendError(res, 400, 'Error', ErrorCodes.INVALID_INPUT, null);
    const body = res._getBody();
    assert.equal(body.error.message, 'Error');
  });
});
