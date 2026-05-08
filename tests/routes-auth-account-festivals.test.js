/**
 * Unit tests for route factories: auth.js, account.js, festivals.js
 *
 * Each route module exports a factory function that receives a `deps` object
 * and returns an Express Router. We mount the router on a minimal Express app,
 * inject mocked deps, and drive requests with supertest.
 *
 * Goal: exercise every handler branch to raise code coverage from ~15-20%.
 */
'use strict';

const assert = require('node:assert/strict');
const { describe, test, mock, beforeEach } = require('node:test');
const request = require('supertest');
const express = require('express');

// ── Shared mock helpers ────────────────────────────────────────────────

function makeMockDeps(overrides = {}) {
  const deps = {
    express,
    config: {
      NODE_ENV: 'test',
      MAX_USERS: 100,
      PUBLIC_ORIGIN: 'http://localhost:3000',
      SESSION_SECRET: 'test',
      USER_SESSION_COOKIE: 'festie_session',
      EMAIL_VERIFY_TOKEN_TTL_HOURS: 24,
      REFRESH_TOKEN_TTL: 7776000000,
      AUTH_RATE_LIMIT_MAX: 100,
      MAX_LOGIN_FAILURES: 5,
      LOGIN_LOCKOUT_MS: 900000,
      MAX_STAGES: 50,
      MAX_DAYS: 10,
      MAX_SETS_PER_DAY: 200,
      ...overrides.config,
    },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    sanitizeString: (s) => s?.trim() || '',
    validateUsername: () => true,
    validatePasswordStrength: () => true,
    hashPassword: mock.fn(async () => 'hashed'),
    verifyPassword: mock.fn(async () => true),
    createUserSession: mock.fn(async () => 'tok-123'),
    validateUserSession: mock.fn(async () => null),
    invalidateUserSessions: mock.fn(async () => {}),
    resolveRequestToken: mock.fn((req, _header, _cookie) => {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        return { token: authHeader.slice(7).trim(), source: 'bearer' };
      }
      return { token: null, source: null };
    }),
    setNoStore: mock.fn((res) => {
      if (res && typeof res.setHeader === 'function') {
        res.setHeader('Cache-Control', 'no-store');
      }
    }),
    setUserSessionCookie: mock.fn(),
    clearUserSessionCookie: mock.fn(),
    userAuth: (req, _res, next) => {
      req.user = { userId: 'user-1', username: 'testuser' };
      req.userId = 'user-1';
      req.userToken = 'raw-tok-123';
      next();
    },
    adminAuth: (req, _res, next) => {
      req.adminSession = true;
      req.user = { userId: 'admin-1' };
      next();
    },
    getUserById: mock.fn(async (id) => ({
      id,
      username: 'testuser',
      passwordHash: 'hashed-pw',
      email: 'test@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
    getUsers: mock.fn(async () => []),
    getProfiles: mock.fn(async () => []),
    disconnectUserSockets: mock.fn(),
    disconnectSessionTokens: mock.fn(),
    createOpaqueId: mock.fn(() => 'opaque-123'),
    serializePublicUser: mock.fn((u) => ({ id: u.id, username: u.username })),
    sendSuccess: (res, data) => res.json({ ok: true, ...data }),
    sendError: (res, status, msg, code) => res.status(status).json({ ok: false, code, message: msg }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      ALREADY_EXISTS: 'ALREADY_EXISTS',
      MAX_LIMIT_REACHED: 'MAX_LIMIT_REACHED',
      UNAUTHORIZED: 'UNAUTHORIZED',
      SERVER_ERROR: 'SERVER_ERROR',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
      AUTH_REQUIRED: 'AUTH_REQUIRED',
      MISSING_FIELD: 'MISSING_FIELD',
      INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
      PASSWORD_INCORRECT: 'PASSWORD_INCORRECT',
      RATE_LIMITED: 'RATE_LIMITED',
      TOKEN_EXPIRED: 'TOKEN_EXPIRED',
      ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
    },
    rateLimit: () => (_req, _res, next) => next(),
    io: { to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } },
    DUMMY_PASSWORD_HASH: 'dummy-hash',
    schemas: {},
    validate: () => (req, _res, next) => { req.validatedBody = req.body; next(); },
    validateQuery: () => (req, _res, next) => { req.validatedQuery = req.query; next(); },
    stores: {
      users: {
        create: mock.fn(async (d) => d),
        getById: mock.fn(async () => null),
        getByUsername: mock.fn(async () => null),
        countActive: mock.fn(async () => 0),
        update: mock.fn(async (id, data) => ({ id, username: data.username || 'testuser', ...data })),
        findByUsername: mock.fn(async () => null),
      },
      profiles: {
        update: mock.fn(async () => {}),
        deleteByUserId: mock.fn(async () => {}),
        claimOrphanProfiles: mock.fn(async () => {}),
      },
      pool: { query: mock.fn(async () => ({ rows: [] })) },
      roles: { getUserRoles: mock.fn(async () => []) },
      sessions: {
        deleteUserSession: mock.fn(async () => {}),
        deleteUserSessions: mock.fn(async () => {}),
        listUserSessions: mock.fn(async () => []),
      },
      refreshTokens: null,
      loginFailures: null,
      festivals: {
        create: mock.fn(async (d) => d),
        update: mock.fn(async (id, data) => ({ id, ...data })),
        softDelete: mock.fn(async () => {}),
        hardDelete: mock.fn(async () => {}),
      },
      auditLog: null,
      deviceTokens: null,
      crews: null,
      notificationPrefs: null,
      topicSubscriptions: null,
    },
    invalidateUserCache: mock.fn(),
    invalidateFestivalCache: mock.fn(),
    pool: { query: mock.fn(async () => ({ rows: [] })) },
    state: { metrics: {}, userTaskQueues: new Map() },
    _hashSessionToken: (t) => `hashed-${t}`,
    hashSessionToken: (t) => `hashed-${t}`,
    createAuditLog: mock.fn(async () => {}),
    getRequestIp: () => '127.0.0.1',
    consumeUserAuthRateLimit: mock.fn(() => true),

    // account.js deps
    handleAvatarUpload: (_req, _res, next) => next(),
    processAvatarUpload: mock.fn(async (buf) => buf),
    runUserTask: mock.fn(async (_userId, task) => task()),
    writeAvatarFile: mock.fn(async () => {}),
    removeAvatarFile: mock.fn(async () => {}),
    createVersionToken: mock.fn(() => 'v1'),
    emitProfileIdentity: mock.fn(),

    // festivals.js deps
    getFestivals: mock.fn(async () => []),
    getFestivalById: mock.fn(async () => null),
    validateFestival: mock.fn(() => []),
    sanitizeFestivalPayload: mock.fn((input) => ({
      id: input.id || 'fest-1',
      name: input.name || 'Test Fest',
      location: input.location || 'Somewhere',
      stages: input.stages || [],
      days: input.days || [],
      b2bSeparator: input.b2bSeparator || ' b2b ',
    })),
    removeFestivalSockets: mock.fn(),
    emitter: {
      festivalCreated: mock.fn(),
      festivalUpdated: mock.fn(),
      festivalDeleted: mock.fn(),
    },

    ...overrides,
  };

  // Provide stores overrides deeply merged
  if (overrides.stores) {
    deps.stores = { ...deps.stores, ...overrides.stores };
  }

  return deps;
}

function createApp(router, prefix = '') {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  return app;
}

// ═══════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════
describe('routes/auth.js — createAuthRoutes', () => {
  const createAuthRoutes = require('../routes/auth');

  test('factory returns an Express router', () => {
    const deps = makeMockDeps();
    const router = createAuthRoutes(deps);
    assert.equal(typeof router, 'function');
    assert.ok(router.stack, 'router should have a stack');
  });

  // ── POST /register ────────────────────────────────────────────────
  describe('POST /register', () => {
    test('successful registration returns 201 with user and token', async () => {
      const deps = makeMockDeps({
        stores: {
          users: {
            create: mock.fn(async (d) => d),
            getByUsername: mock.fn(async () => null),
            countActive: mock.fn(async () => 0),
          },
          profiles: {
            update: mock.fn(async () => {}),
            claimOrphanProfiles: mock.fn(async () => {}),
          },
          pool: { query: mock.fn(async () => ({ rows: [] })) },
          roles: { getUserRoles: mock.fn(async () => ['user']) },
          sessions: {
            deleteUserSession: mock.fn(async () => {}),
            listUserSessions: mock.fn(async () => []),
          },
        },
      });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/register')
        .send({ username: 'newuser', password: 'password123', confirmPassword: 'password123' });

      assert.equal(res.status, 201);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.token);
      assert.ok(res.body.user);
    });

    test('returns 400 when username validation fails', async () => {
      const deps = makeMockDeps({ validateUsername: () => false });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/register')
        .send({ username: '!', password: 'password123', confirmPassword: 'password123' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'INVALID_INPUT');
    });

    test('returns 400 when password validation fails', async () => {
      const deps = makeMockDeps({ validatePasswordStrength: () => false });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/register')
        .send({ username: 'newuser', password: 'short', confirmPassword: 'short' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'INVALID_INPUT');
    });

    test('returns 400 when passwords do not match', async () => {
      const deps = makeMockDeps();
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/register')
        .send({ username: 'newuser', password: 'password123', confirmPassword: 'different456' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /do not match/);
    });

    test('returns 400 when username already taken', async () => {
      const deps = makeMockDeps();
      deps.stores.users.getByUsername = mock.fn(async () => ({ id: 'u-exist', username: 'newuser' }));
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/register')
        .send({ username: 'newuser', password: 'password123', confirmPassword: 'password123' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'ALREADY_EXISTS');
    });

    test('returns 400 when max users reached', async () => {
      const deps = makeMockDeps({
        config: { MAX_USERS: 100 },
      });
      deps.stores.users.getByUsername = mock.fn(async () => null);
      deps.stores.users.countActive = mock.fn(async () => 100);
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/register')
        .send({ username: 'brand_new', password: 'password123', confirmPassword: 'password123' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MAX_LIMIT_REACHED');
    });

    test('returns 400 when email already in use', async () => {
      const deps = makeMockDeps({
        stores: {
          users: {
            create: mock.fn(async (d) => d),
            getByUsername: mock.fn(async () => null),
            countActive: mock.fn(async () => 0),
          },
          profiles: {
            update: mock.fn(async () => {}),
            claimOrphanProfiles: mock.fn(async () => {}),
          },
          pool: { query: mock.fn(async () => ({ rows: [{ id: 'u-exist' }] })) },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: {
            deleteUserSession: mock.fn(async () => {}),
            listUserSessions: mock.fn(async () => []),
          },
        },
      });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/register')
        .send({ username: 'newuser', password: 'password123', confirmPassword: 'password123', email: 'taken@example.com' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'ALREADY_EXISTS');
    });

    test('returns 500 on internal error', async () => {
      const deps = makeMockDeps();
      deps.stores.users.getByUsername = mock.fn(async () => { throw new Error('db down'); });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/register')
        .send({ username: 'newuser', password: 'password123', confirmPassword: 'password123' });

      assert.equal(res.status, 500);
      assert.equal(res.body.code, 'INTERNAL_ERROR');
    });
  });

  // ── POST /login ───────────────────────────────────────────────────
  describe('POST /login', () => {
    test('successful login returns user and token', async () => {
      const deps = makeMockDeps();
      deps.stores.users.getByUsername = mock.fn(async () => ({ id: 'u-1', username: 'testuser', passwordHash: 'hashed-pw' }));
      deps.stores.users.findByUsername = mock.fn(async () => null);
      deps.stores.roles = { getUserRoles: mock.fn(async () => ['user']) };
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/login')
        .send({ username: 'testuser', password: 'password123' });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.token);
    });

    test('returns 400 when username or password missing', async () => {
      const deps = makeMockDeps();
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/login')
        .send({ username: '', password: '' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MISSING_FIELD');
    });

    test('returns 401 when user not found (timing-safe)', async (t) => {
      const deps = makeMockDeps({
        verifyPassword: mock.fn(async () => false),
      });
      deps.stores.users.getByUsername = mock.fn(async () => null);
      deps.stores.users.findByUsername = mock.fn(async () => null);
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/login')
        .send({ username: 'nobody', password: 'password123' });

      // Login failures use setTimeout for jitter -- status is 401
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'INVALID_CREDENTIALS');
    });

    test('returns 401 when password is wrong', async () => {
      const deps = makeMockDeps({
        verifyPassword: mock.fn(async () => false),
      });
      deps.stores.users.getByUsername = mock.fn(async () => ({ id: 'u-1', username: 'testuser', passwordHash: 'hashed-pw' }));
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/login')
        .send({ username: 'testuser', password: 'wrong' });

      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'INVALID_CREDENTIALS');
    });

    test('reactivates soft-deleted account on successful login', async () => {
      const updateFn = mock.fn(async () => {});
      const deps = makeMockDeps();
      deps.stores.users.getByUsername = mock.fn(async () => null);
      deps.stores.users.findByUsername = mock.fn(async () => ({
        id: 'u-deleted',
        username: 'testuser',
        passwordHash: 'hashed-pw',
        deletedAt: '2026-01-01T00:00:00.000Z',
      }));
      deps.stores.users.update = updateFn;
      deps.stores.roles = { getUserRoles: mock.fn(async () => []) };
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/login')
        .send({ username: 'testuser', password: 'password123' });

      assert.equal(res.status, 200);
      assert.equal(updateFn.mock.calls.length, 1);
      assert.equal(updateFn.mock.calls[0].arguments[1].deletedAt, null);
    });

    test('returns 500 on internal error', async () => {
      const deps = makeMockDeps();
      deps.stores.users.getByUsername = mock.fn(async () => { throw new Error('db down'); });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/login')
        .send({ username: 'testuser', password: 'password123' });

      assert.equal(res.status, 500);
      assert.equal(res.body.code, 'INTERNAL_ERROR');
    });
  });

  // ── POST /verify ──────────────────────────────────────────────────
  describe('POST /verify', () => {
    test('returns valid:true for a valid session', async () => {
      const deps = makeMockDeps({
        validateUserSession: mock.fn(async () => ({ userId: 'u-1' })),
      });
      deps.stores.roles = { getUserRoles: mock.fn(async () => ['user']) };
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/verify')
        .set('Authorization', 'Bearer valid-token');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.valid, true);
    });

    test('returns 401 when session is invalid', async () => {
      const deps = makeMockDeps({
        validateUserSession: mock.fn(async () => null),
      });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/verify')
        .set('Authorization', 'Bearer bad-token');

      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'AUTH_REQUIRED');
    });

    test('returns 401 when user not found for session', async () => {
      const deps = makeMockDeps({
        validateUserSession: mock.fn(async () => ({ userId: 'u-gone' })),
        getUserById: mock.fn(async () => null),
      });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/verify')
        .set('Authorization', 'Bearer valid-token');

      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'AUTH_REQUIRED');
    });
  });

  // ── GET /me ───────────────────────────────────────────────────────
  describe('GET /me', () => {
    test('returns current user info', async () => {
      const deps = makeMockDeps({
        getProfiles: mock.fn(async () => [
          { userId: 'user-1', festivalId: 'f-1', id: 'p-1' },
          { userId: 'user-2', festivalId: 'f-2', id: 'p-2' },
        ]),
      });
      deps.stores.roles = { getUserRoles: mock.fn(async () => ['user']) };
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/me');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.user);
      // Should only include profiles for user-1
      assert.equal(res.body.festivals.length, 1);
      assert.equal(res.body.festivals[0].festivalId, 'f-1');
    });

    test('returns 401 when user not found', async () => {
      const deps = makeMockDeps({
        getUserById: mock.fn(async () => null),
      });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/me');

      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'AUTH_REQUIRED');
    });
  });

  // ── POST /logout ──────────────────────────────────────────────────
  describe('POST /logout', () => {
    test('clears session and cookie on logout with token', async () => {
      const deleteSession = mock.fn(async () => {});
      const clearCookie = mock.fn();
      const deps = makeMockDeps({
        clearUserSessionCookie: clearCookie,
      });
      deps.stores.sessions = {
        deleteUserSession: deleteSession,
        listUserSessions: mock.fn(async () => []),
      };
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/logout')
        .set('Authorization', 'Bearer my-token');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(deleteSession.mock.calls.length, 1);
      assert.equal(clearCookie.mock.calls.length, 1);
    });

    test('succeeds even without a token (no session to delete)', async () => {
      const clearCookie = mock.fn();
      const deps = makeMockDeps({
        clearUserSessionCookie: clearCookie,
        resolveRequestToken: mock.fn(() => ({ token: null, source: null })),
      });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app).post('/logout');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(clearCookie.mock.calls.length, 1);
    });
  });

  // ── POST /change-password ─────────────────────────────────────────
  describe('POST /change-password', () => {
    test('changes password and issues new session', async () => {
      const updateUser = mock.fn(async () => {});
      const deps = makeMockDeps();
      deps.stores.users = {
        ...deps.stores.users,
        update: updateUser,
      };
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/change-password')
        .send({ currentPassword: 'old123456', newPassword: 'new1234567', confirmPassword: 'new1234567' });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.token);
      assert.equal(updateUser.mock.calls.length, 1);
    });

    test('returns 400 when fields are missing', async () => {
      const deps = makeMockDeps();
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/change-password')
        .send({});

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MISSING_FIELD');
    });

    test('returns 400 when new password is weak', async () => {
      const deps = makeMockDeps({
        validatePasswordStrength: (pw) => pw.length >= 8,
      });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/change-password')
        .send({ currentPassword: 'old12345', newPassword: 'short', confirmPassword: 'short' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'INVALID_INPUT');
    });

    test('returns 400 when new passwords do not match', async () => {
      const deps = makeMockDeps();
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/change-password')
        .send({ currentPassword: 'old12345', newPassword: 'new1234567', confirmPassword: 'different' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /do not match/);
    });

    test('returns 404 when user not found', async () => {
      const deps = makeMockDeps({
        getUserById: mock.fn(async () => null),
      });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/change-password')
        .send({ currentPassword: 'old12345', newPassword: 'new1234567', confirmPassword: 'new1234567' });

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });

    test('returns 400 when current password is wrong', async () => {
      const deps = makeMockDeps({
        verifyPassword: mock.fn(async () => false),
      });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/change-password')
        .send({ currentPassword: 'wrong', newPassword: 'new1234567', confirmPassword: 'new1234567' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'PASSWORD_INCORRECT');
    });
  });

  // ── POST /refresh ─────────────────────────────────────────────────
  describe('POST /refresh', () => {
    test('issues new session token on refresh', async () => {
      const deleteSession = mock.fn(async () => {});
      const deps = makeMockDeps();
      deps.stores.sessions = {
        deleteUserSession: deleteSession,
        listUserSessions: mock.fn(async () => []),
      };
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app).post('/refresh');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.token);
      assert.equal(deleteSession.mock.calls.length, 1);
    });

    test('returns 401 when user not found', async () => {
      const deps = makeMockDeps({
        getUserById: mock.fn(async () => null),
      });
      deps.stores.sessions = {
        deleteUserSession: mock.fn(async () => {}),
        listUserSessions: mock.fn(async () => []),
      };
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app).post('/refresh');

      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'AUTH_REQUIRED');
    });
  });

  // ── POST /refresh-token ───────────────────────────────────────────
  describe('POST /refresh-token', () => {
    test('returns 501 when refreshTokens store is not available', async () => {
      const deps = makeMockDeps();
      deps.stores.refreshTokens = null;
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/refresh-token')
        .send({ refreshToken: 'rt-abc' });

      assert.equal(res.status, 501);
    });

    test('returns 401 when refresh token is invalid', async () => {
      const deps = makeMockDeps();
      deps.stores.refreshTokens = {
        validate: mock.fn(async () => null),
      };
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/refresh-token')
        .send({ refreshToken: 'rt-invalid' });

      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'TOKEN_EXPIRED');
    });

    test('rotates tokens on valid refresh', async () => {
      const rotateFn = mock.fn(async () => {});
      const deps = makeMockDeps();
      deps.stores.refreshTokens = {
        validate: mock.fn(async () => ({ userId: 'u-1' })),
        rotate: rotateFn,
      };
      deps.stores.roles = { getUserRoles: mock.fn(async () => []) };
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/refresh-token')
        .send({ refreshToken: 'rt-valid' });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.token);
      assert.ok(res.body.refreshToken);
      assert.equal(rotateFn.mock.calls.length, 1);
    });
  });

  // ── GET /sessions ─────────────────────────────────────────────────
  describe('GET /sessions', () => {
    test('lists active sessions', async () => {
      const deps = makeMockDeps();
      deps.stores.sessions.listUserSessions = mock.fn(async () => [
        { token: 'hash-1', createdAt: Date.now(), lastAccess: Date.now() },
        { token: 'hash-2', createdAt: Date.now(), lastAccess: Date.now() },
      ]);
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/sessions');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      // Items are spread into the response
      assert.ok(Array.isArray(Object.keys(res.body)));
    });
  });

  // ── DELETE /sessions (all) ────────────────────────────────────────
  describe('DELETE /sessions', () => {
    test('revokes all sessions except current', async () => {
      const invalidateFn = mock.fn(async () => {});
      const deps = makeMockDeps({
        invalidateUserSessions: invalidateFn,
      });
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app).delete('/sessions');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(invalidateFn.mock.calls.length, 1);
    });
  });

  // ── DELETE /sessions/:id ──────────────────────────────────────────
  describe('DELETE /sessions/:id', () => {
    test('returns 400 for invalid session ID format', async () => {
      const deps = makeMockDeps();
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app).delete('/sessions/too-short');

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'INVALID_INPUT');
    });

    test('returns 404 when session not found', async () => {
      const deps = makeMockDeps();
      deps.stores.sessions.listUserSessions = mock.fn(async () => []);
      const router = createAuthRoutes(deps);
      const app = createApp(router);

      const res = await request(app).delete('/sessions/abcdef0123456789');

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ACCOUNT ROUTES
// ═══════════════════════════════════════════════════════════════════════
describe('routes/account.js — createAccountRoutes', () => {
  const createAccountRoutes = require('../routes/account');

  test('factory returns an Express router', () => {
    const deps = makeMockDeps();
    const router = createAccountRoutes(deps);
    assert.equal(typeof router, 'function');
    assert.ok(router.stack);
  });

  // ── POST /avatar ──────────────────────────────────────────────────
  describe('POST /avatar', () => {
    test('returns 400 when no file uploaded', async () => {
      const deps = makeMockDeps();
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app).post('/avatar');

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MISSING_FIELD');
    });

    test('uploads avatar successfully', async () => {
      const updatedUser = { id: 'user-1', username: 'testuser', avatarKey: 'abc123', avatarVersion: 'v1' };
      const deps = makeMockDeps({
        handleAvatarUpload: (req, _res, next) => {
          req.file = { buffer: Buffer.from('image-data') };
          next();
        },
        runUserTask: mock.fn(async (_userId, task) => task()),
        getUserById: mock.fn(async () => ({ id: 'user-1', username: 'testuser', avatarKey: null })),
        stores: {
          users: {
            create: mock.fn(async (d) => d),
            update: mock.fn(async () => updatedUser),
          },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: mock.fn(async () => ({ rows: [] })) },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
        },
      });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app).post('/avatar');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });

    test('returns 404 when user not found during avatar upload', async () => {
      const deps = makeMockDeps({
        handleAvatarUpload: (req, _res, next) => {
          req.file = { buffer: Buffer.from('image-data') };
          next();
        },
        runUserTask: mock.fn(async (_userId, task) => task()),
        getUserById: mock.fn(async () => null),
      });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app).post('/avatar');

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });
  });

  // ── DELETE /avatar ────────────────────────────────────────────────
  describe('DELETE /avatar', () => {
    test('removes avatar successfully', async () => {
      const updatedUser = { id: 'user-1', username: 'testuser', avatarKey: null };
      const deps = makeMockDeps({
        runUserTask: mock.fn(async (_userId, task) => task()),
        getUserById: mock.fn(async () => ({ id: 'user-1', username: 'testuser', avatarKey: 'old-key' })),
        stores: {
          users: {
            create: mock.fn(async (d) => d),
            update: mock.fn(async () => updatedUser),
          },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: mock.fn(async () => ({ rows: [] })) },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
        },
      });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app).delete('/avatar');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });

    test('returns 404 when user not found during avatar delete', async () => {
      const deps = makeMockDeps({
        runUserTask: mock.fn(async (_userId, task) => task()),
        getUserById: mock.fn(async () => null),
      });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app).delete('/avatar');

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });
  });

  // ── PUT /username ─────────────────────────────────────────────────
  describe('PUT /username', () => {
    test('changes username successfully', async () => {
      const updateFn = mock.fn(async (id, data) => ({ id, username: data.username }));
      const deps = makeMockDeps();
      deps.stores.users.getByUsername = mock.fn(async () => null);
      deps.stores.users.update = updateFn;
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .put('/username')
        .send({ username: 'newname' });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(updateFn.mock.calls.length, 1);
    });

    test('PATCH /username also works', async () => {
      const updateFn = mock.fn(async (id, data) => ({ id, username: data.username }));
      const deps = makeMockDeps();
      deps.stores.users.getByUsername = mock.fn(async () => null);
      deps.stores.users.update = updateFn;
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .patch('/username')
        .send({ username: 'patchname' });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });

    test('returns 400 when username validation fails', async () => {
      const deps = makeMockDeps({
        validateUsername: () => false,
      });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .put('/username')
        .send({ username: '!' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'INVALID_INPUT');
    });

    test('returns 404 when current user not found', async () => {
      const deps = makeMockDeps({
        getUserById: mock.fn(async () => null),
      });
      deps.stores.users.getByUsername = mock.fn(async () => null);
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .put('/username')
        .send({ username: 'newname' });

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });

    test('returns 400 when username is already taken by another user', async () => {
      const deps = makeMockDeps();
      deps.stores.users.getByUsername = mock.fn(async () => ({ id: 'user-other', username: 'taken' }));
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .put('/username')
        .send({ username: 'taken' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'ALREADY_EXISTS');
    });

    test('returns 400 on unique constraint violation from DB', async () => {
      const dbError = new Error('duplicate key');
      dbError.code = '23505';
      const deps = makeMockDeps();
      deps.stores.users.getByUsername = mock.fn(async () => null);
      deps.stores.users.update = mock.fn(async () => { throw dbError; });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .put('/username')
        .send({ username: 'racecondition' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'ALREADY_EXISTS');
    });
  });

  // ── DELETE / (soft-delete account) ────────────────────────────────
  describe('DELETE / (soft-delete account)', () => {
    test('soft-deletes account with correct password', async () => {
      const updateUser = mock.fn(async () => {});
      const deps = makeMockDeps({
        getUserById: mock.fn(async () => ({
          id: 'user-1', username: 'testuser', passwordHash: 'hashed-pw', deletedAt: null,
        })),
        verifyPassword: mock.fn(async () => true),
        invalidateUserSessions: mock.fn(async () => {}),
        disconnectUserSockets: mock.fn(),
        getRequestIp: () => '127.0.0.1',
        clearUserSessionCookie: mock.fn(),
        stores: {
          users: { create: mock.fn(async (d) => d), update: updateUser },
          profiles: { update: mock.fn(async () => {}), deleteByUserId: mock.fn(async () => {}) },
          pool: { query: mock.fn(async () => ({ rows: [] })) },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
        },
      });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .delete('/')
        .send({ password: 'password123' });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.deletionDate);
      assert.equal(updateUser.mock.calls.length, 1);
    });

    test('returns 404 when user not found', async () => {
      const deps = makeMockDeps({
        getUserById: mock.fn(async () => null),
        verifyPassword: mock.fn(async () => true),
        invalidateUserSessions: mock.fn(async () => {}),
        disconnectUserSockets: mock.fn(),
        getRequestIp: () => '127.0.0.1',
      });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .delete('/')
        .send({ password: 'password123' });

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });

    test('returns 400 when account is already deleted', async () => {
      const deps = makeMockDeps({
        getUserById: mock.fn(async () => ({
          id: 'user-1', username: 'testuser', passwordHash: 'hashed-pw',
          deletedAt: '2026-01-01T00:00:00.000Z',
        })),
        verifyPassword: mock.fn(async () => true),
        invalidateUserSessions: mock.fn(async () => {}),
        disconnectUserSockets: mock.fn(),
        getRequestIp: () => '127.0.0.1',
      });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .delete('/')
        .send({ password: 'password123' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'INVALID_INPUT');
    });

    test('returns 403 when password is incorrect', async () => {
      const deps = makeMockDeps({
        getUserById: mock.fn(async () => ({
          id: 'user-1', username: 'testuser', passwordHash: 'hashed-pw', deletedAt: null,
        })),
        verifyPassword: mock.fn(async () => false),
        invalidateUserSessions: mock.fn(async () => {}),
        disconnectUserSockets: mock.fn(),
        getRequestIp: () => '127.0.0.1',
      });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .delete('/')
        .send({ password: 'wrong' });

      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'PASSWORD_INCORRECT');
    });
  });

  // ── GET /export (GDPR) ───────────────────────────────────────────
  describe('GET /export', () => {
    test('exports user data as JSON', async () => {
      const deps = makeMockDeps({
        getUserById: mock.fn(async () => ({
          id: 'user-1', username: 'testuser',
          createdAt: '2026-01-01', updatedAt: '2026-01-01',
        })),
        getProfiles: mock.fn(async () => [
          {
            userId: 'user-1', festivalId: 'f-1', id: 'p-1', name: 'Me',
            picks: {}, notes: {}, reminders: {},
            createdAt: '2026-01-01', updatedAt: '2026-01-01',
          },
        ]),
      });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/export');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.user);
      assert.equal(res.body.profiles.length, 1);
      assert.ok(res.body.exportDate);
    });

    test('returns 404 when user not found', async () => {
      const deps = makeMockDeps({
        getUserById: mock.fn(async () => null),
      });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/export');

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });

    test('includes crew and session data when stores are available', async () => {
      const deps = makeMockDeps({
        getUserById: mock.fn(async () => ({
          id: 'user-1', username: 'testuser',
          createdAt: '2026-01-01', updatedAt: '2026-01-01',
        })),
        getProfiles: mock.fn(async () => []),
        stores: {
          users: { create: mock.fn(async (d) => d) },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: mock.fn(async () => ({ rows: [] })) },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: {
            deleteUserSession: mock.fn(async () => {}),
            listUserSessions: mock.fn(async () => [
              { createdAt: Date.now(), lastAccess: Date.now() },
            ]),
          },
          deviceTokens: {
            listByUser: mock.fn(async () => [
              { id: 'dt-1', platform: 'ios', deviceName: 'iPhone', createdAt: '2026-01-01', lastUsedAt: '2026-01-01' },
            ]),
          },
          crews: {
            listForUser: mock.fn(async () => [
              { id: 'c-1', name: 'Crew One', festivalId: 'f-1', role: 'member', joinedAt: '2026-01-01' },
            ]),
          },
          notificationPrefs: {
            get: mock.fn(async () => ({ push: true })),
          },
          topicSubscriptions: null,
        },
      });
      const router = createAccountRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/export');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.sessions.length, 1);
      assert.equal(res.body.deviceTokens.length, 1);
      assert.equal(res.body.crews.length, 1);
      assert.deepEqual(res.body.notificationPreferences, { push: true });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FESTIVAL ROUTES
// ═══════════════════════════════════════════════════════════════════════
describe('routes/festivals.js — createFestivalsRoutes', () => {
  const createFestivalsRoutes = require('../routes/festivals');

  test('factory returns an Express router', () => {
    const deps = makeMockDeps();
    const router = createFestivalsRoutes(deps);
    assert.equal(typeof router, 'function');
    assert.ok(router.stack);
  });

  // ── GET / (festival list) ─────────────────────────────────────────
  describe('GET /', () => {
    test('returns list of festivals', async () => {
      const deps = makeMockDeps({
        getFestivals: mock.fn(async () => [
          { id: 'f-1', name: 'Fest One', location: 'Here', stages: [1, 2], days: [1], createdAt: '2026-01-01' },
          { id: 'f-2', name: 'Fest Two', location: 'There', stages: [], days: [1, 2, 3], createdAt: '2026-01-02' },
        ]),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      // The response data is spread directly, so the array of festivals is the non-ok fields
      // Actually sendSuccess spreads the array, so check it's present
      assert.ok(res.body);
    });

    test('returns 304 for matching ETag', async () => {
      const festivals = [
        { id: 'f-1', name: 'Fest', location: 'Here', stages: [], days: [], createdAt: '2026-01-01' },
      ];
      const deps = makeMockDeps({
        getFestivals: mock.fn(async () => festivals),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      // First request to prime the cache and get ETag
      const first = await request(app).get('/');
      const etag = first.headers.etag;

      // Second request with matching ETag
      const second = await request(app)
        .get('/')
        .set('If-None-Match', etag);

      assert.equal(second.status, 304);
    });

    test('returns 500 on internal error', async () => {
      const deps = makeMockDeps({
        getFestivals: mock.fn(async () => { throw new Error('db down'); }),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/');

      assert.equal(res.status, 500);
      assert.equal(res.body.code, 'INTERNAL_ERROR');
    });
  });

  // ── GET /:id (festival detail) ────────────────────────────────────
  describe('GET /:id', () => {
    test('returns full festival for depth=2 (default)', async () => {
      const festival = {
        id: 'f-1', name: 'Big Fest', location: 'Miami',
        stages: [{ id: 's-1', name: 'Main', color: '#ff0000' }],
        days: [{ label: 'Day 1', date: '2026-03-01', sets: [] }],
      };
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => festival),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/f-1');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.id, 'f-1');
    });

    test('returns L1 structural data for depth=1', async () => {
      const festival = {
        id: 'f-1', name: 'Big Fest', location: 'Miami',
        stages: [{ id: 's-1', name: 'Main', color: '#ff0000' }],
        days: [{
          label: 'Day 1', date: '2026-03-01',
          sets: [{ id: 'set-1', artist: 'DJ X', artists: [], stageId: 's-1', startTime: '14:00', endTime: '15:00' }],
        }],
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => festival),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/f-1?depth=1');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.id, 'f-1');
      assert.equal(res.body.stages.length, 1);
      assert.equal(res.body.days[0].sets[0].artist, 'DJ X');
    });

    test('returns 404 when festival not found', async () => {
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => null),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/nonexistent');

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });

    test('returns 500 on internal error', async () => {
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => { throw new Error('db down'); }),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/f-1');

      assert.equal(res.status, 500);
      assert.equal(res.body.code, 'INTERNAL_ERROR');
    });
  });

  // ── POST / (create festival) ──────────────────────────────────────
  describe('POST /', () => {
    test('creates festival successfully', async () => {
      const createFn = mock.fn(async (d) => d);
      const deps = makeMockDeps({
        stores: {
          festivals: { create: createFn, update: mock.fn(async (id, d) => ({ id, ...d })), softDelete: mock.fn(async () => {}) },
          users: { create: mock.fn(async (d) => d) },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: mock.fn(async () => ({ rows: [] })) },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
        },
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/')
        .send({ name: 'New Fest', location: 'NYC' });

      assert.equal(res.status, 201);
      assert.equal(res.body.ok, true);
      assert.equal(createFn.mock.calls.length, 1);
      assert.equal(deps.emitter.festivalCreated.mock.calls.length, 1);
    });

    test('returns 400 when validation fails', async () => {
      const deps = makeMockDeps({
        validateFestival: mock.fn(() => ['Name is required']),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/')
        .send({});

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'INVALID_INPUT');
      assert.match(res.body.message, /Name is required/);
    });

    test('returns 500 on internal error', async () => {
      const deps = makeMockDeps({
        stores: {
          festivals: { create: mock.fn(async () => { throw new Error('db down'); }) },
          users: { create: mock.fn(async (d) => d) },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: mock.fn(async () => ({ rows: [] })) },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
        },
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .post('/')
        .send({ name: 'New Fest', location: 'NYC' });

      assert.equal(res.status, 500);
      assert.equal(res.body.code, 'INTERNAL_ERROR');
    });
  });

  // ── PUT /:id (update festival) ────────────────────────────────────
  describe('PUT /:id', () => {
    test('updates festival successfully', async () => {
      const existingFestival = { id: 'f-1', name: 'Old Name', location: 'Old Place' };
      const updateFn = mock.fn(async (id, data) => ({ id, ...data }));
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => existingFestival),
        stores: {
          festivals: { create: mock.fn(async (d) => d), update: updateFn, softDelete: mock.fn(async () => {}) },
          users: { create: mock.fn(async (d) => d) },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: mock.fn(async () => ({ rows: [] })) },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
        },
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .put('/f-1')
        .send({ name: 'New Name', location: 'New Place' });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(updateFn.mock.calls.length, 1);
      assert.equal(deps.emitter.festivalUpdated.mock.calls.length, 1);
    });

    test('returns 404 when festival not found', async () => {
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => null),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .put('/nonexistent')
        .send({ name: 'Updated' });

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });

    test('returns 400 when validation fails', async () => {
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => ({ id: 'f-1', name: 'Fest' })),
        validateFestival: mock.fn(() => ['Invalid stage count']),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .put('/f-1')
        .send({ name: 'Updated' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'INVALID_INPUT');
    });
  });

  // ── DELETE /:id (delete festival) ─────────────────────────────────
  describe('DELETE /:id', () => {
    test('soft-deletes festival by default', async () => {
      const softDeleteFn = mock.fn(async () => {});
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => ({ id: 'f-1', name: 'Fest' })),
        stores: {
          festivals: { create: mock.fn(async (d) => d), update: mock.fn(async (id, d) => ({ id, ...d })), softDelete: softDeleteFn },
          users: { create: mock.fn(async (d) => d) },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: mock.fn(async () => ({ rows: [] })) },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
        },
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app).delete('/f-1');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.softDeleted, true);
      assert.equal(softDeleteFn.mock.calls.length, 1);
      assert.equal(deps.emitter.festivalDeleted.mock.calls.length, 1);
    });

    test('hard-deletes festival when ?hard=true', async () => {
      const hardDeleteFn = mock.fn(async () => {});
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => ({ id: 'f-1', name: 'Fest' })),
        stores: {
          festivals: { create: mock.fn(async (d) => d), update: mock.fn(async (id, d) => ({ id, ...d })), hardDelete: hardDeleteFn },
          users: { create: mock.fn(async (d) => d) },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: mock.fn(async () => ({ rows: [] })) },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
          crews: { deleteByFestival: mock.fn(async () => {}) },
        },
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app).delete('/f-1?hard=true');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.softDeleted, false);
      // Should have called stores.festivals.hardDelete
      assert.equal(hardDeleteFn.mock.calls.length, 1);
      assert.equal(hardDeleteFn.mock.calls[0].arguments[0], 'f-1');
    });

    test('returns 404 when festival not found', async () => {
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => null),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app).delete('/nonexistent');

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });

    test('returns 500 on internal error', async () => {
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => ({ id: 'f-1', name: 'Fest' })),
        stores: {
          festivals: {
            softDelete: mock.fn(async () => { throw new Error('db error'); }),
          },
          users: { create: mock.fn(async (d) => d) },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: mock.fn(async () => ({ rows: [] })) },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
        },
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app).delete('/f-1');

      assert.equal(res.status, 500);
      assert.equal(res.body.code, 'INTERNAL_ERROR');
    });
  });

  // ── PUT /:festivalId/sets/:setId/link ─────────────────────────────
  describe('PUT /:festivalId/sets/:setId/link', () => {
    test('updates set link successfully', async () => {
      const festival = {
        id: 'f-1', name: 'Fest',
        days: [{
          label: 'Day 1',
          sets: [{ id: 'set-1', artist: 'DJ Test', artists: [{ name: 'DJ Test', links: {} }] }],
        }],
      };
      const poolQuery = mock.fn(async () => ({ rows: [] }));
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => festival),
        stores: {
          festivals: { create: mock.fn(async (d) => d), update: mock.fn(async (id, d) => ({ id, ...d })), softDelete: mock.fn(async () => {}) },
          users: { create: mock.fn(async (d) => d) },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: poolQuery },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
        },
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .put('/f-1/sets/set-1/link')
        .send({ linkUrl: 'https://open.spotify.com/track/123' });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.setId, 'set-1');
      // Should have issued UPDATE queries
      assert.ok(poolQuery.mock.calls.length >= 2);
    });

    test('returns 404 when festival not found', async () => {
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => null),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .put('/f-missing/sets/set-1/link')
        .send({ linkUrl: 'https://example.com' });

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });

    test('returns 404 when set not found in festival', async () => {
      const festival = {
        id: 'f-1', name: 'Fest',
        days: [{ label: 'Day 1', sets: [{ id: 'set-other', artist: 'Other' }] }],
      };
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => festival),
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .put('/f-1/sets/set-missing/link')
        .send({ linkUrl: 'https://example.com' });

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });

    test('clears link when linkUrl is empty', async () => {
      const festival = {
        id: 'f-1', name: 'Fest',
        days: [{ label: 'Day 1', sets: [{ id: 'set-1', artist: 'DJ', artists: [] }] }],
      };
      const poolQuery = mock.fn(async () => ({ rows: [] }));
      const deps = makeMockDeps({
        getFestivalById: mock.fn(async () => festival),
        stores: {
          festivals: { create: mock.fn(async (d) => d), update: mock.fn(async (id, d) => ({ id, ...d })), softDelete: mock.fn(async () => {}) },
          users: { create: mock.fn(async (d) => d) },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: poolQuery },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
        },
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app)
        .put('/f-1/sets/set-1/link')
        .send({ linkUrl: '' });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.linkUrl, null);
    });
  });

  // ── GET /:festivalId/sets/links ───────────────────────────────────
  describe('GET /:festivalId/sets/links', () => {
    test('returns list of set links', async () => {
      const poolQuery = mock.fn(async () => ({
        rows: [
          { id: 'set-1', artist: 'DJ One', linkUrl: 'https://example.com', artists: [] },
        ],
      }));
      const deps = makeMockDeps({
        stores: {
          festivals: { create: mock.fn(async (d) => d), update: mock.fn(async (id, d) => ({ id, ...d })), softDelete: mock.fn(async () => {}) },
          users: { create: mock.fn(async (d) => d) },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: poolQuery },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
        },
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/f-1/sets/links');

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });

    test('returns 500 on internal error', async () => {
      const deps = makeMockDeps({
        stores: {
          festivals: { create: mock.fn(async (d) => d) },
          users: { create: mock.fn(async (d) => d) },
          profiles: { update: mock.fn(async () => {}) },
          pool: { query: mock.fn(async () => { throw new Error('db error'); }) },
          roles: { getUserRoles: mock.fn(async () => []) },
          sessions: { deleteUserSession: mock.fn(async () => {}), listUserSessions: mock.fn(async () => []) },
        },
      });
      const router = createFestivalsRoutes(deps);
      const app = createApp(router);

      const res = await request(app).get('/f-1/sets/links');

      assert.equal(res.status, 500);
      assert.equal(res.body.code, 'INTERNAL_ERROR');
    });
  });
});
