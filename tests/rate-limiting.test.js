'use strict';

const assert = require('node:assert/strict');
const { describe, it, beforeEach, mock } = require('node:test');

const {
  createRateLimiters,
  createPasswordResetRateLimit,
  createAdminWriteRateLimit,
  PICK_SET_LIMIT,
  NOTE_ADD_LIMIT,
  STATUS_UPDATE_LIMIT,
  PRESENCE_UPDATE_LIMIT,
  socketEventLimits,
} = require('../lib/rate-limiting');

// Factory to create minimal deps for createRateLimiters
function makeDeps(overrides = {}) {
  return {
    config: {
      CLUSTER_SIZE: 1,
      RATE_LIMIT_WINDOW: 60000,
      RATE_LIMIT_MAX: 10,
      MAX_RATE_LIMIT_ENTRIES: 10000,
      AUTH_RATE_LIMIT_WINDOW: 300000,
      AUTH_RATE_LIMIT_MAX: 5,
      SOCKET_EVENT_WINDOW: 10000,
      SOCKET_CONNECT_WINDOW: 60000,
      SOCKET_CONNECT_RATE_LIMIT: 30,
      USER_SESSION_COOKIE: 'festie_session',
      ...overrides.config,
    },
    state: {
      rateLimits: new Map(),
      authRateLimits: new Map(),
      adminAuthRateLimits: new Map(),
      routeRateLimits: new Map(),
      socketRateLimits: new Map(),
      socketConnectRateLimits: new Map(),
      userAuthRateLimits: new Map(),
      metrics: { totalRequests: 0, totalErrors: 0 },
      ...overrides.state,
    },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    getRequestIp: (req) => req.ip || '127.0.0.1',
    sendError: mock.fn((res, status, message, code) => {
      res._status = status;
      res._body = { message, code };
      return res;
    }),
    ErrorCodes: { RATE_LIMITED: 'RATE_LIMITED' },
    hashSessionToken: (t) => `hash:${t}`,
    resolveRequestToken: () => ({ token: null }),
    redisRateLimiter: null,
    redisAuthRateLimiter: null,
    redisSocketConnectLimiter: null,
    redis: null,
    redisRateCheck: null,
    ...overrides,
  };
}

// Mock request/response objects
function mockReq(overrides = {}) {
  return { ip: '1.2.3.4', user: null, headers: {}, path: '/api/test', ...overrides };
}

function mockRes() {
  const headers = {};
  return {
    _status: null,
    _body: null,
    _headers: headers,
    setHeader(k, v) { headers[k] = v; },
    set(k, v) { headers[k] = v; },
    status(s) { this._status = s; return this; },
    json(body) { this._body = body; return this; },
  };
}

describe('rate-limiting: createRateLimiters', () => {
  it('returns an object with expected functions', () => {
    const deps = makeDeps();
    const rl = createRateLimiters(deps);
    assert.equal(typeof rl.rateLimit, 'function');
    assert.equal(typeof rl.authRateLimit, 'function');
    assert.equal(typeof rl.adminAuthRateLimit, 'function');
    assert.equal(typeof rl.consumeSocketRateLimit, 'function');
    assert.equal(typeof rl.consumeUserAuthRateLimit, 'function');
    assert.equal(typeof rl.consumeSocketConnectRateLimit, 'function');
    assert.equal(typeof rl._getFallbackStats, 'function');
    assert.equal(typeof rl._getClusterSize, 'function');
  });

  it('reports cluster size 1 by default', () => {
    const deps = makeDeps();
    const rl = createRateLimiters(deps);
    assert.equal(rl._getClusterSize(), 1);
  });

  it('reports cluster size from config', () => {
    const deps = makeDeps({ config: { CLUSTER_SIZE: 4 } });
    const rl = createRateLimiters(deps);
    assert.equal(rl._getClusterSize(), 4);
  });

  it('initializes fallback stats to zero', () => {
    const deps = makeDeps();
    const rl = createRateLimiters(deps);
    const stats = rl._getFallbackStats();
    assert.equal(stats.global, 0);
    assert.equal(stats.scoped, 0);
    assert.equal(stats.auth, 0);
    assert.equal(stats.socket, 0);
  });
});

