'use strict';

const assert = require('node:assert/strict');
const { describe, test, mock, beforeEach } = require('node:test');
const express = require('express');
const request = require('supertest');

// ════════════════════════════════════════════════════════════════════════════
// Shared mock factory
// ════════════════════════════════════════════════════════════════════════════

const noop = () => {};
const noopAsync = async () => {};
const noopMw = (_req, _res, next) => next();

function makeLog() {
  return { info: noop, warn: noop, error: noop, debug: noop };
}

function makeIo(overrides = {}) {
  const emitFn = mock.fn();
  return {
    to: () => ({ emit: emitFn }),
    of: () => ({ to: () => ({ emit: emitFn }) }),
    sockets: { adapter: { rooms: new Map() } },
    engine: { clientsCount: 1 },
    on: mock.fn(),
    ...overrides,
    _emit: emitFn,
  };
}

function makePool(queryResult = { rows: [] }) {
  return { query: mock.fn(async () => queryResult) };
}

function baseDeps(overrides = {}) {
  return {
    express,
    config: {
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: 'http://localhost:3000',
      MAX_USERS: 100,
      EMAIL_VERIFY_TOKEN_TTL_HOURS: 24,
      SOCKET_JOIN_RATE_LIMIT: 100,
      SOCKET_LEAVE_RATE_LIMIT: 100,
      MAX_HEAP_BYTES: 2_000_000_000,
      ROOM_CAPACITY_LIMIT: 1000,
      USER_SESSION_COOKIE: 'session',
      APPLE_TEAM_ID: 'ABCDEFGHIJ',
      ANDROID_CERT_FINGERPRINTS: 'AA:BB:CC:DD',
    },
    log: makeLog(),
    sendSuccess: (res, data) => res.json({ ok: true, data }),
    sendError: (res, status, msg, code) => res.status(status).json({ ok: false, code, message: msg, error: msg }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      UNAUTHORIZED: 'UNAUTHORIZED',
      SERVER_ERROR: 'SERVER_ERROR',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
      FORBIDDEN: 'FORBIDDEN',
      ALREADY_EXISTS: 'ALREADY_EXISTS',
      PASSWORD_INCORRECT: 'PASSWORD_INCORRECT',
      RATE_LIMITED: 'RATE_LIMITED',
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      CONFLICT: 'CONFLICT',
    },
    userAuth: (req, _res, next) => { req.user = { userId: 'user-1' }; next(); },
    adminAuth: noopMw,
    rateLimit: () => noopMw,
    validate: () => (req, _res, next) => { req.validatedBody = req.body; next(); },
    validateQuery: () => (req, _res, next) => { req.validatedQuery = req.query; next(); },
    validateParams: () => (req, _res, next) => { req.validatedParams = req.params; next(); },
    schemas: {
      forgotPassword: {},
      resetPasswordPublic: {},
      updateEmail: {},
      crewIdParams: {},
      crewIdMpIdParams: {},
      crewIdPollIdParams: {},
      crewIdExpenseIdParams: {},
      crewHomeBase: {},
      meetingPointCreate: {},
      meetingPointUpdate: {},
      pollCreate: {},
      pollVote: {},
      expenseCreate: {},
      expenseSettleFull: {},
      ratingCreate: {},
      paginationQuery: { parse: () => ({ cursor: null, limit: 20 }) },
    },
    sanitizeString: (s) => (s || '').trim(),
    sanitizeIdentifier: (s) => (s || '').trim(),
    createOpaqueId: () => 'opaque-123',
    io: makeIo(),
    stores: { pool: makePool() },
    pool: makePool(),
    state: {
      onlineUsers: new Map(),
      rateLimits: new Map(),
      metrics: { socketConnections: 0, peakConnections: 0, socketDisconnections: 0, socketErrors: 0 },
      timers: [],
      _adminResetTokens: new Map(),
    },
    emitter: {
      crewExpenseAdded: noop,
      crewExpenseDeleted: noop,
    },
    ...overrides,
  };
}

