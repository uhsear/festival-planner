'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  createRequestHelpers,
  MUTATING_METHODS,
  TRUSTED_MUTATION_HEADER,
  TRUSTED_MUTATION_VALUE,
} = require('../lib/app-context/request-helpers');

const baseConfig = {
  TRUST_PROXY: true,
  ALLOWED_ORIGINS: ['https://festie.us', 'https://staging.festie.us'],
  USER_SESSION_COOKIE: 'festie_session',
  ADMIN_SESSION_COOKIE: 'festie_admin',
};

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };
const noopSendError = () => {};
const ErrorCodes = { FORBIDDEN: 'FORBIDDEN' };

function makeHelpers(configOverrides = {}) {
  return createRequestHelpers({
    config: { ...baseConfig, ...configOverrides },
    log: noopLog,
    sendError: noopSendError,
    ErrorCodes,
  });
}

function mockReq(overrides = {}) {
  return {
    headers: overrides.headers || {},
    method: overrides.method || 'GET',
    path: overrides.path || '/',
    ip: overrides.ip || '127.0.0.1',
    connection: overrides.connection || {},
    socket: overrides.socket || {},
    get(header) {
      const lower = header.toLowerCase();
      return this.headers[lower];
    },
    ...overrides,
  };
}

// ─── Module exports ──────────────────────────────────────────────────────────

describe('request-helpers: module constants', () => {
  it('MUTATING_METHODS contains POST, PUT, PATCH, DELETE', () => {
    assert.ok(MUTATING_METHODS.has('POST'));
    assert.ok(MUTATING_METHODS.has('PUT'));
    assert.ok(MUTATING_METHODS.has('PATCH'));
    assert.ok(MUTATING_METHODS.has('DELETE'));
    assert.ok(!MUTATING_METHODS.has('GET'));
  });

  it('TRUSTED_MUTATION_HEADER and VALUE are defined', () => {
    assert.equal(TRUSTED_MUTATION_HEADER, 'x-festie-request');
    assert.equal(TRUSTED_MUTATION_VALUE, '1');
  });
});

// ─── getRequestIp ────────────────────────────────────────────────────────────

describe('request-helpers: getRequestIp', () => {
  it('returns cf-connecting-ip when TRUST_PROXY is true', () => {
    const helpers = makeHelpers({ TRUST_PROXY: true });
    const req = mockReq({ headers: { 'cf-connecting-ip': '1.2.3.4' } });
    assert.equal(helpers.getRequestIp(req), '1.2.3.4');
  });

  it('returns x-forwarded-for first IP when TRUST_PROXY is true', () => {
    const helpers = makeHelpers({ TRUST_PROXY: true });
    const req = mockReq({ headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } });
    assert.equal(helpers.getRequestIp(req), '10.0.0.1');
  });

  it('ignores proxy headers when TRUST_PROXY is false', () => {
    const helpers = makeHelpers({ TRUST_PROXY: false });
    const req = mockReq({ headers: { 'cf-connecting-ip': '1.2.3.4' }, ip: '192.168.1.1' });
    assert.equal(helpers.getRequestIp(req), '192.168.1.1');
  });

  it('falls back to req.ip', () => {
    const helpers = makeHelpers({ TRUST_PROXY: false });
    const req = mockReq({ ip: '10.10.10.10' });
    assert.equal(helpers.getRequestIp(req), '10.10.10.10');
  });

  it('returns "unknown" when no valid IP is found', () => {
    const helpers = makeHelpers({ TRUST_PROXY: false });
    const req = mockReq({ ip: undefined, connection: {}, socket: {} });
    assert.equal(helpers.getRequestIp(req), 'unknown');
  });
});

// ─── getRawRequestIp ─────────────────────────────────────────────────────────

describe('request-helpers: getRawRequestIp', () => {
  it('returns socket.remoteAddress', () => {
    const helpers = makeHelpers();
    const req = mockReq({ socket: { remoteAddress: '192.168.0.5' } });
    assert.equal(helpers.getRawRequestIp(req), '192.168.0.5');
  });

  it('returns connection.remoteAddress as fallback', () => {
    const helpers = makeHelpers();
    const req = mockReq({ socket: {}, connection: { remoteAddress: '10.0.0.5' } });
    assert.equal(helpers.getRawRequestIp(req), '10.0.0.5');
  });

  it('returns "unknown" when no IP found', () => {
    const helpers = makeHelpers();
    const req = mockReq({ socket: {}, connection: {} });
    assert.equal(helpers.getRawRequestIp(req), 'unknown');
  });
});

// ─── isAllowedOrigin ─────────────────────────────────────────────────────────