describe('rate-limiting: rateLimit middleware (global, in-memory fallback)', () => {
  it('allows requests under the limit', async () => {
    const deps = makeDeps();
    const rl = createRateLimiters(deps);
    const middleware = rl.rateLimit();
    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.ok(res._headers['X-RateLimit-Limit']);
    assert.ok(res._headers['X-RateLimit-Remaining']);
  });

  it('blocks requests over the limit', async () => {
    const deps = makeDeps({ config: { RATE_LIMIT_MAX: 2 } });
    const rl = createRateLimiters(deps);
    const middleware = rl.rateLimit();

    // Exhaust the limit
    for (let i = 0; i < 2; i++) {
      await middleware(mockReq(), mockRes(), () => {});
    }
    // Third request should be blocked
    const res = mockRes();
    let nextCalled = false;
    await middleware(mockReq(), res, () => { nextCalled = true; });
    assert.ok(!nextCalled);
    assert.ok(deps.sendError.mock.calls.length > 0);
  });

  it('sets Retry-After header when blocked', async () => {
    const deps = makeDeps({ config: { RATE_LIMIT_MAX: 1 } });
    const rl = createRateLimiters(deps);
    const middleware = rl.rateLimit();

    await middleware(mockReq(), mockRes(), () => {});
    const res = mockRes();
    await middleware(mockReq(), res, () => {});
    assert.ok(res._headers['Retry-After']);
  });

  it('uses userId for rate limit key when user is authenticated', async () => {
    const deps = makeDeps({ config: { RATE_LIMIT_MAX: 1 } });
    const rl = createRateLimiters(deps);
    const middleware = rl.rateLimit();

    // User A uses their limit
    const reqA = mockReq({ user: { userId: 'user-a' } });
    await middleware(reqA, mockRes(), () => {});

    // User B should still be allowed (different key)
    const reqB = mockReq({ user: { userId: 'user-b' } });
    let nextCalled = false;
    await middleware(reqB, mockRes(), () => { nextCalled = true; });
    assert.ok(nextCalled);
  });
});

