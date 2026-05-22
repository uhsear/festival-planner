import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSessionHelpers } from '../lib/app-context/session.js';

const baseConfig = {
  SESSION_TTL: 86400000,
  USER_SESSION_MAX: 5,
  USER_SESSION_COOKIE: 'festie_session',
};

const noopSendError = (res: any, status: number, msg: string, code: string) => { res._error = { status, msg, code }; };
const ErrorCodes = { AUTH_REQUIRED: 'AUTH_REQUIRED', FORBIDDEN: 'FORBIDDEN' };

function mockRes() {
  return {
    _error: null as any,
    _headers: {} as Record<string, any>,
    setHeader(name: string, val: any) { this._headers[name] = val; },
  };
}

function mockReq(overrides: any = {}) {
  return {
    headers: overrides.headers || {},
    get(h: string) { return this.headers[h.toLowerCase()]; },
    ...overrides,
  };
}

function mockStores(overrides: any = {}) {
  return {
    sessions: {
      createUserSession: overrides.createUserSession || (async () => []),
      validateUserSession: overrides.validateUserSession || (async () => null),
      deleteUserSessions: overrides.deleteUserSessions || (async () => {}),
    },
    roles: {
      hasRole: overrides.hasRole || (async () => false),
    },
  };
}

// ─── createUserSession ───────────────────────────────────────────────────────

describe('session: createUserSession', () => {
  it('returns a 64-char hex token', async () => {
    const helpers = createSessionHelpers({
      config: baseConfig,
      stores: mockStores(),
      getIO: () => null,
      resolveRequestToken: () => ({ token: null, source: null }),
      disconnectSocket: () => {},
      emitPresence: () => {},
      disconnectUserSockets: () => {},
      sendError: noopSendError,
      ErrorCodes,
    });
    const token = await helpers.createUserSession('u1', 'Alice');
    assert.equal(typeof token, 'string');
    assert.equal(token.length, 64);
    assert.ok(/^[a-f0-9]+$/.test(token));
  });

  it('calls stores.sessions.createUserSession with hashed token', async () => {
    let captured: any = null;
    const helpers = createSessionHelpers({
      config: baseConfig,
      stores: mockStores({
        createUserSession: async (args: any) => { captured = args; return []; },
      }),
      getIO: () => null,
      resolveRequestToken: () => ({ token: null, source: null }),
      disconnectSocket: () => {},
      emitPresence: () => {},
      disconnectUserSockets: () => {},
      sendError: noopSendError,
      ErrorCodes,
    });
    await helpers.createUserSession('u1', 'Alice');
    assert.ok(captured);
    assert.equal(captured.userId, 'u1');
    assert.equal(captured.username, 'Alice');
    assert.equal(captured.maxPerUser, 5);
    // Token should be hashed (64-char sha256 hex)
    assert.equal(captured.token.length, 64);
  });
});

// ─── validateUserSession ─────────────────────────────────────────────────────

describe('session: validateUserSession', () => {
  it('returns null for non-string token', async () => {
    const helpers = createSessionHelpers({
      config: baseConfig,
      stores: mockStores(),
      getIO: () => null,
      resolveRequestToken: () => ({ token: null, source: null }),
      disconnectSocket: () => {},
      emitPresence: () => {},
      disconnectUserSockets: () => {},
      sendError: noopSendError,
      ErrorCodes,
    });
    const result = await helpers.validateUserSession(null);
    assert.equal(result, null);
  });

  it('returns null for token with wrong length', async () => {
    const helpers = createSessionHelpers({
      config: baseConfig,
      stores: mockStores(),
      getIO: () => null,
      resolveRequestToken: () => ({ token: null, source: null }),
      disconnectSocket: () => {},
      emitPresence: () => {},
      disconnectUserSockets: () => {},
      sendError: noopSendError,
      ErrorCodes,
    });
    const result = await helpers.validateUserSession('short');
    assert.equal(result, null);
  });

  it('calls store with hashed token and SESSION_TTL for valid length', async () => {
    let calledWith: any = {};
    const helpers = createSessionHelpers({
      config: baseConfig,
      stores: mockStores({
        validateUserSession: async (hash: string, ttl: number) => { calledWith = { hash, ttl }; return { userId: 'u1' }; },
      }),
      getIO: () => null,
      resolveRequestToken: () => ({ token: null, source: null }),
      disconnectSocket: () => {},
      emitPresence: () => {},
      disconnectUserSockets: () => {},
      sendError: noopSendError,
      ErrorCodes,
    });
    const token = 'a'.repeat(64);
    const result = await helpers.validateUserSession(token);
    assert.ok(result);
    assert.equal(result.userId, 'u1');
    assert.equal(calledWith.ttl, 86400000);
    assert.equal(calledWith.hash.length, 64);
  });
});