describe('request-helpers: isAllowedOrigin', () => {
  it('returns true when origin is falsy', () => {
    const helpers = makeHelpers();
    assert.equal(helpers.isAllowedOrigin(null, 'festie.us'), true);
    assert.equal(helpers.isAllowedOrigin(undefined, 'festie.us'), true);
    assert.equal(helpers.isAllowedOrigin('', 'festie.us'), true);
  });

  it('returns true when origin host matches host param', () => {
    const helpers = makeHelpers();
    assert.equal(helpers.isAllowedOrigin('https://festie.us', 'festie.us'), true);
  });

  it('returns true for allowed origins in config', () => {
    const helpers = makeHelpers();
    assert.equal(helpers.isAllowedOrigin('https://festie.us', 'other.com'), true);
    assert.equal(helpers.isAllowedOrigin('https://staging.festie.us', 'other.com'), true);
  });

  it('returns false for disallowed origins', () => {
    const helpers = makeHelpers();
    assert.equal(helpers.isAllowedOrigin('https://evil.com', 'festie.us'), false);
  });

  it('returns false for malformed origin URL', () => {
    const helpers = makeHelpers();
    assert.equal(helpers.isAllowedOrigin('not-a-url', 'festie.us'), false);
  });
});

// ─── hasBearerToken / hasDirectAuthHeader / hasSessionCookie ─────────────────

describe('request-helpers: auth detection helpers', () => {
  it('hasBearerToken returns true for valid Bearer header', () => {
    const helpers = makeHelpers();
    const req = mockReq({ headers: { authorization: 'Bearer abc123def' } });
    assert.equal(helpers.hasBearerToken(req), true);
  });

  it('hasBearerToken returns false for missing header', () => {
    const helpers = makeHelpers();
    const req = mockReq({});
    assert.equal(helpers.hasBearerToken(req), false);
  });

  it('hasBearerToken returns false for empty Bearer', () => {
    const helpers = makeHelpers();
    const req = mockReq({ headers: { authorization: 'Bearer ' } });
    assert.equal(helpers.hasBearerToken(req), false);
  });

  it('hasDirectAuthHeader detects x-user-token', () => {
    const helpers = makeHelpers();
    const req = mockReq({ headers: { 'x-user-token': 'tok' } });
    assert.equal(helpers.hasDirectAuthHeader(req), true);
  });

  it('hasSessionCookie detects user session cookie', () => {
    const helpers = makeHelpers();
    const req = mockReq({ headers: { cookie: 'festie_session=abc' } });
    assert.equal(helpers.hasSessionCookie(req), true);
  });

  it('hasSessionCookie returns false when no session cookie', () => {
    const helpers = makeHelpers();
    const req = mockReq({ headers: { cookie: 'other=val' } });
    assert.equal(helpers.hasSessionCookie(req), false);
  });
});

// ─── enforceAllowedOrigin middleware ─────────────────────────────────────────

describe('request-helpers: enforceAllowedOrigin', () => {
  it('passes through GET requests without checking origin', (t, done) => {
    const helpers = makeHelpers();
    const req = mockReq({ method: 'GET' });
    helpers.enforceAllowedOrigin(req, {}, () => { done(); });
  });

  it('passes through POST with Bearer token', (t, done) => {
    const helpers = makeHelpers();
    const req = mockReq({ method: 'POST', headers: { authorization: 'Bearer tok123' } });
    helpers.enforceAllowedOrigin(req, {}, () => { done(); });
  });

  it('passes through POST with valid origin', (t, done) => {
    const helpers = makeHelpers();
    const req = mockReq({ method: 'POST', headers: { origin: 'https://festie.us', host: 'festie.us' } });
    helpers.enforceAllowedOrigin(req, {}, () => { done(); });
  });

  it('blocks POST with invalid origin', () => {
    let errorCode = null;
    const helpers = createRequestHelpers({
      config: baseConfig,
      log: noopLog,
      sendError: (res, status, msg, code) => { errorCode = code; },
      ErrorCodes,
    });
    const req = mockReq({ method: 'POST', headers: { origin: 'https://evil.com', host: 'festie.us' } });
    helpers.enforceAllowedOrigin(req, {}, () => {});
    assert.equal(errorCode, 'FORBIDDEN');
  });

  it('passes through POST with trusted mutation header and no origin', (t, done) => {
    const helpers = makeHelpers();
    const req = mockReq({ method: 'POST', headers: { 'x-festie-request': '1' } });
    helpers.enforceAllowedOrigin(req, {}, () => { done(); });
  });

  it('passes through POST with no session cookie and no origin', (t, done) => {
    const helpers = makeHelpers();
    const req = mockReq({ method: 'POST', headers: {} });
    helpers.enforceAllowedOrigin(req, {}, () => { done(); });
  });

  it('blocks POST with session cookie but no origin or auth header', () => {
    let errorCode = null;
    const helpers = createRequestHelpers({
      config: baseConfig,
      log: noopLog,
      sendError: (res, status, msg, code) => { errorCode = code; },
      ErrorCodes,
    });
    const req = mockReq({ method: 'POST', headers: { cookie: 'festie_session=abc' } });
    helpers.enforceAllowedOrigin(req, {}, () => {});
    assert.equal(errorCode, 'FORBIDDEN');
  });
});
