'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { createCookieHelpers } = require('../lib/app-context/cookies');

const baseConfig = {
  COOKIE_SAME_SITE: 'Strict',
  COOKIE_SECURE: true,
  SESSION_TTL: 86400000,
  USER_SESSION_COOKIE: 'festie_session',
};

function makeMockRes() {
  const state = { headers: {}, cookies: {}, cleared: [] };
  return {
    setHeader(name, val) { state.headers[name] = val; },
    cookie(name, val, opts) { state.cookies[name] = { val, opts }; },
    clearCookie(name, opts) { state.cleared.push({ name, opts }); },
    _state: state,
  };
}

function makeMockReq(overrides = {}) {
  return {
    headers: overrides.headers || {},
    ...overrides,
  };
}

describe('cookies: setNoStore', () => {
  it('sets Cache-Control to no-store', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const res = makeMockRes();
    helpers.setNoStore(res);
    assert.equal(res._state.headers['Cache-Control'], 'no-store');
  });
});

describe('cookies: setSessionCookie', () => {
  it('sets an httpOnly cookie with correct options', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const res = makeMockRes();
    helpers.setSessionCookie(res, 'my_session', 'tok123');
    const cookie = res._state.cookies['my_session'];
    assert.equal(cookie.val, 'tok123');
    assert.equal(cookie.opts.httpOnly, true);
    assert.equal(cookie.opts.sameSite, 'Strict');
    assert.equal(cookie.opts.secure, true);
    assert.equal(cookie.opts.maxAge, 86400000);
    assert.equal(cookie.opts.path, '/');
  });
});

describe('cookies: clearSessionCookie', () => {
  it('clears the specified cookie', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const res = makeMockRes();
    helpers.clearSessionCookie(res, 'festie_session');
    assert.equal(res._state.cleared.length, 1);
    assert.equal(res._state.cleared[0].name, 'festie_session');
    assert.equal(res._state.cleared[0].opts.httpOnly, true);
    assert.equal(res._state.cleared[0].opts.path, '/');
  });
});

describe('cookies: setUserSessionCookie + clearUserSessionCookie', () => {
  it('setUserSessionCookie uses config cookie name', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const res = makeMockRes();
    helpers.setUserSessionCookie(res, 'my-token');
    assert.ok(res._state.cookies['festie_session']);
    assert.equal(res._state.cookies['festie_session'].val, 'my-token');
  });

  it('clearUserSessionCookie clears the config cookie name', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const res = makeMockRes();
    helpers.clearUserSessionCookie(res);
    assert.equal(res._state.cleared[0].name, 'festie_session');
  });
});

describe('cookies: resolveRequestToken', () => {
  it('prefers Bearer token from Authorization header', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const req = makeMockReq({ headers: { authorization: 'Bearer abc123' } });
    const result = helpers.resolveRequestToken(req, 'x-user-token', 'festie_session');
    assert.equal(result.token, 'abc123');
    assert.equal(result.source, 'bearer');
  });

  it('falls back to custom header', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const req = makeMockReq({ headers: { 'x-user-token': 'headertok' } });
    const result = helpers.resolveRequestToken(req, 'x-user-token', 'festie_session');
    assert.equal(result.token, 'headertok');
    assert.equal(result.source, 'header');
  });

  it('falls back to cookie', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const req = makeMockReq({ headers: { cookie: 'festie_session=cookietok' } });
    const result = helpers.resolveRequestToken(req, 'x-user-token', 'festie_session');
    assert.equal(result.token, 'cookietok');
    assert.equal(result.source, 'cookie');
  });

  it('falls back to legacy cookie name', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const req = makeMockReq({ headers: { cookie: 'festival_user_session=legacytok' } });
    const result = helpers.resolveRequestToken(req, 'x-user-token', 'festie_session');
    assert.equal(result.token, 'legacytok');
    assert.equal(result.source, 'cookie');
  });

  it('returns null token when nothing is present', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const req = makeMockReq({ headers: {} });
    const result = helpers.resolveRequestToken(req, 'x-user-token', 'festie_session');
    assert.equal(result.token, null);
    assert.equal(result.source, null);
  });

  it('ignores empty Bearer token', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const req = makeMockReq({ headers: { authorization: 'Bearer ' } });
    const result = helpers.resolveRequestToken(req, 'x-user-token', 'festie_session');
    assert.equal(result.token, null);
  });

  it('handles array header value', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const req = makeMockReq({ headers: { 'x-user-token': ['arraytok', 'second'] } });
    const result = helpers.resolveRequestToken(req, 'x-user-token', 'festie_session');
    assert.equal(result.token, 'arraytok');
    assert.equal(result.source, 'header');
  });
});

describe('cookies: resolveSocketToken', () => {
  it('returns explicit token when provided', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const socket = { handshake: { headers: {}, auth: {}, query: {} } };
    const token = helpers.resolveSocketToken(socket, 'explicit-tok', 'festie_session');
    assert.equal(token, 'explicit-tok');
  });

  it('falls back to socket.handshake.auth.token', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const socket = { handshake: { auth: { token: 'auth-tok' }, headers: {}, query: {} } };
    const token = helpers.resolveSocketToken(socket, null, 'festie_session');
    assert.equal(token, 'auth-tok');
  });

  it('falls back to query token', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const socket = { handshake: { auth: {}, query: { token: 'query-tok' }, headers: {} } };
    const token = helpers.resolveSocketToken(socket, null, 'festie_session');
    assert.equal(token, 'query-tok');
  });

  it('falls back to Bearer in socket headers', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const socket = { handshake: { auth: {}, query: {}, headers: { authorization: 'Bearer sock-bearer' } } };
    const token = helpers.resolveSocketToken(socket, null, 'festie_session');
    assert.equal(token, 'sock-bearer');
  });

  it('falls back to cookie from handshake headers', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const socket = { handshake: { auth: {}, query: {}, headers: { cookie: 'festie_session=cookie-tok' } } };
    const token = helpers.resolveSocketToken(socket, null, 'festie_session');
    assert.equal(token, 'cookie-tok');
  });

  it('returns null when no token found anywhere', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const socket = { handshake: { auth: {}, query: {}, headers: {} } };
    const token = helpers.resolveSocketToken(socket, null, 'festie_session');
    assert.equal(token, null);
  });

  it('trims whitespace from explicit token', () => {
    const helpers = createCookieHelpers({ config: baseConfig });
    const socket = { handshake: { headers: {}, auth: {}, query: {} } };
    const token = helpers.resolveSocketToken(socket, '  padded  ', 'festie_session');
    assert.equal(token, 'padded');
  });
});