function mountApp(router, prefix = '') {
  const app = express();
  app.use(express.json());
  app.use(express.text());
  if (prefix) {
    app.use(prefix, router);
  } else {
    app.use(router);
  }
  return app;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. email-auth.js
// ════════════════════════════════════════════════════════════════════════════

describe('routes/email-auth', () => {
  // Mock the external modules that email-auth requires internally
  let createEmailAuthRoutes;

  // We need to handle the internal require of lib/email and lib/reset-pages.
  // These modules exist on disk so they'll load, but their email-sending
  // functions will fail gracefully without valid config.

  function makeEmailTokensStore() {
    return {
      findUserByEmail: mock.fn(async () => null),
      invalidateResetTokens: mock.fn(noopAsync),
      createResetToken: mock.fn(noopAsync),
      findVerificationToken: mock.fn(async () => null),
      markTokenUsed: mock.fn(noopAsync),
      updateUserEmail: mock.fn(noopAsync),
      checkEmailExists: mock.fn(async () => false),
      setEmailUnverified: mock.fn(noopAsync),
      createVerificationToken: mock.fn(noopAsync),
      invalidateVerificationTokens: mock.fn(noopAsync),
      consumeResetToken: mock.fn(async () => null),
    };
  }

  function buildEmailAuthDeps(overrides = {}) {
    const storePool = makePool();
    const emailTokens = makeEmailTokensStore();
    return baseDeps({
      hashPassword: mock.fn(async () => 'hashed-pw'),
      verifyPassword: mock.fn(async () => true),
      validatePasswordStrength: mock.fn(() => true),
      invalidateUserSessions: mock.fn(noopAsync),
      disconnectUserSockets: mock.fn(noop),
      getUserById: mock.fn(async () => ({
        id: 'user-1',
        username: 'alice',
        email: 'alice@test.com',
        emailVerifiedAt: null,
        passwordHash: 'hashed-pw',
      })),
      invalidateUserCache: mock.fn(noop),
      createAuditLog: mock.fn(() => ({ action: 'user_reset_password' })),
      getRequestIp: mock.fn(() => '127.0.0.1'),
      createOpaqueId: () => 'opaque-id',
      _hashSessionToken: mock.fn((t) => t),
      stores: { pool: storePool, users: { update: mock.fn(noopAsync) }, emailTokens },
      pool: storePool,
      ...overrides,
    });
  }

  test('POST /forgot-password — returns success even when user not found (anti-enumeration)', async () => {
    const deps = buildEmailAuthDeps();
    // findUserByEmail returns null by default (user not found)
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/forgot-password')
      .send({ email: 'nobody@test.com' })
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.match(res.body.data.message, /reset link/i);
  });

  test('POST /forgot-password — sends reset email when user exists', async () => {
    const deps = buildEmailAuthDeps();
    deps.stores.emailTokens.findUserByEmail = mock.fn(async () => ({ id: 'user-1', username: 'alice', email: 'alice@test.com' }));
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/forgot-password')
      .send({ email: 'alice@test.com' })
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.ok(deps.stores.emailTokens.invalidateResetTokens.mock.calls.length >= 1);
  });

  test('POST /forgot-password — per-email rate limit kicks in after 3 attempts', async () => {
    const deps = buildEmailAuthDeps();
    deps.stores.emailTokens.findUserByEmail = mock.fn(async () => ({ id: 'u1', username: 'bob', email: 'bob@test.com' }));
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    // First 3 requests pass through the passwordResetRateLimit middleware
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/forgot-password')
        .send({ email: 'ratelimit-test@test.com' })
        .expect(200);
      assert.equal(res.body.ok, true);
    }
    // 4th request exceeds the per-email limiter (3/hour) and gets 429
    const res = await request(app)
      .post('/forgot-password')
      .send({ email: 'ratelimit-test@test.com' })
      .expect(429);
    assert.equal(res.body.ok, false);
  });

  test('POST /forgot-password — returns 500 on unexpected error', async () => {
    const deps = buildEmailAuthDeps();
    deps.stores.emailTokens.findUserByEmail = mock.fn(async () => { throw new Error('DB down'); });
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/forgot-password')
      .send({ email: 'err@test.com' })
      .expect(500);

    assert.equal(res.body.ok, false);
  });

  test('GET /verify-email — rejects invalid token format', async () => {
    const deps = buildEmailAuthDeps();
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .get('/verify-email?token=short')
      .expect(400);

    assert.match(res.text, /invalid/i);
  });

  test('GET /verify-email — rejects missing token', async () => {
    const deps = buildEmailAuthDeps();
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .get('/verify-email')
      .expect(400);

    assert.match(res.text, /invalid/i);
  });

  test('GET /verify-email — returns error for expired/used token', async () => {
    const deps = buildEmailAuthDeps();
    // findVerificationToken returns null by default (expired/used)
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const validHex = 'a'.repeat(64);
    const res = await request(app)
      .get(`/verify-email?token=${validHex}`)
      .expect(400);

    assert.match(res.text, /expired|already been used/i);
  });

  test('GET /verify-email — verifies email successfully', async () => {
    const deps = buildEmailAuthDeps();
    deps.stores.emailTokens.findVerificationToken = mock.fn(async () => ({
      id: 'tok-1', user_id: 'user-1', email: 'verified@test.com',
    }));
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const validHex = 'b'.repeat(64);
    const res = await request(app)
      .get(`/verify-email?token=${validHex}`)
      .expect(200);

    assert.match(res.text, /verified/i);
    assert.ok(deps.invalidateUserCache.mock.calls.length >= 1);
  });

  test('GET /verify-email — returns 500 on DB error', async () => {
    const deps = buildEmailAuthDeps();
    deps.stores.emailTokens.findVerificationToken = mock.fn(async () => { throw new Error('DB fail'); });
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const validHex = 'c'.repeat(64);
    const res = await request(app)
      .get(`/verify-email?token=${validHex}`)
      .expect(500);

    assert.match(res.text, /wrong/i);
  });

  test('POST /update-email — rejects wrong password', async () => {
    const deps = buildEmailAuthDeps();
    deps.verifyPassword = mock.fn(async () => false);
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/update-email')
      .send({ email: 'new@test.com', password: 'wrong' })
      .expect(400);

    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'PASSWORD_INCORRECT');
  });

  test('POST /update-email — rejects already-used email', async () => {
    const deps = buildEmailAuthDeps();
    deps.stores.emailTokens.checkEmailExists = mock.fn(async () => true);
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/update-email')
      .send({ email: 'taken@test.com', password: 'correct' })
      .expect(400);

    assert.equal(res.body.code, 'ALREADY_EXISTS');
  });

  test('POST /update-email — succeeds with valid data', async () => {
    const deps = buildEmailAuthDeps();
    // checkEmailExists returns false by default (email available)
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/update-email')
      .send({ email: 'fresh@test.com', password: 'pass' })
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.match(res.body.data.message, /verification/i);
  });

  test('POST /update-email — 404 when user not found', async () => {
    const deps = buildEmailAuthDeps();
    deps.getUserById = mock.fn(async () => null);
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/update-email')
      .send({ email: 'x@test.com', password: 'p' })
      .expect(404);

    assert.equal(res.body.code, 'NOT_FOUND');
  });

  test('POST /resend-verification — rejects when already verified', async () => {
    const deps = buildEmailAuthDeps();
    deps.getUserById = mock.fn(async () => ({
      id: 'user-1', username: 'alice', email: 'alice@test.com',
      emailVerifiedAt: new Date().toISOString(),
    }));
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/resend-verification')
      .expect(400);

    assert.match(res.body.message, /already verified/i);
  });

  test('POST /resend-verification — rejects when no email on file', async () => {
    const deps = buildEmailAuthDeps();
    deps.getUserById = mock.fn(async () => ({
      id: 'user-1', username: 'alice', email: null,
      emailVerifiedAt: null,
    }));
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/resend-verification')
      .expect(400);

    assert.match(res.body.message, /no email/i);
  });

  test('POST /resend-verification — 404 when user not found', async () => {
    const deps = buildEmailAuthDeps();
    deps.getUserById = mock.fn(async () => null);
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/resend-verification')
      .expect(404);

    assert.equal(res.body.code, 'NOT_FOUND');
  });

  test('POST /resend-verification — succeeds for unverified user', async () => {
    const deps = buildEmailAuthDeps();
    deps.stores.pool.query = mock.fn(async () => ({ rows: [] }));
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/resend-verification')
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.match(res.body.data.message, /verification email sent/i);
  });

  test('POST /reset-password — passwords must match', async () => {
    const deps = buildEmailAuthDeps();
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/reset-password')
      .send({ token: 'abc', newPassword: 'Password1!', confirmPassword: 'Different1!' })
      .expect(400);

    assert.equal(res.body.ok, false);
    assert.match(res.body.message, /do not match/i);
  });

  test('POST /reset-password — rejects weak password', async () => {
    const deps = buildEmailAuthDeps();
    deps.validatePasswordStrength = mock.fn(() => false);
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/reset-password')
      .send({ token: 'abc', newPassword: 'short', confirmPassword: 'short' })
      .expect(400);

    assert.match(res.body.message, /8-100 characters/i);
  });

  test('POST /reset-password — rejects invalid/expired token', async () => {
    const deps = buildEmailAuthDeps();
    // No admin token, no DB token
    deps.pool.query = mock.fn(async () => ({ rows: [] }));
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/reset-password')
      .send({ token: 'bad-token', newPassword: 'StrongPass1!', confirmPassword: 'StrongPass1!' })
      .expect(400);

    assert.match(res.body.message, /invalid or expired/i);
  });

  test('POST /reset-password — succeeds with valid DB token', async () => {
    const deps = buildEmailAuthDeps();
    deps.pool.query = mock.fn(async () => ({ rows: [{ user_id: 'user-1' }] }));
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/reset-password')
      .send({ token: 'valid-token', newPassword: 'StrongPass1!', confirmPassword: 'StrongPass1!' })
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.ok(deps.invalidateUserSessions.mock.calls.length >= 1);
    assert.ok(deps.disconnectUserSockets.mock.calls.length >= 1);
  });

  test('POST /reset-password — succeeds with admin in-memory token', async () => {
    const deps = buildEmailAuthDeps();
    deps.state._adminResetTokens.set('admin-tok', { userId: 'user-1', expiresAt: Date.now() + 60_000 });
    deps.pool.query = mock.fn(async () => ({ rows: [] }));
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/reset-password')
      .send({ token: 'admin-tok', newPassword: 'StrongPass1!', confirmPassword: 'StrongPass1!' })
      .expect(200);

    assert.equal(res.body.ok, true);
    // Token should be deleted after use
    assert.equal(deps.state._adminResetTokens.has('admin-tok'), false);
  });

  test('POST /reset-password — rejects expired admin token', async () => {
    const deps = buildEmailAuthDeps();
    deps.state._adminResetTokens.set('expired-tok', { userId: 'user-1', expiresAt: Date.now() - 1000 });
    deps.pool.query = mock.fn(async () => ({ rows: [] }));
    createEmailAuthRoutes = require('../routes/email-auth');
    const router = createEmailAuthRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/reset-password')
      .send({ token: 'expired-tok', newPassword: 'StrongPass1!', confirmPassword: 'StrongPass1!' })
      .expect(400);

    assert.match(res.body.message, /expired/i);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 2. socket.js
// ════════════════════════════════════════════════════════════════════════════

describe('routes/socket', () => {
  function buildSocketDeps(overrides = {}) {
    return {
      config: {
        NODE_ENV: 'test',
        SOCKET_JOIN_RATE_LIMIT: 100,
        SOCKET_LEAVE_RATE_LIMIT: 100,
        MAX_HEAP_BYTES: 2_000_000_000,
        ROOM_CAPACITY_LIMIT: 1000,
        USER_SESSION_COOKIE: 'session',
      },
      log: makeLog(),
      state: {
        metrics: { socketConnections: 0, peakConnections: 0, socketDisconnections: 0, socketErrors: 0 },
      },
      io: makeIo(),
      _sanitizeString: (s) => (s || '').trim(),
      _createOpaqueId: () => 'opaque-sock-id',
      resolveSocketToken: mock.fn(() => 'session-tok'),
      validateUserSession: mock.fn(async () => ({ userId: 'user-1', username: 'alice' })),
      getFestivalById: mock.fn(async () => ({ id: 'fest-1', name: 'TestFest' })),
      getUserFestivalProfile: mock.fn(async () => ({ id: 'profile-1' })),
      _getUserById: mock.fn(async () => ({ id: 'user-1', username: 'alice' })),
      _buildAvatarUrl: mock.fn(() => '/avatar.png'),
      _emitter: { emit: noop },
      stores: { crews: { getById: mock.fn(async () => ({ id: 'crew-1' })), getMember: mock.fn(async () => ({ role: 'member' })) } },
      removeSocketPresence: mock.fn(noop),
      getPresenceList: mock.fn(async () => []),
      clearSocketSession: mock.fn(noop),
      leaveFestivalRealtime: mock.fn(() => null),
      disconnectSocket: mock.fn(noop),
      consumeSocketRateLimit: mock.fn(() => true),
      emitPresence: mock.fn(noop),
      setSocketPresence: mock.fn(async () => {}),
      ...overrides,
    };
  }

  function makeSocket(dataOverrides = {}) {
    const rooms = new Set(['socket-1']);
    return {
      id: 'socket-1',
      data: { connectionId: null, ...dataOverrides },
      handshake: { headers: {} },
      rooms,
      join: mock.fn((room) => rooms.add(room)),
      leave: mock.fn((room) => rooms.delete(room)),
      emit: mock.fn(),
      on: mock.fn(),
      authenticated: false,
    };
  }

  function setupAndGetHandlers(deps) {
    const setupSocketHandlers = require('../routes/socket');
    const io = deps.io;
    const handlers = {};

    io.on = mock.fn((event, handler) => {
      handlers[event] = handler;
    });

    setupSocketHandlers(deps);
    return handlers;
  }

  test('registers connection handler on io', () => {
    const deps = buildSocketDeps();
    const handlers = setupAndGetHandlers(deps);
    assert.ok(handlers.connection, 'should register a connection handler');
  });

  test('connection handler sets connectionId on socket.data', () => {
    const deps = buildSocketDeps();
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    assert.ok(socket.data.connectionId, 'should assign connectionId');
    assert.ok(deps.state.metrics.socketConnections >= 1);
  });

  test('join:festival — authenticates and joins room', async () => {
    const deps = buildSocketDeps();
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    const ack = mock.fn();
    await socketHandlers['join:festival']('fest-1', {}, ack);

    assert.ok(ack.mock.calls.length >= 1);
    const response = ack.mock.calls[0].arguments[0];
    assert.equal(response.ok, true);
    assert.equal(response.profileId, 'profile-1');
  });

  test('join:festival — rejects when session invalid', async () => {
    const deps = buildSocketDeps();
    deps.validateUserSession = mock.fn(async () => null);
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    const ack = mock.fn();
    await socketHandlers['join:festival']('fest-1', {}, ack);

    const response = ack.mock.calls[0].arguments[0];
    assert.equal(response.ok, false);
    assert.match(response.error, /authentication/i);
  });

  test('join:festival — rejects when festival not found', async () => {
    const deps = buildSocketDeps();
    deps.getFestivalById = mock.fn(async () => null);
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    const ack = mock.fn();
    await socketHandlers['join:festival']('fest-missing', {}, ack);

    const response = ack.mock.calls[0].arguments[0];
    assert.equal(response.ok, false);
    assert.match(response.error, /not found/i);
  });

  test('join:festival — rejects when not a member', async () => {
    const deps = buildSocketDeps();
    deps.getUserFestivalProfile = mock.fn(async () => null);
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    const ack = mock.fn();
    await socketHandlers['join:festival']('fest-1', {}, ack);

    const response = ack.mock.calls[0].arguments[0];
    assert.equal(response.ok, false);
    assert.match(response.error, /not a member/i);
  });

  test('join:festival — handles ack as second arg (no data)', async () => {
    const deps = buildSocketDeps();
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    const ack = mock.fn();
    // Call with (festivalId, ack) — no data object
    await socketHandlers['join:festival']('fest-1', ack);

    assert.ok(ack.mock.calls.length >= 1);
    const response = ack.mock.calls[0].arguments[0];
    assert.equal(response.ok, true);
  });

  test('join:festival — rate limit rejection', async () => {
    const deps = buildSocketDeps();
    deps.consumeSocketRateLimit = mock.fn(() => false);
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    const ack = mock.fn();
    await socketHandlers['join:festival']('fest-1', {}, ack);

    const response = ack.mock.calls[0].arguments[0];
    assert.equal(response.ok, false);
    assert.match(response.error, /rate limit/i);
  });

  test('leave:festival — leaves room and emits presence', () => {
    const deps = buildSocketDeps();
    deps.leaveFestivalRealtime = mock.fn(() => 'fest-1');
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);
    socketHandlers['leave:festival']();

    assert.ok(deps.leaveFestivalRealtime.mock.calls.length >= 1);
    assert.ok(deps.emitPresence.mock.calls.length >= 1);
  });

  test('leave:festival — rate limit rejection', () => {
    const deps = buildSocketDeps();
    deps.consumeSocketRateLimit = mock.fn(() => false);
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);
    socket.data.userId = 'user-1';
    socketHandlers['leave:festival']();

    // Should have emitted an error
    assert.ok(socket.emit.mock.calls.length >= 1);
  });

  test('join:crew — authenticates and joins crew room', async () => {
    const deps = buildSocketDeps();
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    const ack = mock.fn();
    await socketHandlers['join:crew']({ crewId: 'crew-1' }, ack);

    const response = ack.mock.calls[0].arguments[0];
    assert.equal(response.ok, true);
    assert.equal(response.crewId, 'crew-1');
  });

  test('join:crew — rejects when crew not found', async () => {
    const deps = buildSocketDeps();
    deps.stores.crews.getById = mock.fn(async () => null);
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    const ack = mock.fn();
    await socketHandlers['join:crew']({ crewId: 'missing' }, ack);

    const response = ack.mock.calls[0].arguments[0];
    assert.equal(response.ok, false);
    assert.match(response.error, /not found/i);
  });

  test('join:crew — rejects when not a crew member', async () => {
    const deps = buildSocketDeps();
    deps.stores.crews.getMember = mock.fn(async () => null);
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    const ack = mock.fn();
    await socketHandlers['join:crew']({ crewId: 'crew-1' }, ack);

    const response = ack.mock.calls[0].arguments[0];
    assert.equal(response.ok, false);
    assert.match(response.error, /not a member/i);
  });

  test('leave:crew — leaves crew room', async () => {
    const deps = buildSocketDeps();
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);
    socket.data.crewId = 'crew-1';
    socket.data.userSessionToken = 'tok';

    await socketHandlers['leave:crew']({ crewId: 'crew-1' });

    assert.ok(socket.leave.mock.calls.length >= 1);
  });

  test('reconnect:restore — re-authenticates and restores state', async () => {
    const deps = buildSocketDeps();
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    const ack = mock.fn();
    await socketHandlers['reconnect:restore']({ festivalId: 'fest-1' }, ack);

    const response = ack.mock.calls[0].arguments[0];
    assert.equal(response.ok, true);
    assert.equal(response.profileId, 'profile-1');
  });

  test('reconnect:restore — rejects invalid session', async () => {
    const deps = buildSocketDeps();
    deps.validateUserSession = mock.fn(async () => null);
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    const ack = mock.fn();
    await socketHandlers['reconnect:restore']({ festivalId: 'fest-1' }, ack);

    const response = ack.mock.calls[0].arguments[0];
    assert.equal(response.ok, false);
  });

  test('disconnect — cleans up presence and metrics', () => {
    const deps = buildSocketDeps();
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);
    socket.data.festivalId = 'fest-1';

    socketHandlers.disconnect('transport close');

    assert.ok(deps.removeSocketPresence.mock.calls.length >= 1);
    assert.ok(deps.clearSocketSession.mock.calls.length >= 1);
    assert.ok(deps.emitPresence.mock.calls.length >= 1);
    assert.ok(deps.state.metrics.socketDisconnections >= 1);
    assert.ok(deps.state.metrics.socketErrors >= 1);
  });

  test('disconnect — handles disconnect without festivalId', () => {
    const deps = buildSocketDeps();
    const handlers = setupAndGetHandlers(deps);
    const socket = makeSocket();
    const socketHandlers = {};
    socket.on = mock.fn((event, handler) => { socketHandlers[event] = handler; });

    handlers.connection(socket);

    socketHandlers.disconnect('client namespace disconnect');

    assert.ok(deps.removeSocketPresence.mock.calls.length >= 1);
    // emitPresence should NOT be called if no festivalId
    assert.equal(deps.emitPresence.mock.calls.length, 0);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 3. crew-features.js
// ════════════════════════════════════════════════════════════════════════════

describe('routes/crew-features', () => {
  function buildCrewFeaturesDeps(overrides = {}) {
    return baseDeps({
      stores: {
        pool: makePool(),
        crews: {
          getMember: mock.fn(async () => ({ role: 'owner', userId: 'user-1' })),
          updateHomeBase: mock.fn(async () => ({ id: 'crew-1', homeBase: 'Main Stage' })),
          meetingPoints: {
            listByCrew: mock.fn(async () => [{ id: 'mp-1', label: 'Gate A' }]),
            countByCrew: mock.fn(async () => 2),
            create: mock.fn(async (data) => ({ ...data })),
            getById: mock.fn(async () => ({ id: 'mp-1', crewId: 'crew-1', createdBy: 'user-1', active: true })),
            update: mock.fn(async (id, data) => ({ id, ...data })),
            deactivate: mock.fn(noopAsync),
          },
        },
        polls: {
          listByCrew: mock.fn(async () => []),
          countActiveByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data) => ({ id: 'poll-1', ...data })),
          getById: mock.fn(async () => ({ id: 'poll-1', crew_id: 'crew-1', created_by: 'user-1', options: ['A', 'B'] })),
          vote: mock.fn(noopAsync),
          close: mock.fn(async () => ({ id: 'poll-1', closedAt: new Date() })),
        },
        activity: {
          log: mock.fn(noopAsync),
        },
      },
      ...overrides,
    });
  }

  function mountCrewFeatures(deps) {
    const mountCrewFeaturesFactory = require('../routes/crew-features');
    const router = express.Router();
    mountCrewFeaturesFactory(router, deps);
    return mountApp(router);
  }

  test('PUT /:crewId/home-base — sets home base for owner', async () => {
    const deps = buildCrewFeaturesDeps();
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .put('/crew-1/home-base')
      .send({ location: 'Main Stage', time: '14:00' })
      .expect(200);

    assert.equal(res.body.ok, true);
  });

  test('PUT /:crewId/home-base — rejects non-member', async () => {
    const deps = buildCrewFeaturesDeps();
    deps.stores.crews.getMember = mock.fn(async () => null);
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .put('/crew-1/home-base')
      .send({ location: 'Stage A' })
      .expect(403);

    assert.equal(res.body.code, 'FORBIDDEN');
  });

  test('PUT /:crewId/home-base — rejects non-owner', async () => {
    const deps = buildCrewFeaturesDeps();
    deps.stores.crews.getMember = mock.fn(async () => ({ role: 'member' }));
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .put('/crew-1/home-base')
      .send({ location: 'Stage B' })
      .expect(403);

    assert.match(res.body.message, /owner/i);
  });

  test('GET /:crewId/meeting-points — lists meeting points', async () => {
    const deps = buildCrewFeaturesDeps();
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .get('/crew-1/meeting-points')
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data.meetingPoints));
  });

  test('GET /:crewId/meeting-points — rejects non-member', async () => {
    const deps = buildCrewFeaturesDeps();
    deps.stores.crews.getMember = mock.fn(async () => null);
    const app = mountCrewFeatures(deps);

    await request(app).get('/crew-1/meeting-points').expect(403);
  });

  test('POST /:crewId/meeting-points — creates a meeting point', async () => {
    const deps = buildCrewFeaturesDeps();
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Water Station', location: 'Near stage 3', type: 'during' })
      .expect(200);

    assert.equal(res.body.ok, true);
  });

  test('POST /:crewId/meeting-points — rejects when at max capacity', async () => {
    const deps = buildCrewFeaturesDeps();
    deps.stores.crews.meetingPoints.countByCrew = mock.fn(async () => 20);
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Extra', location: 'Somewhere' })
      .expect(400);

    assert.match(res.body.message, /maximum/i);
  });

  test('PUT /:crewId/meeting-points/:mpId — updates meeting point', async () => {
    const deps = buildCrewFeaturesDeps();
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .put('/crew-1/meeting-points/mp-1')
      .send({ label: 'Updated Location' })
      .expect(200);

    assert.equal(res.body.ok, true);
  });

  test('PUT /:crewId/meeting-points/:mpId — 404 when not found', async () => {
    const deps = buildCrewFeaturesDeps();
    deps.stores.crews.meetingPoints.getById = mock.fn(async () => null);
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .put('/crew-1/meeting-points/mp-missing')
      .send({ label: 'Nope' })
      .expect(404);

    assert.equal(res.body.code, 'NOT_FOUND');
  });

  test('PUT /:crewId/meeting-points/:mpId — rejects non-creator non-owner', async () => {
    const deps = buildCrewFeaturesDeps();
    deps.stores.crews.getMember = mock.fn(async () => ({ role: 'member' }));
    deps.stores.crews.meetingPoints.getById = mock.fn(async () => ({ id: 'mp-1', crewId: 'crew-1', createdBy: 'other-user', active: true }));
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .put('/crew-1/meeting-points/mp-1')
      .send({ label: 'Hacked' })
      .expect(403);

    assert.match(res.body.message, /creator or crew owner/i);
  });

  test('DELETE /:crewId/meeting-points/:mpId — deactivates meeting point', async () => {
    const deps = buildCrewFeaturesDeps();
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .delete('/crew-1/meeting-points/mp-1')
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.removed, true);
  });

  test('DELETE /:crewId/meeting-points/:mpId — 404 when inactive', async () => {
    const deps = buildCrewFeaturesDeps();
    deps.stores.crews.meetingPoints.getById = mock.fn(async () => ({ id: 'mp-1', crewId: 'crew-1', createdBy: 'user-1', active: false }));
    const app = mountCrewFeatures(deps);

    await request(app).delete('/crew-1/meeting-points/mp-1').expect(404);
  });

  test('GET /:crewId/polls — lists polls', async () => {
    const deps = buildCrewFeaturesDeps();
    const app = mountCrewFeatures(deps);

    const res = await request(app).get('/crew-1/polls').expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data.polls));
  });

  test('POST /:crewId/polls — creates a poll', async () => {
    const deps = buildCrewFeaturesDeps();
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Which stage?', options: ['A', 'B'], closesAt: null })
      .expect(200);

    assert.equal(res.body.ok, true);
  });

  test('POST /:crewId/polls — rejects when 3 active polls exist', async () => {
    const deps = buildCrewFeaturesDeps();
    deps.stores.polls.countActiveByCrew = mock.fn(async () => 3);
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Too many?', options: ['Yes'] })
      .expect(409);

    assert.match(res.body.message, /max 3/i);
  });

  test('POST /:crewId/polls/:pollId/vote — votes on poll', async () => {
    const deps = buildCrewFeaturesDeps();
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 })
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.voted, true);
  });

  test('POST /:crewId/polls/:pollId/vote — rejects invalid option index', async () => {
    const deps = buildCrewFeaturesDeps();
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 99 })
      .expect(400);

    assert.match(res.body.message, /invalid option/i);
  });

  test('DELETE /:crewId/polls/:pollId — closes poll', async () => {
    const deps = buildCrewFeaturesDeps();
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .delete('/crew-1/polls/poll-1')
      .expect(200);

    assert.equal(res.body.ok, true);
  });

  test('DELETE /:crewId/polls/:pollId — rejects non-creator non-owner', async () => {
    const deps = buildCrewFeaturesDeps();
    deps.stores.crews.getMember = mock.fn(async () => ({ role: 'member' }));
    deps.stores.polls.getById = mock.fn(async () => ({ id: 'poll-1', crew_id: 'crew-1', created_by: 'other-user', options: ['A'] }));
    const app = mountCrewFeatures(deps);

    const res = await request(app)
      .delete('/crew-1/polls/poll-1')
      .expect(403);

    assert.match(res.body.message, /creator or owner/i);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 4. expenses.js
// ════════════════════════════════════════════════════════════════════════════

describe('routes/expenses', () => {
  function buildExpenseDeps(overrides = {}) {
    return baseDeps({
      stores: {
        pool: makePool(),
        crews: {
          getMember: mock.fn(async () => ({ role: 'member', userId: 'user-1' })),
        },
        expenses: {
          getByCrew: mock.fn(async () => [{ id: 'exp-1', amount: 25.50 }]),
          create: mock.fn(async (data) => ({ id: 'exp-new', ...data })),
          getById: mock.fn(async () => ({ id: 'exp-1', crew_id: 'crew-1', paid_by: 'user-1', amount: 25.50 })),
          delete: mock.fn(noopAsync),
          getBalances: mock.fn(async () => ({ balances: [] })),
        },
        activity: { log: mock.fn(noopAsync) },
      },
      ...overrides,
    });
  }

  function mountExpenses(deps) {
    const createExpenseRoutes = require('../routes/expenses');
    const router = createExpenseRoutes(deps);
    return mountApp(router);
  }

  test('GET /crews/:crewId/expenses — lists expenses', async () => {
    const deps = buildExpenseDeps();
    const app = mountExpenses(deps);

    const res = await request(app).get('/crews/crew-1/expenses').expect(200);
    assert.equal(res.body.ok, true);
  });

  test('GET /crews/:crewId/expenses — rejects non-member', async () => {
    const deps = buildExpenseDeps();
    deps.stores.crews.getMember = mock.fn(async () => null);
    const app = mountExpenses(deps);

    await request(app).get('/crews/crew-1/expenses').expect(403);
  });

  test('POST /crews/:crewId/expenses — creates expense', async () => {
    const deps = buildExpenseDeps();
    const app = mountExpenses(deps);

    const res = await request(app)
      .post('/crews/crew-1/expenses')
      .send({ description: 'Pizza', amount: 24.99, splitWith: ['user-2'], category: 'food' })
      .expect(200);

    assert.equal(res.body.ok, true);
  });

  test('DELETE /crews/:crewId/expenses/:expenseId — deletes expense by payer', async () => {
    const deps = buildExpenseDeps();
    const app = mountExpenses(deps);

    const res = await request(app)
      .delete('/crews/crew-1/expenses/exp-1')
      .expect(200);

    assert.equal(res.body.data.deleted, true);
  });

  test('DELETE /crews/:crewId/expenses/:expenseId — rejects non-payer', async () => {
    const deps = buildExpenseDeps();
    deps.stores.expenses.getById = mock.fn(async () => ({ id: 'exp-1', crew_id: 'crew-1', paid_by: 'other-user' }));
    const app = mountExpenses(deps);

    await request(app).delete('/crews/crew-1/expenses/exp-1').expect(403);
  });

  test('DELETE /crews/:crewId/expenses/:expenseId — 404 when not found', async () => {
    const deps = buildExpenseDeps();
    deps.stores.expenses.getById = mock.fn(async () => null);
    const app = mountExpenses(deps);

    await request(app).delete('/crews/crew-1/expenses/exp-1').expect(404);
  });

  test('GET /crews/:crewId/expenses/balances — returns balances', async () => {
    const deps = buildExpenseDeps();
    const app = mountExpenses(deps);

    const res = await request(app).get('/crews/crew-1/expenses/balances').expect(200);
    assert.equal(res.body.ok, true);
  });

  test('POST /crews/:crewId/expenses/settle — creates settlement', async () => {
    const deps = buildExpenseDeps();
    const app = mountExpenses(deps);

    const res = await request(app)
      .post('/crews/crew-1/expenses/settle')
      .send({ toUserId: 'user-2', amount: 15.00 })
      .expect(200);

    assert.equal(res.body.ok, true);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 5. ratings.js
// ════════════════════════════════════════════════════════════════════════════

describe('routes/ratings', () => {
  function buildRatingDeps(overrides = {}) {
    return baseDeps({
      stores: {
        pool: {
          query: mock.fn(async () => ({ rows: [{ id: 'set-a', festival_id: 'fest-1' }] })),
        },
        ratings: {
          upsert: mock.fn(async (userId, setId, rating, note) => ({ userId, setId, rating, note })),
          delete: mock.fn(noopAsync),
          getByUser: mock.fn(async () => []),
          getByFestival: mock.fn(async () => ({ items: [], nextCursor: null })),
          getCrewRatings: mock.fn(async () => ({ items: [], nextCursor: null })),
          getWrapStats: mock.fn(async () => ({ total: 5, avgRating: 4.2 })),
        },
      },
      ...overrides,
    });
  }

  function mountRatings(deps) {
    const { createRatingsRoutes } = require('../routes/ratings');
    const router = createRatingsRoutes(deps);
    return mountApp(router);
  }

  test('POST /:setId — creates a rating', async () => {
    const deps = buildRatingDeps();
    const app = mountRatings(deps);

    const res = await request(app)
      .post('/set-a')
      .send({ rating: 5, note: 'Great!' })
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.rating, 5);
  });

  test('POST /:setId — 404 when set not found', async () => {
    const deps = buildRatingDeps();
    deps.stores.pool.query = mock.fn(async () => ({ rows: [] }));
    const app = mountRatings(deps);

    const res = await request(app)
      .post('/set-missing')
      .send({ rating: 3 })
      .expect(404);

    assert.equal(res.body.code, 'NOT_FOUND');
  });

  test('DELETE /:setId — deletes a rating', async () => {
    const deps = buildRatingDeps();
    const app = mountRatings(deps);

    const res = await request(app).delete('/set-a').expect(200);
    assert.equal(res.body.data.deleted, true);
  });

  test('GET /festival/:festivalId — returns user ratings', async () => {
    const deps = buildRatingDeps();
    const app = mountRatings(deps);

    const res = await request(app).get('/festival/fest-1').expect(200);
    assert.ok(Array.isArray(res.body.data.ratings));
  });

  test('GET /festival/:festivalId/all — returns aggregate ratings (no auth)', async () => {
    const deps = buildRatingDeps();
    // Remove userAuth for this test — the route is public
    const { createRatingsRoutes } = require('../routes/ratings');
    const router = createRatingsRoutes(deps);
    const app = mountApp(router);

    const res = await request(app).get('/festival/fest-1/all').expect(200);
    assert.ok(Array.isArray(res.body.data.ratings));
  });

  test('GET /crew/:crewId/festival/:festivalId — returns crew ratings', async () => {
    const deps = buildRatingDeps();
    const app = mountRatings(deps);

    const res = await request(app).get('/crew/crew-1/festival/fest-1').expect(200);
    assert.ok(Array.isArray(res.body.data.ratings));
  });

  test('GET /wrap/:festivalId — returns wrap stats', async () => {
    const deps = buildRatingDeps();
    deps.stores.ratings.getByUser = mock.fn(async () => [
      { rating: 5, setId: 's1' },
      { rating: 4, setId: 's2' },
      { rating: 2, setId: 's3' },
    ]);
    const app = mountRatings(deps);

    const res = await request(app).get('/wrap/fest-1').expect(200);
    assert.ok(res.body.data.stats);
    assert.ok(Array.isArray(res.body.data.topSets));
    assert.ok(Array.isArray(res.body.data.allRatings));
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 6. calendar-sync.js
// ════════════════════════════════════════════════════════════════════════════

describe('routes/calendar-sync', () => {
  function buildCalDeps(overrides = {}) {
    return baseDeps({
      stores: {
        pool: makePool(),
        profiles: {
          readByUserAndFestival: mock.fn(async () => [{ id: 'prof-1', picks: { 'set-a': 'must-see' }, notes: {} }]),
          getById: mock.fn(async () => ({ id: 'prof-1', picks: { 'set-a': 'must-see' }, notes: {} })),
        },
        calendarTokens: {
          getOrCreate: mock.fn(async () => ({ id: 'cal-tok-1' })),
          getByToken: mock.fn(async () => ({ id: 'cal-tok-1', festival_id: 'fest-1', profile_id: 'prof-1', user_id: 'user-1' })),
        },
        festivals: {
          getById: mock.fn(async () => ({
            id: 'fest-1',
            name: 'Test Fest',
            location: 'Miami',
            stages: [{ id: 'stage-1', name: 'Main Stage' }],
            days: [{
              label: 'Day 1',
              date: '2026-06-01',
              sets: [{ id: 'set-a', artist: 'DJ Test', stageId: 'stage-1', startTime: '14:00', endTime: '15:30' }],
            }],
          })),
        },
      },
      ...overrides,
    });
  }

  test('POST /calendar-sync/:festivalId — generates sync URL', async () => {
    const deps = buildCalDeps();
    const createCalendarSyncRoutes = require('../routes/calendar-sync');
    const router = createCalendarSyncRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/calendar-sync/fest-1')
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.match(res.body.data.url, /\.ics$/);
  });

  test('POST /calendar-sync/:festivalId — 404 when no profile', async () => {
    const deps = buildCalDeps();
    deps.stores.profiles.readByUserAndFestival = mock.fn(async () => []);
    const createCalendarSyncRoutes = require('../routes/calendar-sync');
    const router = createCalendarSyncRoutes(deps);
    const app = mountApp(router);

    const res = await request(app)
      .post('/calendar-sync/fest-1')
      .expect(404);

    assert.equal(res.body.code, 'NOT_FOUND');
  });

  test('GET /cal/:token.ics — returns ICS feed', async () => {
    const deps = buildCalDeps();
    const { createCalendarFeedRoute } = require('../routes/calendar-sync');
    const feedRouter = createCalendarFeedRoute(deps);
    const app = mountApp(feedRouter);

    const res = await request(app)
      .get('/cal/cal-tok-1.ics')
      .expect(200);

    assert.match(res.headers['content-type'], /text\/calendar/);
    assert.match(res.text, /BEGIN:VCALENDAR/);
    assert.match(res.text, /DJ Test/);
    assert.match(res.text, /END:VCALENDAR/);
  });

  test('GET /cal/:token.ics — 404 when token not found', async () => {
    const deps = buildCalDeps();
    deps.stores.calendarTokens.getByToken = mock.fn(async () => null);
    const { createCalendarFeedRoute } = require('../routes/calendar-sync');
    const feedRouter = createCalendarFeedRoute(deps);
    const app = mountApp(feedRouter);

    await request(app).get('/cal/bad-tok.ics').expect(404);
  });

  test('GET /cal/:token.ics — 400 when token too long', async () => {
    const deps = buildCalDeps();
    const { createCalendarFeedRoute } = require('../routes/calendar-sync');
    const feedRouter = createCalendarFeedRoute(deps);
    const app = mountApp(feedRouter);

    const longToken = 'x'.repeat(51);
    await request(app).get(`/cal/${longToken}.ics`).expect(400);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 7. lineup-import.js
// ════════════════════════════════════════════════════════════════════════════

describe('routes/lineup-import', () => {
  function buildLineupDeps(overrides = {}) {
    const storePool = makePool();
    return baseDeps({
      adminAuth: noopMw,
      setNoStore: noop,
      getFestivalById: mock.fn(async () => ({
        id: 'fest-1',
        name: 'Test Fest',
        stages: [{ id: 'stage-1', name: 'Main Stage' }],
        days: [{ label: 'Day 1', date: '2026-06-01', sets: [] }],
      })),
      invalidateFestivalCache: mock.fn(noop),
      getRequestIp: () => '127.0.0.1',
      stores: {
        pool: storePool,
        festivals: { insertSets: mock.fn(async () => {}) },
      },
      pool: storePool,
      config: {
        ...baseDeps().config,
        SPOTIFY_CLIENT_ID: null,
        SPOTIFY_CLIENT_SECRET: null,
      },
      ...overrides,
    });
  }

  function mountLineup(deps) {
    const createLineupImportRoute = require('../routes/lineup-import');
    const router = createLineupImportRoute(deps);
    return mountApp(router);
  }

  test('POST /:id/import-lineup — imports CSV data', async () => {
    const deps = buildLineupDeps();
    const app = mountLineup(deps);

    const csvText = 'artist,stage,day,start,end\nDJ Test,Main Stage,Day 1,14:00,15:00\nDJ Two,Main Stage,Day 1,16:00,17:00';

    const res = await request(app)
      .post('/fest-1/import-lineup')
      .send({ text: csvText, format: 'auto' })
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.imported, 2);
  });

  test('POST /:id/import-lineup — imports TSV data', async () => {
    const deps = buildLineupDeps();
    const app = mountLineup(deps);

    const tsvText = 'DJ Tab\tMain Stage\tDay 1\t14:00\t15:00';

    const res = await request(app)
      .post('/fest-1/import-lineup')
      .send({ text: tsvText, format: 'tsv' })
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.imported, 1);
  });

  test('POST /:id/import-lineup — rejects empty text', async () => {
    const deps = buildLineupDeps();
    const app = mountLineup(deps);

    await request(app)
      .post('/fest-1/import-lineup')
      .send({ text: '', format: 'auto' })
      .expect(400);
  });

  test('POST /:id/import-lineup — 404 when festival not found', async () => {
    const deps = buildLineupDeps();
    deps.getFestivalById = mock.fn(async () => null);
    const app = mountLineup(deps);

    const res = await request(app)
      .post('/fest-1/import-lineup')
      .send({ text: 'DJ X,Stage,Day 1,14:00,15:00', format: 'csv' })
      .expect(404);

    assert.equal(res.body.code, 'NOT_FOUND');
  });

  test('POST /:id/import-lineup — normalizes 12hr time to 24hr', async () => {
    const deps = buildLineupDeps();
    const app = mountLineup(deps);

    const csvText = 'DJ PM,Main Stage,Day 1,2:00 PM,3:30 PM';

    const res = await request(app)
      .post('/fest-1/import-lineup')
      .send({ text: csvText, format: 'csv' })
      .expect(200);

    const sets = res.body.data.sets;
    assert.equal(sets[0].startTime, '14:00');
    assert.equal(sets[0].endTime, '15:30');
  });

  test('POST /:id/import-lineup — warns on unknown stage', async () => {
    const deps = buildLineupDeps();
    const app = mountLineup(deps);

    const csvText = 'DJ X,Unknown Stage,Day 1,14:00,15:00';

    const res = await request(app)
      .post('/fest-1/import-lineup')
      .send({ text: csvText, format: 'csv' })
      .expect(200);

    assert.ok(res.body.data.warnings.length > 0);
    assert.match(res.body.data.warnings[0], /unknown stage/i);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 8. weather.js
// ════════════════════════════════════════════════════════════════════════════

describe('routes/weather', () => {
  function buildWeatherDeps(overrides = {}) {
    return baseDeps({
      stores: {
        pool: {
          query: mock.fn(async () => ({
            rows: [{ latitude: 25.76, longitude: -80.19, name: 'Ultra Miami' }],
          })),
        },
      },
      ...overrides,
    });
  }

  function mountWeather(deps) {
    const { createWeatherRoutes } = require('../routes/weather');
    const router = createWeatherRoutes(deps);
    return mountApp(router);
  }

  test('GET /:festivalId — 404 when festival not found', async () => {
    const deps = buildWeatherDeps();
    deps.stores.pool.query = mock.fn(async () => ({ rows: [] }));
    const app = mountWeather(deps);

    await request(app).get('/fest-missing').expect(404);
  });

  test('GET /:festivalId — returns unavailable when no coordinates', async () => {
    const deps = buildWeatherDeps();
    deps.stores.pool.query = mock.fn(async () => ({
      rows: [{ latitude: null, longitude: null, name: 'No Coords Fest' }],
    }));
    const app = mountWeather(deps);

    const res = await request(app).get('/fest-1').expect(200);
    assert.equal(res.body.data.available, false);
    assert.match(res.body.data.reason, /no coordinates/i);
  });

  test('GET /:festivalId — handles fetch failure gracefully', async () => {
    const deps = buildWeatherDeps();
    // Mock global fetch to fail
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({ ok: false }));

    const app = mountWeather(deps);

    const res = await request(app).get('/fest-1').expect(200);
    assert.equal(res.body.data.available, false);

    globalThis.fetch = originalFetch;
  });

  test('GET /:festivalId — returns weather data on success', async () => {
    const deps = buildWeatherDeps();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        timezone: 'America/New_York',
        daily: { time: ['2026-06-01'], temperature_2m_max: [32], temperature_2m_min: [24], precipitation_probability_max: [10], weathercode: [1] },
        hourly: { time: ['2026-06-01T14:00'], temperature_2m: [30], precipitation_probability: [5], weathercode: [0] },
      }),
    }));

    const app = mountWeather(deps);

    const res = await request(app).get('/fest-1').expect(200);
    assert.equal(res.body.data.available, true);
    assert.ok(res.body.data.daily);
    assert.ok(res.body.data.hourly);

    globalThis.fetch = originalFetch;
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 9. deep-links.js
// ════════════════════════════════════════════════════════════════════════════

describe('routes/deep-links', () => {
  function mountDeepLinks(configOverrides = {}) {
    const deps = baseDeps({
      config: { ...baseDeps().config, ...configOverrides },
    });
    const createDeepLinkRoutes = require('../routes/deep-links');
    const router = createDeepLinkRoutes(deps);
    return mountApp(router);
  }

  test('GET /apple-app-site-association — returns AASA when configured', async () => {
    const app = mountDeepLinks({ APPLE_TEAM_ID: 'REALTEAMID' });

    const res = await request(app).get('/apple-app-site-association').expect(200);
    assert.ok(res.body.applinks);
    assert.ok(res.body.applinks.details[0].appIDs[0].startsWith('REALTEAMID'));
  });

  test('GET /apple-app-site-association — 503 when not configured', async () => {
    const app = mountDeepLinks({ APPLE_TEAM_ID: '' });

    await request(app).get('/apple-app-site-association').expect(503);
  });

  test('GET /apple-app-site-association — 503 for placeholder TEAMID', async () => {
    const app = mountDeepLinks({ APPLE_TEAM_ID: 'TEAMID' });

    await request(app).get('/apple-app-site-association').expect(503);
  });

  test('GET /assetlinks.json — returns asset links when configured', async () => {
    const app = mountDeepLinks({ ANDROID_CERT_FINGERPRINTS: 'AA:BB,CC:DD' });

    const res = await request(app).get('/assetlinks.json').expect(200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body[0].target.sha256_cert_fingerprints.length, 2);
  });

  test('GET /assetlinks.json — 503 when not configured', async () => {
    const app = mountDeepLinks({ ANDROID_CERT_FINGERPRINTS: '' });

    await request(app).get('/assetlinks.json').expect(503);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 10. analytics-install.js
// ════════════════════════════════════════════════════════════════════════════

describe('routes/analytics-install', () => {
  function mountAnalytics(overrides = {}) {
    const deps = baseDeps(overrides);
    const createAnalyticsInstallRoutes = require('../routes/analytics-install');
    const router = createAnalyticsInstallRoutes(deps);
    return mountApp(router);
  }

  test('POST /install — accepts valid event and returns 204', async () => {
    const pool = makePool();
    const app = mountAnalytics({ pool });

    await request(app)
      .post('/install')
      .send({ platform: 'ios', event: 'shown' })
      .expect(204);

    assert.ok(pool.query.mock.calls.length >= 1);
  });

  test('POST /install — rejects invalid platform', async () => {
    const app = mountAnalytics({ pool: makePool() });

    const res = await request(app)
      .post('/install')
      .send({ platform: 'windows', event: 'shown' })
      .expect(400);

    assert.match(res.body.error, /invalid platform/i);
  });

  test('POST /install — rejects invalid event', async () => {
    const app = mountAnalytics({ pool: makePool() });

    const res = await request(app)
      .post('/install')
      .send({ platform: 'ios', event: 'hacked' })
      .expect(400);

    assert.match(res.body.error, /invalid event/i);
  });

  test('POST /install — returns 204 when no pool available', async () => {
    const app = mountAnalytics({ pool: null, stores: { pool: null } });

    await request(app)
      .post('/install')
      .send({ platform: 'android', event: 'accepted' })
      .expect(204);
  });

  test('POST /install — handles DB error gracefully (still 204)', async () => {
    const pool = { query: mock.fn(async () => { throw new Error('DB down'); }) };
    const app = mountAnalytics({ pool });

    await request(app)
      .post('/install')
      .send({ platform: 'desktop', event: 'dismissed' })
      .expect(204);
  });

  test('POST /install — clamps engagement_ms', async () => {
    const pool = makePool();
    const app = mountAnalytics({ pool });

    await request(app)
      .post('/install')
      .send({ platform: 'ios', event: 'shown', engagement_ms: 999999999 })
      .expect(204);

    const queryArgs = pool.query.mock.calls[0].arguments[1];
    // engagement_ms should be clamped to 86_400_000
    assert.ok(queryArgs[3] <= 86_400_000);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 11. client-metrics.js
// ════════════════════════════════════════════════════════════════════════════

describe('routes/client-metrics', () => {
  function mountMetrics(overrides = {}) {
    const deps = baseDeps({
      promMetrics: null, // No prom-client in test
      ...overrides,
    });
    const createClientMetricsRoutes = require('../routes/client-metrics');
    const router = createClientMetricsRoutes(deps);
    return mountApp(router);
  }

  test('POST /web-vitals — accepts valid LCP metric', async () => {
    const app = mountMetrics();

    await request(app)
      .post('/web-vitals')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'LCP', value: 2500, rating: 'good', navigationType: 'navigate' }))
      .expect(204);
  });

  test('POST /web-vitals — accepts text body (sendBeacon format)', async () => {
    const app = mountMetrics();

    await request(app)
      .post('/web-vitals')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ name: 'CLS', value: 0.1, rating: 'good' }))
      .expect(204);
  });

  test('POST /web-vitals — rejects invalid metric name', async () => {
    const app = mountMetrics();

    await request(app)
      .post('/web-vitals')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'FAKE', value: 100 }))
      .expect(204); // Still 204 — fire-and-forget
  });

  test('POST /web-vitals — drops value out of range', async () => {
    const app = mountMetrics();

    await request(app)
      .post('/web-vitals')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'LCP', value: 999999 }))
      .expect(204);
  });

  test('POST /web-vitals — handles non-object body', async () => {
    const app = mountMetrics();

    await request(app)
      .post('/web-vitals')
      .set('Content-Type', 'text/plain')
      .send('not json at all')
      .expect(204);
  });

  test('POST /web-vitals — records to histogram when promMetrics available', async () => {
    const observeFn = mock.fn();
    const mockRegistry = {
      getSingleMetric: () => ({ observe: observeFn }),
      registerMetric: noop,
    };
    const app = mountMetrics({
      promMetrics: { available: true, client: {}, registry: mockRegistry },
    });

    await request(app)
      .post('/web-vitals')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'FCP', value: 1200, navigationType: 'reload' }))
      .expect(204);

    assert.ok(observeFn.mock.calls.length >= 1);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 12. activity.js
// ════════════════════════════════════════════════════════════════════════════

describe('routes/activity', () => {
  function mountActivity(overrides = {}) {
    const deps = baseDeps({
      stores: {
        pool: makePool(),
        crews: {
          getMember: mock.fn(async () => ({ role: 'member' })),
        },
        activity: {
          getByCrew: mock.fn(async () => ({ items: [{ id: 'act-1', type: 'poll-created' }], nextCursor: null })),
        },
      },
      ...overrides,
    });
    const createActivityRoutes = require('../routes/activity');
    const router = createActivityRoutes(deps);
    return mountApp(router);
  }

  test('GET /crews/:crewId/activity — returns activity list', async () => {
    const app = mountActivity();

    const res = await request(app).get('/crews/crew-1/activity').expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data.items));
    assert.equal(res.body.data.items.length, 1);
  });

  test('GET /crews/:crewId/activity — rejects non-member', async () => {
    const app = mountActivity({
      stores: {
        pool: makePool(),
        crews: { getMember: mock.fn(async () => null) },
        activity: { getByCrew: mock.fn(noopAsync) },
      },
    });

    await request(app).get('/crews/crew-1/activity').expect(403);
  });

  test('GET /crews/:crewId/activity — rejects invalid crew ID', async () => {
    const app = mountActivity({
      sanitizeIdentifier: () => '',
    });

    const res = await request(app).get('/crews/bad-id/activity').expect(400);
    assert.equal(res.body.code, 'INVALID_INPUT');
  });

  test('GET /crews/:crewId/activity — handles DB error', async () => {
    const app = mountActivity({
      stores: {
        pool: makePool(),
        crews: { getMember: mock.fn(async () => { throw new Error('DB down'); }) },
        activity: { getByCrew: mock.fn(noopAsync) },
      },
    });

    await request(app).get('/crews/crew-1/activity').expect(500);
  });
});
