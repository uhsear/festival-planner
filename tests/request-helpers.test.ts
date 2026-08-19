import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createRequestHelpers,
  MUTATING_METHODS,
  TRUSTED_MUTATION_HEADER,
  TRUSTED_MUTATION_VALUE,
} from '../lib/app-context/request-helpers.js';

const baseConfig = {
  TRUST_PROXY: true,
  ALLOWED_ORIGINS: ['https://festie.us', 'https://staging.festie.us'],
  USER_SESSION_COOKIE: 'festie_session',
  ADMIN_SESSION_COOKIE: 'festie_admin',
};

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };
const noopSendError = () => {};
const ErrorCodes = { FORBIDDEN: 'FORBIDDEN' };

function makeHelpers(configOverrides: any = {}) {
  return createRequestHelpers({
    config: { ...baseConfig, ...configOverrides },
    log: noopLog,
    sendError: noopSendError,
    ErrorCodes,
  });
}

function mockReq(overrides: any = {}) {
  return {
    headers: overrides.headers || {},
    method: overrides.method || 'GET',
    path: overrides.path || '/',
    ip: overrides.ip || '127.0.0.1',
    connection: overrides.connection || {},
    socket: overrides.socket || {},
    get(header: string) {
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

// ─── getSocketRequestIp ──────────────────────────────────────────────────────
// Regression cover for a production bug measured 2026-08-19: the Socket.IO
// allowRequest handler used getRawRequestIp, which reads only the TCP peer.
// Behind the Cloudflare Tunnel that is 127.0.0.1 for EVERY user, so the per-IP
// socket connect limiter collapsed into one shared bucket and capped the whole
// app at SOCKET_CONNECT_RATE_LIMIT new websockets per window. Proven live: a
// second machine on a different public IP was refused immediately after the
// first exhausted the window, then connected once the window cleared.
//
// NOTE: the handshake req is a raw Node IncomingMessage — no req.get() — so
// these mocks deliberately expose headers only.
describe('request-helpers: getSocketRequestIp', () => {
  const socketReq = (headers: any, remoteAddress?: string) => ({
    headers,
    socket: remoteAddress ? { remoteAddress } : {},
  });

  it('uses cf-connecting-ip behind the trusted edge, NOT the loopback tunnel peer', () => {
    const helpers = makeHelpers({ TRUST_PROXY: true });
    const req = socketReq({ 'cf-connecting-ip': '203.0.113.9' }, '127.0.0.1');
    assert.equal(helpers.getSocketRequestIp(req), '203.0.113.9');
  });

  it('distinguishes two users arriving through the same tunnel', () => {
    // The actual bug: both of these returned 127.0.0.1 and shared one budget.
    const helpers = makeHelpers({ TRUST_PROXY: true });
    const a = helpers.getSocketRequestIp(socketReq({ 'cf-connecting-ip': '198.51.100.1' }, '127.0.0.1'));
    const b = helpers.getSocketRequestIp(socketReq({ 'cf-connecting-ip': '198.51.100.2' }, '127.0.0.1'));
    assert.notEqual(a, b, 'two clients behind the tunnel must not share a rate-limit key');
  });

  it('works without req.get() — the handshake is not an Express request', () => {
    const helpers = makeHelpers({ TRUST_PROXY: true });
    const req: any = socketReq({ 'cf-connecting-ip': '203.0.113.5' }, '127.0.0.1');
    assert.equal(typeof req.get, 'undefined');
    assert.doesNotThrow(() => helpers.getSocketRequestIp(req));
  });

  it('never trusts x-forwarded-for (a client must not move its own key)', () => {
    const helpers = makeHelpers({ TRUST_PROXY: true });
    const req = socketReq({ 'x-forwarded-for': '9.9.9.9' }, '203.0.113.7');
    assert.equal(helpers.getSocketRequestIp(req), '203.0.113.7');
  });

  it('takes the first value if cf-connecting-ip arrives as an array', () => {
    const helpers = makeHelpers({ TRUST_PROXY: true });
    const req = socketReq({ 'cf-connecting-ip': ['203.0.113.4', '10.0.0.1'] }, '127.0.0.1');
    assert.equal(helpers.getSocketRequestIp(req), '203.0.113.4');
  });

  it('ignores cf-connecting-ip when TRUST_PROXY is false (local dev, no edge)', () => {
    const helpers = makeHelpers({ TRUST_PROXY: false });
    const req = socketReq({ 'cf-connecting-ip': '203.0.113.9' }, '198.51.100.20');
    assert.equal(helpers.getSocketRequestIp(req), '198.51.100.20');
  });

  it('falls back to the socket peer when cf-connecting-ip is absent or malformed', () => {
    const helpers = makeHelpers({ TRUST_PROXY: true });
    assert.equal(helpers.getSocketRequestIp(socketReq({}, '198.51.100.30')), '198.51.100.30');
    assert.equal(
      helpers.getSocketRequestIp(socketReq({ 'cf-connecting-ip': 'not-an-ip' }, '198.51.100.31')),
      '198.51.100.31',
    );
  });

  it('returns "unknown" when nothing usable is present', () => {
    const helpers = makeHelpers({ TRUST_PROXY: true });
    assert.equal(helpers.getSocketRequestIp({ headers: {}, socket: {} }), 'unknown');
  });
});

// ─── getRequestIp ────────────────────────────────────────────────────────────

describe('request-helpers: getRequestIp', () => {
  it('returns cf-connecting-ip when TRUST_PROXY is true', () => {
    const helpers = makeHelpers({ TRUST_PROXY: true });
    const req = mockReq({ headers: { 'cf-connecting-ip': '1.2.3.4' } });
    assert.equal(helpers.getRequestIp(req), '1.2.3.4');
  });

  it('does NOT trust x-forwarded-for when TRUST_PROXY is true (falls back to socket peer)', () => {
    // Under the hardened contract XFF is never consulted. With only XFF set
    // and no cf-connecting-ip, the key comes from the raw socket peer.
    const helpers = makeHelpers({ TRUST_PROXY: true });
    const req = mockReq({
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
      ip: undefined,
      socket: { remoteAddress: '203.0.113.7' },
    });
    assert.equal(helpers.getRequestIp(req), '203.0.113.7');
  });

  it('prefers cf-connecting-ip over a spoofed x-forwarded-for when TRUST_PROXY is true', () => {
    const helpers = makeHelpers({ TRUST_PROXY: true });
    const req = mockReq({
      headers: { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' },
    });
    assert.equal(helpers.getRequestIp(req), '1.2.3.4');
  });

  it('x-forwarded-for cannot move the key off the socket peer when TRUST_PROXY is true', () => {
    // Spoof regression: a forged XFF must not override the real socket address.
    const helpers = makeHelpers({ TRUST_PROXY: true });
    const req = mockReq({
      headers: { 'x-forwarded-for': '9.9.9.9' },
      ip: undefined,
      socket: { remoteAddress: '127.0.0.1' },
    });
    assert.equal(helpers.getRequestIp(req), '127.0.0.1');
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
    helpers.enforceAllowedOrigin(req, {}, () => {
      done();
    });
  });

  it('passes through POST with Bearer token', (t, done) => {
    const helpers = makeHelpers();
    const req = mockReq({ method: 'POST', headers: { authorization: 'Bearer tok123' } });
    helpers.enforceAllowedOrigin(req, {}, () => {
      done();
    });
  });

  it('passes through POST with valid origin', (t, done) => {
    const helpers = makeHelpers();
    const req = mockReq({ method: 'POST', headers: { origin: 'https://festie.us', host: 'festie.us' } });
    helpers.enforceAllowedOrigin(req, {}, () => {
      done();
    });
  });

  it('blocks POST with invalid origin', () => {
    let errorCode: string | null = null;
    const helpers = createRequestHelpers({
      config: baseConfig,
      log: noopLog,
      sendError: (res: any, status: any, msg: any, code: any) => {
        errorCode = code;
      },
      ErrorCodes,
    });
    const req = mockReq({ method: 'POST', headers: { origin: 'https://evil.com', host: 'festie.us' } });
    helpers.enforceAllowedOrigin(req, {}, () => {});
    assert.equal(errorCode, 'FORBIDDEN');
  });

  it('passes through POST with trusted mutation header and no origin', (t, done) => {
    const helpers = makeHelpers();
    const req = mockReq({ method: 'POST', headers: { 'x-festie-request': '1' } });
    helpers.enforceAllowedOrigin(req, {}, () => {
      done();
    });
  });

  it('passes through POST with no session cookie and no origin', (t, done) => {
    const helpers = makeHelpers();
    const req = mockReq({ method: 'POST', headers: {} });
    helpers.enforceAllowedOrigin(req, {}, () => {
      done();
    });
  });

  it('blocks POST with session cookie + Bearer header but no origin (L8/H4 hardening)', () => {
    let errorCode: string | null = null;
    const helpers = createRequestHelpers({
      config: baseConfig,
      log: noopLog,
      sendError: (_res: any, _status: any, _msg: any, code: any) => {
        errorCode = code;
      },
      ErrorCodes,
    });
    const req = mockReq({
      method: 'POST',
      headers: { cookie: 'festie_session=abc', authorization: 'Bearer tok123' },
    });
    helpers.enforceAllowedOrigin(req, {}, () => {});
    assert.equal(errorCode, 'FORBIDDEN');
  });

  it('passes through POST with session cookie + Bearer header + valid origin', (t, done) => {
    const helpers = makeHelpers();
    const req = mockReq({
      method: 'POST',
      headers: {
        cookie: 'festie_session=abc',
        authorization: 'Bearer tok123',
        origin: 'https://festie.us',
        host: 'festie.us',
      },
    });
    helpers.enforceAllowedOrigin(req, {}, () => {
      done();
    });
  });

  it('blocks POST with session cookie but no origin or auth header', () => {
    let errorCode: string | null = null;
    const helpers = createRequestHelpers({
      config: baseConfig,
      log: noopLog,
      sendError: (res: any, status: any, msg: any, code: any) => {
        errorCode = code;
      },
      ErrorCodes,
    });
    const req = mockReq({ method: 'POST', headers: { cookie: 'festie_session=abc' } });
    helpers.enforceAllowedOrigin(req, {}, () => {});
    assert.equal(errorCode, 'FORBIDDEN');
  });
});