// ─── invalidateUserSessions ──────────────────────────────────────────────────

describe('session: invalidateUserSessions', () => {
  it('calls deleteUserSessions on the store', async () => {
    let deletedUserId: string | null = null;
    const helpers = createSessionHelpers({
      config: baseConfig,
      stores: mockStores({
        deleteUserSessions: async (userId: string) => { deletedUserId = userId; },
      }),
      getIO: () => null,
      resolveRequestToken: () => ({ token: null, source: null }),
      disconnectSocket: () => {},
      emitPresence: () => {},
      disconnectUserSockets: () => {},
      sendError: noopSendError,
      ErrorCodes,
    });
    await helpers.invalidateUserSessions('u1');
    assert.equal(deletedUserId, 'u1');
  });
});

// ─── userAuth middleware ─────────────────────────────────────────────────────

describe('session: userAuth', () => {
  it('returns 401 when no valid session', async () => {
    const res = mockRes();
    const helpers = createSessionHelpers({
      config: baseConfig,
      stores: mockStores(),
      getIO: () => null,
      resolveRequestToken: () => ({ token: null, source: null }),
      disconnectSocket: () => {},
      emitPresence: () => {},
      disconnectUserSockets: () => {},
      sendError: noopSendError,
      ErrorCodes,
    });
    const req = mockReq({});
    let nextCalled = false;
    await helpers.userAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res._error.code, 'AUTH_REQUIRED');
  });

  it('calls next and sets req.user when session is valid', async () => {
    const token = 'a'.repeat(64);
    const res = mockRes();
    const helpers = createSessionHelpers({
      config: baseConfig,
      stores: mockStores({
        validateUserSession: async () => ({ userId: 'u1', username: 'Alice' }),
      }),
      getIO: () => null,
      resolveRequestToken: (req: any) => ({ token, source: 'bearer' }),
      disconnectSocket: () => {},
      emitPresence: () => {},
      disconnectUserSockets: () => {},
      sendError: noopSendError,
      ErrorCodes,
    });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    let nextCalled = false;
    await helpers.userAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.user.userId, 'u1');
    assert.equal(req.userToken, token);
    assert.equal(req.userAuthSource, 'bearer');
  });
});

// ─── adminAuth middleware ────────────────────────────────────────────────────

describe('session: adminAuth', () => {
  it('returns 401 when no valid session', async () => {
    const res = mockRes();
    const helpers = createSessionHelpers({
      config: baseConfig,
      stores: mockStores(),
      getIO: () => null,
      resolveRequestToken: () => ({ token: null, source: null }),
      disconnectSocket: () => {},
      emitPresence: () => {},
      disconnectUserSockets: () => {},
      sendError: noopSendError,
      ErrorCodes,
    });
    const req = mockReq({});
    let nextCalled = false;
    await helpers.adminAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res._error.code, 'AUTH_REQUIRED');
  });

  it('returns 403 when user is not admin', async () => {
    const token = 'b'.repeat(64);
    const res = mockRes();
    const helpers = createSessionHelpers({
      config: baseConfig,
      stores: mockStores({
        validateUserSession: async () => ({ userId: 'u1', username: 'Alice' }),
        hasRole: async () => false,
      }),
      getIO: () => null,
      resolveRequestToken: () => ({ token, source: 'bearer' }),
      disconnectSocket: () => {},
      emitPresence: () => {},
      disconnectUserSockets: () => {},
      sendError: noopSendError,
      ErrorCodes,
    });
    const req = mockReq({});
    let nextCalled = false;
    await helpers.adminAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res._error.code, 'FORBIDDEN');
  });

  it('calls next when user is admin', async () => {
    const token = 'c'.repeat(64);
    const res = mockRes();
    const helpers = createSessionHelpers({
      config: baseConfig,
      stores: mockStores({
        validateUserSession: async () => ({ userId: 'admin1', username: 'Admin' }),
        hasRole: async () => true,
      }),
      getIO: () => null,
      resolveRequestToken: () => ({ token, source: 'bearer' }),
      disconnectSocket: () => {},
      emitPresence: () => {},
      disconnectUserSockets: () => {},
      sendError: noopSendError,
      ErrorCodes,
    });
    const req = mockReq({});
    let nextCalled = false;
    await helpers.adminAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.user.userId, 'admin1');
  });
});