describe('rate-limiting: scoped rateLimit middleware', () => {
  it('allows requests under scoped limit', async () => {
    const deps = makeDeps();
    const rl = createRateLimiters(deps);
    const middleware = rl.rateLimit(5, 'profiles');
    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('blocks when scoped limit exceeded', async () => {
    const deps = makeDeps();
    const rl = createRateLimiters(deps);
    const middleware = rl.rateLimit(2, 'profiles');

    for (let i = 0; i < 2; i++) {
      await middleware(mockReq(), mockRes(), () => {});
    }
    let nextCalled = false;
    await middleware(mockReq(), mockRes(), () => { nextCalled = true; });
    assert.ok(!nextCalled);
  });
});

describe('rate-limiting: enforceRateLimitMapCap', () => {
  it('evicts oldest entries when map exceeds cap', () => {
    const deps = makeDeps({ config: { MAX_RATE_LIMIT_ENTRIES: 3 } });
    const rl = createRateLimiters(deps);
    const map = new Map();
    map.set('a', { start: 1, count: 1 });
    map.set('b', { start: 2, count: 1 });
    map.set('c', { start: 3, count: 1 });
    map.set('d', { start: 4, count: 1 });
    rl.enforceRateLimitMapCap(map);
    assert.ok(map.size <= 3);
  });
});

describe('rate-limiting: consumeSocketRateLimit', () => {
  it('allows events under the limit', () => {
    const deps = makeDeps();
    const rl = createRateLimiters(deps);
    const allowed = rl.consumeSocketRateLimit('user:u1:pick', 5);
    assert.ok(allowed);
  });

  it('blocks events over the limit', () => {
    const deps = makeDeps();
    const rl = createRateLimiters(deps);
    for (let i = 0; i < 5; i++) {
      rl.consumeSocketRateLimit('user:u1:test', 5);
    }
    const allowed = rl.consumeSocketRateLimit('user:u1:test', 5);
    assert.ok(!allowed);
  });
});

describe('rate-limiting: consumeUserAuthRateLimit', () => {
  it('allows attempts under the limit', () => {
    const deps = makeDeps();
    const rl = createRateLimiters(deps);
    assert.ok(rl.consumeUserAuthRateLimit('user-1', 3));
    assert.ok(rl.consumeUserAuthRateLimit('user-1', 3));
  });

  it('blocks attempts over the limit', () => {
    const deps = makeDeps();
    const rl = createRateLimiters(deps);
    for (let i = 0; i < 3; i++) rl.consumeUserAuthRateLimit('u1', 3);
    assert.ok(!rl.consumeUserAuthRateLimit('u1', 3));
  });
});

describe('rate-limiting: consumeSocketConnectRateLimit', () => {
  it('allows connections under the limit', () => {
    const deps = makeDeps();
    const rl = createRateLimiters(deps);
    assert.ok(rl.consumeSocketConnectRateLimit('10.0.0.1'));
  });

  it('blocks connections over the limit', () => {
    const deps = makeDeps({ config: { SOCKET_CONNECT_RATE_LIMIT: 2 } });
    const rl = createRateLimiters(deps);
    rl.consumeSocketConnectRateLimit('10.0.0.1');
    rl.consumeSocketConnectRateLimit('10.0.0.1');
    assert.ok(!rl.consumeSocketConnectRateLimit('10.0.0.1'));
  });
});

describe('rate-limiting: cluster-aware fallback divisor', () => {
  it('divides effective max by cluster size', async () => {
    const deps = makeDeps({ config: { CLUSTER_SIZE: 4, RATE_LIMIT_MAX: 12 } });
    const rl = createRateLimiters(deps);
    const middleware = rl.rateLimit();

    // 12 / 4 = 3 effective max
    for (let i = 0; i < 3; i++) {
      await middleware(mockReq(), mockRes(), () => {});
    }
    let nextCalled = false;
    await middleware(mockReq(), mockRes(), () => { nextCalled = true; });
    assert.ok(!nextCalled, 'should block after effective max reached');
  });
});

// ── Password reset rate limiter ─────────────────────────────────────────

describe('rate-limiting: createPasswordResetRateLimit', () => {
  it('allows requests under the limit', async () => {
    const limiter = createPasswordResetRateLimit({});
    const req = { body: { email: 'test@example.com' }, query: {} };
    const res = mockRes();
    let nextCalled = false;
    await limiter(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('passes through when email is missing', async () => {
    const limiter = createPasswordResetRateLimit({});
    const req = { body: {}, query: {} };
    let nextCalled = false;
    await limiter(req, mockRes(), () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('blocks after 3 attempts for same email', async () => {
    const log = { warn: mock.fn() };
    const limiter = createPasswordResetRateLimit({}, { log });
    const req = () => ({ body: { email: 'spam@test.com' }, query: {} });

    for (let i = 0; i < 3; i++) {
      await limiter(req(), mockRes(), () => {});
    }
    const res = mockRes();
    let nextCalled = false;
    await limiter(req(), res, () => { nextCalled = true; });
    assert.ok(!nextCalled);
    assert.equal(res._status, 429);
  });

  it('normalizes email to lowercase', async () => {
    const limiter = createPasswordResetRateLimit({});
    const req1 = { body: { email: 'Test@Example.com' }, query: {} };
    const req2 = { body: { email: 'test@example.com' }, query: {} };

    await limiter(req1, mockRes(), () => {});
    await limiter(req2, mockRes(), () => {});

    // Both should count toward the same bucket (2 of 3 used)
    await limiter(req1, mockRes(), () => {});
    // 4th attempt should be blocked
    let nextCalled = false;
    await limiter(req2, mockRes(), () => { nextCalled = true; });
    assert.ok(!nextCalled);
  });
});

// ── Socket event limiters ───────────────────────────────────────────────

describe('rate-limiting: socket event limiters', () => {
  beforeEach(() => {
    PICK_SET_LIMIT._reset();
    NOTE_ADD_LIMIT._reset();
    STATUS_UPDATE_LIMIT._reset();
    PRESENCE_UPDATE_LIMIT._reset();
  });

  it('PICK_SET_LIMIT allows up to 30 events', () => {
    for (let i = 0; i < 30; i++) {
      const r = PICK_SET_LIMIT.consume('user-1');
      assert.ok(r.allowed);
    }
    const r = PICK_SET_LIMIT.consume('user-1');
    assert.ok(!r.allowed);
  });

  it('NOTE_ADD_LIMIT allows up to 20 events', () => {
    for (let i = 0; i < 20; i++) {
      assert.ok(NOTE_ADD_LIMIT.consume('user-1').allowed);
    }
    assert.ok(!NOTE_ADD_LIMIT.consume('user-1').allowed);
  });

  it('each limiter is independent per userId', () => {
    for (let i = 0; i < 30; i++) PICK_SET_LIMIT.consume('user-1');
    // user-2 should still be allowed
    assert.ok(PICK_SET_LIMIT.consume('user-2').allowed);
  });

  it('returns remaining count', () => {
    const r = PICK_SET_LIMIT.consume('user-1');
    assert.equal(r.remaining, 29);
  });

  it('returns resetAt timestamp', () => {
    const r = PICK_SET_LIMIT.consume('user-1');
    assert.ok(r.resetAt > Date.now());
  });

  it('allows events when userId is null', () => {
    const r = PICK_SET_LIMIT.consume(null);
    assert.ok(r.allowed);
  });

  it('socketEventLimits exports all limiters', () => {
    assert.ok(socketEventLimits.PICK_SET_LIMIT);
    assert.ok(socketEventLimits.NOTE_ADD_LIMIT);
    assert.ok(socketEventLimits.STATUS_UPDATE_LIMIT);
    assert.ok(socketEventLimits.PRESENCE_UPDATE_LIMIT);
  });
});

// ── Admin write rate limit ──────────────────────────────────────────────

describe('rate-limiting: createAdminWriteRateLimit', () => {
  it('throws without rateLimiters', () => {
    assert.throws(() => createAdminWriteRateLimit({}, null));
    assert.throws(() => createAdminWriteRateLimit({}, {}));
  });

  it('returns a middleware function', () => {
    const deps = makeDeps();
    const rl = createRateLimiters(deps);
    const middleware = createAdminWriteRateLimit(
      { ADMIN_WRITE_RATE_LIMIT_MAX: 30 },
      rl,
    );
    assert.equal(typeof middleware, 'function');
  });
});
