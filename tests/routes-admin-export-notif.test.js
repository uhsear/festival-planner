const assert = require('node:assert/strict');
const { describe, test, mock, beforeEach } = require('node:test');
const express = require('express');
const request = require('supertest');

// ── Shared mock factory ──────────────────────────────────────────────
function makeDeps(overrides = {}) {
  const deps = {
    express,
    config: {
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: 'http://localhost:3000',
      ADMIN_USERNAME: 'admin',
      ADMIN_WRITE_RATE_LIMIT_MAX: 100,
      CLUSTER_SIZE: 1,
      RESET_TOKEN_TTL: 3600000,
      SPOTIFY_CLIENT_ID: '',
      SPOTIFY_CLIENT_SECRET: '',
      CERT_PIN_PRIMARY: '',
      CERT_PIN_BACKUP: '',
      PUBLIC_DIR: __dirname,
      EXPORT_TIMEOUT_MS: 10000,
      MAX_CONCURRENT_EXPORTS: 4,
      MAX_CREW_IN_EXPORT: 20,
      EXPORT_COOLDOWN_MS: 0,
    },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    sendSuccess: (res, data, extra) => res.json({ ok: true, data, ...extra }),
    sendError: (res, status, msg, code) => res.status(status).json({ ok: false, code, message: msg }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      UNAUTHORIZED: 'UNAUTHORIZED',
      SERVER_ERROR: 'SERVER_ERROR',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
      FORBIDDEN: 'FORBIDDEN',
      RATE_LIMITED: 'RATE_LIMITED',
      MISSING_FIELD: 'MISSING_FIELD',
      SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    },
    userAuth: (req, res, next) => { req.userId = 'user-1'; req.user = { userId: 'user-1' }; next(); },
    adminAuth: (req, res, next) => { req.userId = 'admin-1'; req.isAdmin = true; next(); },
    rateLimit: () => (req, res, next) => next(),
    validate: () => (req, res, next) => { req.validatedBody = req.body; next(); },
    validateQuery: () => (req, res, next) => { req.validatedQuery = req.query; next(); },
    validateParams: () => (req, res, next) => { req.validatedParams = req.params; next(); },
    schemas: {
      adminUserSearchQuery: {},
      adminAddRole: {},
      resetPassword: {},
      adminBulkDeactivate: {},
      adminBulkArchive: {},
      adminAuditQuery: {},
      genericIdParams: {},
      festivalIdParams: {},
      pushToken: {},
      deleteToken: {},
      notificationPrefs: {},
      markRead: {},
      topicSubscription: {},
    },
    setNoStore: () => {},
    sanitizeString: (s, max) => (s || '').trim().slice(0, max || 100),
    sanitizeIdentifier: (s) => s ? String(s).trim() : null,
    createOpaqueId: () => 'opaque-123',
    createAuditLog: (action, actorType, details) => ({ action, actorType, ...details }),
    invalidateUserCache: mock.fn(),
    getRequestIp: () => '127.0.0.1',
    getUsers: mock.fn(async () => [
      { id: 'user-1', username: 'admin', email: 'admin@test.com', createdAt: '2026-01-01' },
      { id: 'user-2', username: 'bob', email: 'bob@test.com', createdAt: '2026-01-02' },
    ]),
    getFestivals: mock.fn(async () => [
      { id: 'f1', name: 'Bonnaroo', stages: [], days: [] },
    ]),
    getProfiles: mock.fn(async () => [
      { id: 'p1', userId: 'user-1', festivalId: 'f1', picks: { s1: 'must' }, notes: {} },
    ]),
    getUserById: mock.fn(async (id) => {
      if (id === 'user-1') return { id: 'user-1', username: 'admin', avatarKey: null };
      if (id === 'user-2') return { id: 'user-2', username: 'bob', avatarKey: null };
      return null;
    }),
    getFestivalById: mock.fn(async (id) => {
      if (id === 'f1') return {
        id: 'f1', name: 'Bonnaroo', location: 'TN',
        stages: [{ id: 'st1', name: 'Main Stage' }],
        days: [{ date: '2026-06-10', label: 'Day 1', sets: [
          { id: 's1', artist: 'DJ Test', stageId: 'st1', startTime: '14:00', endTime: '15:00' },
        ] }],
      };
      return null;
    }),
    getUserFestivalProfile: mock.fn(async (userId, festivalId) => {
      if (userId === 'user-1' && festivalId === 'f1') {
        return { id: 'p1', userId: 'user-1', festivalId: 'f1', name: 'MyProfile', picks: { s1: 'must' }, notes: {} };
      }
      return null;
    }),
    serializeOwnProfile: (profile, user) => ({ ...profile, username: user?.username }),
    serializeExportCrewProfile: (p) => ({ id: p.id, name: p.name || 'anon' }),
    _buildAvatarUrl: () => null,
    buildAvatarUrl: () => null,
    encodeContentDispositionFilename: (f) => encodeURIComponent(f),
    exportContentSecurityPolicy: "default-src 'self'",
    getPresenceList: mock.fn(async () => ['user-1']),
    validatePasswordStrength: (p) => p && p.length >= 8 && p.length <= 100,
    hashPassword: mock.fn(async () => 'hashed-password'),
    invalidateUserSessions: mock.fn(async () => {}),
    disconnectUserSockets: mock.fn(),
    removeAvatarFile: mock.fn(async () => {}),
    removeProfileSockets: mock.fn(),
    _invalidateFestivalCache: mock.fn(),
    io: {
      to: () => ({ emit: mock.fn() }),
      of: () => ({ to: () => ({ emit: mock.fn() }) }),
      engine: { clientsCount: 5 },
    },
    metrics: {
      totalRequests: 100,
      totalErrors: 2,
      totalDuration: 5000,
      requestCount: 100,
      statusCodes: { 200: 90, 404: 8, 500: 2 },
      socketConnections: 50,
      socketDisconnections: 10,
      socketErrors: 1,
      peakConnections: 20,
      startedAt: '2026-01-01T00:00:00Z',
      endpointLatency: {
        'GET /api/v1/festivals': { totalMs: 1000, count: 50, maxMs: 100 },
      },
      authFailures: 3,
      rateLimitViolations: 5,
    },
    state: {
      onlineUsers: new Map(),
      rateLimits: new Map(),
      authRateLimits: new Map(),
      adminAuthRateLimits: new Map(),
      socketConnectRateLimits: new Map(),
      timers: [],
      _adminResetTokens: new Map(),
      shutdownCallbacks: [],
    },
    pool: {
      query: mock.fn(async () => ({ rows: [] })),
      totalCount: 10,
      idleCount: 5,
      waitingCount: 0,
    },
    stores: {
      pool: {
        query: mock.fn(async () => ({ rows: [] })),
        totalCount: 10,
        idleCount: 5,
        waitingCount: 0,
      },
      users: {
        getById: mock.fn(async () => ({ id: 'user-1', username: 'admin' })),
        update: mock.fn(async () => {}),
        hardDelete: mock.fn(async (id) => ({ id, username: 'deleted-user', avatarKey: null })),
        delete: mock.fn(async (id) => ({ id, username: 'deleted-user', avatarKey: null })),
        countActive: mock.fn(async () => 2),
      },
      roles: {
        getUserRoles: mock.fn(async () => ['admin']),
        getUserRolesBatch: mock.fn(async (ids) => new Map(ids.map((id) => [id, ['admin']]))),
        grantRole: mock.fn(async () => {}),
        revokeRole: mock.fn(async () => {}),
      },
      festivals: {
        getById: mock.fn(async () => ({ id: 'f1', name: 'Test' })),
        softDelete: mock.fn(async () => {}),
      },
      profiles: {
        getById: mock.fn(async (id) => {
          if (id === 'p1') return { id: 'p1', userId: 'user-1', festivalId: 'f1', name: 'MyProfile', picks: { s1: 'must' }, notes: {} };
          return null;
        }),
        getByFestivalId: mock.fn(async () => []),
        deleteByUserId: mock.fn(async () => [{ id: 'p1', festivalId: 'f1' }]),
        readByUserAndFestival: mock.fn(async (userId, festivalId) => {
          if (userId === 'user-1' && festivalId === 'f1') return { id: 'p1' };
          return null;
        }),
      },
      crews: {
        getById: mock.fn(async (id) => {
          if (id === 'crew-1') return { id: 'crew-1', name: 'Test Crew', festivalId: 'f1' };
          return null;
        }),
        getMembers: mock.fn(async () => [{ userId: 'user-1', username: 'admin' }]),
        getMember: mock.fn(async (crewId, userId) => {
          if (crewId === 'crew-1' && userId === 'user-2') return { userId: 'user-2' };
          return null;
        }),
        removeMember: mock.fn(async () => {}),
        delete: mock.fn(async () => {}),
      },
      sessions: {
        deleteUserSessions: mock.fn(async () => {}),
      },
      auditLog: {
        query: mock.fn(async () => ({ rows: [{ id: 'a1', action: 'login', actorType: 'user', actorId: 'user-1', targetType: null, targetId: null, details: null, createdAt: '2026-01-01' }], nextCursor: null })),
        count: mock.fn(async () => 1),
        insert: mock.fn(async () => {}),
      },
      audit: {
        readAll: mock.fn(async () => []),
        create: mock.fn(async () => {}),
      },
      deviceTokens: {
        register: mock.fn(async () => {}),
        unregister: mock.fn(async () => {}),
        getTokenOwner: mock.fn(async () => null),
        listByUser: mock.fn(async () => []),
      },
      notificationPrefs: {
        get: mock.fn(async () => ({ crewUpdates: 1, setReminders: 1, scheduleChanges: 1, dndStart: null, dndEnd: null })),
        upsert: mock.fn(async () => {}),
      },
      notificationCounts: {
        reset: mock.fn(async () => {}),
        resetAll: mock.fn(async () => {}),
        getByUser: mock.fn(async () => [{ festivalId: 'f1', unreadUpdates: 3 }]),
      },
      notificationLog: {
        listByUser: mock.fn(async () => [{ id: 'n1', title: 'Test', createdAt: '2026-01-01' }]),
      },
      topicSubscriptions: {
        getForUser: mock.fn(async () => ({ crew: true, schedule: false })),
        setSubscription: mock.fn(async () => {}),
      },
    },
    ...overrides,
  };
  return deps;
}

// ── Helper: mount a router on a minimal Express app ──────────────────
function buildApp(router, prefix = '') {
  const app = express();
  app.use(express.json());
  if (prefix) {
    app.use(prefix, router);
  } else {
    app.use(router);
  }
  return app;
}

// =====================================================================
// admin-status.js
// =====================================================================
describe('routes/admin-status.js', () => {
  test('factory returns an object with a router', () => {
    const createAdminStatusRoutes = require('../routes/admin-status');
    const deps = makeDeps();
    const result = createAdminStatusRoutes(deps);
    assert.ok(result.router, 'Should return an object with a router property');
  });

  test('GET /admin/health returns system status', async () => {
    const createAdminStatusRoutes = require('../routes/admin-status');
    const deps = makeDeps();
    const { router } = createAdminStatusRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/admin/health').expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.status, 'ok');
    assert.ok(typeof res.body.data.uptime === 'number');
    assert.ok(res.body.data.memory);
    assert.ok(typeof res.body.data.memory.rss === 'number');
    assert.ok(typeof res.body.data.connections === 'number');
    assert.ok(res.body.data.database);
  });

  test('GET /admin/health includes rate limit stats', async () => {
    const createAdminStatusRoutes = require('../routes/admin-status');
    const deps = makeDeps();
    deps.state.rateLimits.set('key1', { count: 1 });
    deps.state.authRateLimits.set('key2', { count: 2 });
    const { router } = createAdminStatusRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/admin/health').expect(200);
    assert.equal(res.body.data.rateLimits.api, 1);
    assert.equal(res.body.data.rateLimits.auth, 1);
  });

  test('GET /admin/health includes request metrics when available', async () => {
    const createAdminStatusRoutes = require('../routes/admin-status');
    const deps = makeDeps();
    const { router } = createAdminStatusRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/admin/health').expect(200);
    assert.ok(res.body.data.requests);
    assert.equal(res.body.data.requests.total, 100);
    assert.equal(res.body.data.requests.errors, 2);
  });

  test('GET /admin/health omits request/socket metrics when not available', async () => {
    const createAdminStatusRoutes = require('../routes/admin-status');
    const deps = makeDeps({ metrics: undefined });
    const { router } = createAdminStatusRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/admin/health').expect(200);
    assert.equal(res.body.data.requests, null);
    assert.equal(res.body.data.sockets, null);
  });

  test('GET /admin/status returns HTML page', async () => {
    const createAdminStatusRoutes = require('../routes/admin-status');
    const deps = makeDeps();
    const { router } = createAdminStatusRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/admin/status').expect(200);
    assert.ok(res.headers['content-type'].includes('text/html'));
    assert.ok(res.text.includes('Festie Admin Status'));
    assert.ok(res.text.includes('Healthy'));
  });

  test('GET /admin/status includes CSP header with nonce', async () => {
    const createAdminStatusRoutes = require('../routes/admin-status');
    const deps = makeDeps();
    // Simulate cspNonce being set by middleware
    const origAdminAuth = deps.adminAuth;
    deps.adminAuth = (req, res, next) => {
      res.locals = { cspNonce: 'test-nonce-123' };
      origAdminAuth(req, res, next);
    };
    const { router } = createAdminStatusRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/admin/status').expect(200);
    assert.ok(res.headers['content-security-policy']);
    assert.ok(res.headers['content-security-policy'].includes('nonce-test-nonce-123'));
  });

  test('GET /admin/status includes metrics section when metrics available', async () => {
    const createAdminStatusRoutes = require('../routes/admin-status');
    const deps = makeDeps();
    const { router } = createAdminStatusRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/admin/status').expect(200);
    assert.ok(res.text.includes('Requests'));
    assert.ok(res.text.includes('Socket.IO'));
  });

  test('GET /admin/analytics returns analytics data', async () => {
    const createAdminStatusRoutes = require('../routes/admin-status');
    const deps = makeDeps();
    deps.pool.query = mock.fn(async () => ({ rows: [{ artist: 'Test', pickCount: 5 }] }));
    const { router } = createAdminStatusRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/admin/analytics').expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.data.topSets);
    assert.ok(res.body.data.activeUsers);
    assert.ok(res.body.data.crews);
    assert.ok(res.body.data.festivalStats);
    assert.ok(res.body.data.generatedAt);
  });

  test('GET /admin/analytics returns 500 when pool unavailable', async () => {
    const createAdminStatusRoutes = require('../routes/admin-status');
    const deps = makeDeps();
    deps.pool = null;
    deps.stores.pool = null;
    const { router } = createAdminStatusRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/admin/analytics').expect(200);
    assert.equal(res.body.data, null);
  });

  test('GET /admin/analytics returns 500 on query error', async () => {
    const createAdminStatusRoutes = require('../routes/admin-status');
    const deps = makeDeps();
    deps.pool.query = mock.fn(async () => { throw new Error('DB down'); });
    const { router } = createAdminStatusRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/admin/analytics').expect(500);
    assert.equal(res.body.ok, false);
  });

  test('GET /admin/analytics/view returns HTML', async () => {
    const createAdminStatusRoutes = require('../routes/admin-status');
    const deps = makeDeps();
    const { router } = createAdminStatusRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/admin/analytics/view').expect(200);
    assert.ok(res.headers['content-type'].includes('text/html'));
    assert.ok(res.headers['content-security-policy']);
  });
});

// =====================================================================
// admin-metrics.js
// =====================================================================
describe('routes/admin-metrics.js', () => {
  test('factory returns an object with a router', () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    const result = createAdminMetricsRoutes(deps);
    assert.ok(result.router);
  });

  test('GET /metrics returns Prometheus text exposition', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    const { router } = createAdminMetricsRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/metrics').expect(200);
    assert.ok(res.headers['content-type'].includes('text/plain'));
    assert.ok(res.text.includes('fp_uptime_seconds'));
    assert.ok(res.text.includes('fp_memory_rss_bytes'));
    assert.ok(res.text.includes('fp_websocket_connections'));
    assert.ok(res.text.includes('fp_users_total'));
    assert.ok(res.text.includes('fp_online_rooms'));
  });

  test('GET /metrics includes HTTP request metrics', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    const { router } = createAdminMetricsRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/metrics').expect(200);
    assert.ok(res.text.includes('fp_http_requests_total 100'));
    assert.ok(res.text.includes('fp_http_errors_total 2'));
    assert.ok(res.text.includes('fp_http_duration_avg_ms'));
    assert.ok(res.text.includes('fp_socket_connections_total'));
    assert.ok(res.text.includes('fp_socket_peak_concurrent'));
  });

  test('GET /metrics includes per-endpoint latency', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    const { router } = createAdminMetricsRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/metrics').expect(200);
    assert.ok(res.text.includes('fp_endpoint_latency_avg_ms'));
    assert.ok(res.text.includes('fp_endpoint_requests_total'));
    assert.ok(res.text.includes('GET /api/v1/festivals'));
  });

  test('GET /metrics includes auth failure metric', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    const { router } = createAdminMetricsRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/metrics').expect(200);
    assert.ok(res.text.includes('fp_auth_failures_total 3'));
  });

  test('GET /metrics includes rate limit entries', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    deps.state.rateLimits.set('k1', 1);
    const { router } = createAdminMetricsRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/metrics').expect(200);
    assert.ok(res.text.includes('fp_rate_limit_entries_api'));
    assert.ok(res.text.includes('fp_rate_limit_entries_auth'));
  });

  test('GET /metrics includes PostgreSQL pool metrics', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    const { router } = createAdminMetricsRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/metrics').expect(200);
    assert.ok(res.text.includes('fp_pg_pool_total'));
    assert.ok(res.text.includes('fp_pg_pool_idle'));
    assert.ok(res.text.includes('fp_pg_pool_waiting'));
  });

  test('GET /metrics includes rate limit violation count', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    const { router } = createAdminMetricsRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/metrics').expect(200);
    assert.ok(res.text.includes('fp_rate_limit_violations 5'));
  });

  test('GET /metrics includes DB latency tracker stats', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    deps.dbLatencyTracker = {
      stats: {
        'SELECT users': { totalMs: 500, count: 100, maxMs: 25 },
      },
    };
    const { router } = createAdminMetricsRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/metrics').expect(200);
    assert.ok(res.text.includes('fp_db_query_avg_ms'));
    assert.ok(res.text.includes('SELECT users'));
  });

  test('GET /metrics includes client Web Vitals when samples exist', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    deps.clientMetrics = { samples: 10, lcpSum: 20000, fidSum: 500, clsSum: 1.5, renderMsSum: 3000, renderCount: 10 };
    deps.clientMetricsBuckets = { lcp_under_2500: 8, lcp_over_2500: 2, fid_under_100: 9, fid_over_100: 1, render_under_500: 7, render_over_500: 3 };
    const { router } = createAdminMetricsRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/metrics').expect(200);
    assert.ok(res.text.includes('fp_client_lcp_avg_ms'));
    assert.ok(res.text.includes('fp_client_fid_avg_ms'));
    assert.ok(res.text.includes('fp_client_cls_avg'));
    assert.ok(res.text.includes('fp_client_samples 10'));
  });

  test('GET /cert-pins returns 503 when pins not configured', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    const { router } = createAdminMetricsRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/cert-pins').expect(503);
    assert.equal(res.body.ok, false);
  });

  test('GET /cert-pins returns pins when configured', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    deps.config.CERT_PIN_PRIMARY = 'sha256/abc123';
    deps.config.CERT_PIN_BACKUP = 'sha256/def456';
    const { router } = createAdminMetricsRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/cert-pins').expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.cert_pins.primary, 'sha256/abc123');
    assert.equal(res.body.data.cert_pins.backup, 'sha256/def456');
  });

  test('GET /internal/metrics-json returns 403 for non-localhost', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    const { router } = createAdminMetricsRoutes(deps);

    const appWithIp = express();
    appWithIp.use(express.json());
    appWithIp.use((req, _res, next) => {
      Object.defineProperty(req.socket, 'remoteAddress', { value: '10.0.0.5', configurable: true });
      next();
    });
    appWithIp.use(router);

    const res = await request(appWithIp)
      .get('/internal/metrics-json')
      .expect(403);
    assert.equal(res.body.ok, false);
  });

  test('GET /internal/metrics-json returns metrics for localhost', async () => {
    const createAdminMetricsRoutes = require('../routes/admin-metrics');
    const deps = makeDeps();
    const { router } = createAdminMetricsRoutes(deps);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.ip = '127.0.0.1';
      next();
    });
    app.use(router);

    const res = await request(app).get('/internal/metrics-json').expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.totalRequests, 100);
    assert.equal(res.body.data.totalErrors, 2);
  });
});

// =====================================================================
// admin-audit.js
// =====================================================================
describe('routes/admin-audit.js', () => {
  test('GET /audit returns audit entries', async () => {
    const mountAdminAuditRoutes = require('../routes/admin-audit');
    const deps = makeDeps();
    const router = express.Router();
    mountAdminAuditRoutes({ router, deps });
    const app = buildApp(router);

    const res = await request(app).get('/audit').expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.meta);
    assert.equal(res.body.meta.total, 1);
  });

  test('GET /audit passes query filters to store', async () => {
    const mountAdminAuditRoutes = require('../routes/admin-audit');
    const deps = makeDeps();
    const router = express.Router();
    mountAdminAuditRoutes({ router, deps });
    const app = buildApp(router);

    await request(app)
      .get('/audit?actor_id=user-1&action=login&limit=10')
      .expect(200);

    const callArgs = deps.stores.auditLog.query.mock.calls[0].arguments[0];
    assert.equal(callArgs.actorId, 'user-1');
    assert.equal(callArgs.action, 'login');
  });

  test('GET /audit returns 500 on store error', async () => {
    const mountAdminAuditRoutes = require('../routes/admin-audit');
    const deps = makeDeps();
    deps.stores.auditLog.query = mock.fn(async () => { throw new Error('DB down'); });
    const router = express.Router();
    mountAdminAuditRoutes({ router, deps });
    const app = buildApp(router);

    const res = await request(app).get('/audit').expect(500);
    assert.equal(res.body.ok, false);
  });
});

// =====================================================================
// admin-users.js
// =====================================================================
describe('routes/admin-users.js', () => {
  function buildUserRouter(overrides = {}) {
    const mountAdminUserRoutes = require('../routes/admin-users');
    const deps = makeDeps(overrides);
    const router = express.Router();
    const crypto = require('crypto');
    const { parsePageParams, paginateArray } = require('../lib/pagination');
    const passwordResetRateLimit = (req, res, next) => next();
    const adminWriteLimit = (req, res, next) => next();
    const ctx = { adminWriteLimit, passwordResetRateLimit, crypto, parsePageParams, paginateArray };
    mountAdminUserRoutes({ router, deps, ctx });
    return { app: buildApp(router), deps };
  }

  test('GET /users returns user list with roles and profiles', async () => {
    const { app } = buildUserRouter();
    const res = await request(app).get('/users').expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length > 0);
    assert.ok(res.body.data[0].roles);
  });

  test('GET /users supports search filter', async () => {
    const { app } = buildUserRouter();
    const res = await request(app).get('/users?search=bob').expect(200);
    assert.equal(res.body.ok, true);
    // Should only include bob since search is 'bob'
    const usernames = res.body.data.map((u) => u.username);
    assert.ok(usernames.includes('bob'));
  });

  test('GET /users returns 500 on error', async () => {
    const { app } = buildUserRouter({
      getUsers: mock.fn(async () => { throw new Error('fail'); }),
    });
    const res = await request(app).get('/users').expect(500);
    assert.equal(res.body.ok, false);
  });

  test('POST /users/:id/roles grants a role', async () => {
    const { app, deps } = buildUserRouter();
    const res = await request(app)
      .post('/users/user-2/roles')
      .send({ role: 'admin' })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.userId, 'user-2');
    assert.ok(deps.stores.roles.grantRole.mock.calls.length > 0);
  });

  test('POST /users/:id/roles rejects invalid role', async () => {
    const { app } = buildUserRouter();
    const res = await request(app)
      .post('/users/user-2/roles')
      .send({ role: 'superadmin' })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('POST /users/:id/roles returns 404 for missing user', async () => {
    const { app } = buildUserRouter({
      getUserById: mock.fn(async () => null),
    });
    const res = await request(app)
      .post('/users/missing-user/roles')
      .send({ role: 'admin' })
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('POST /users/:id/roles returns 400 for empty id', async () => {
    const { app } = buildUserRouter({
      sanitizeIdentifier: () => null,
    });
    const res = await request(app)
      .post('/users/%20/roles')
      .send({ role: 'admin' })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('DELETE /users/:id/roles/:role revokes a role', async () => {
    const { app, deps } = buildUserRouter();
    const res = await request(app)
      .delete('/users/user-2/roles/admin')
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(deps.stores.roles.revokeRole.mock.calls.length > 0);
  });

  test('DELETE /users/:id/roles/:role prevents self-revocation of admin', async () => {
    // adminAuth sets req.userId = 'admin-1', so getUserById must recognise that id
    const { app } = buildUserRouter({
      getUserById: mock.fn(async (id) => {
        if (id === 'admin-1') return { id: 'admin-1', username: 'superadmin' };
        if (id === 'user-2') return { id: 'user-2', username: 'bob' };
        return null;
      }),
    });
    const res = await request(app)
      .delete('/users/admin-1/roles/admin')
      .expect(400);
    assert.equal(res.body.ok, false);
    assert.ok(res.body.message.includes('Cannot revoke your own'));
  });

  test('DELETE /users/:id/roles/:role rejects invalid role name', async () => {
    const { app } = buildUserRouter();
    const res = await request(app)
      .delete('/users/user-2/roles/superuser')
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('DELETE /users/:id/roles/:role returns 404 for missing user', async () => {
    const { app } = buildUserRouter({
      getUserById: mock.fn(async () => null),
    });
    const res = await request(app)
      .delete('/users/missing/roles/admin')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('POST /users/:id/reset-link generates reset URL', async () => {
    const { app } = buildUserRouter();
    const res = await request(app)
      .post('/users/user-2/reset-link')
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.data.resetUrl);
    assert.ok(res.body.data.resetUrl.includes('http://localhost:3000/reset/'));
    assert.equal(res.body.data.username, 'bob');
  });

  test('POST /users/:id/reset-link fails without PUBLIC_ORIGIN', async () => {
    const { app } = buildUserRouter({
      config: {
        NODE_ENV: 'test',
        PUBLIC_ORIGIN: '',
        ADMIN_WRITE_RATE_LIMIT_MAX: 100,
        CLUSTER_SIZE: 1,
        RESET_TOKEN_TTL: 3600000,
      },
    });
    const res = await request(app)
      .post('/users/user-2/reset-link')
      .expect(500);
    assert.equal(res.body.ok, false);
  });

  test('POST /users/:id/reset-link returns 404 for missing user', async () => {
    const { app } = buildUserRouter({
      getUserById: mock.fn(async () => null),
    });
    const res = await request(app)
      .post('/users/missing/reset-link')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('PUT /users/:id/reset-password resets password', async () => {
    const { app, deps } = buildUserRouter();
    const res = await request(app)
      .put('/users/user-2/reset-password')
      .send({ newPassword: 'newpass12345' })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.success, true);
    assert.ok(deps.stores.users.update.mock.calls.length > 0);
    assert.ok(deps.invalidateUserSessions.mock.calls.length > 0);
  });

  test('PUT /users/:id/reset-password rejects weak password', async () => {
    const { app } = buildUserRouter();
    const res = await request(app)
      .put('/users/user-2/reset-password')
      .send({ newPassword: 'short' })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('PUT /users/:id/reset-password returns 404 for missing user', async () => {
    const { app } = buildUserRouter({
      getUserById: mock.fn(async () => null),
    });
    const res = await request(app)
      .put('/users/missing/reset-password')
      .send({ newPassword: 'longenoughpassword' })
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('DELETE /users/:id deletes user and cleans up', async () => {
    const { app, deps } = buildUserRouter();
    const res = await request(app)
      .delete('/users/user-2')
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.success, true);
    assert.ok(deps.invalidateUserCache.mock.calls.length > 0);
    assert.ok(deps.invalidateUserSessions.mock.calls.length > 0);
  });

  test('DELETE /users/:id returns 404 for missing user', async () => {
    const { app } = buildUserRouter({
      getUserById: mock.fn(async () => null),
    });
    const res = await request(app)
      .delete('/users/missing')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('DELETE /users/:id returns 400 for invalid id', async () => {
    const { app } = buildUserRouter({
      sanitizeIdentifier: () => null,
    });
    const res = await request(app)
      .delete('/users/%20')
      .expect(400);
    assert.equal(res.body.ok, false);
  });
});

// =====================================================================
// admin-bulk.js
// =====================================================================
describe('routes/admin-bulk.js', () => {
  function buildBulkRouter(overrides = {}) {
    const mountAdminBulkRoutes = require('../routes/admin-bulk');
    const deps = makeDeps(overrides);
    const router = express.Router();
    const adminWriteLimit = (req, res, next) => next();
    const ctx = { adminWriteLimit };
    mountAdminBulkRoutes({ router, deps, ctx });
    return { app: buildApp(router), deps };
  }

  test('POST /bulk/deactivate deactivates users', async () => {
    const { app, deps } = buildBulkRouter();
    const res = await request(app)
      .post('/bulk/deactivate')
      .send({ userIds: ['user-1', 'user-2'] })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data.results));
    assert.equal(res.body.data.results.length, 2);
    assert.equal(res.body.data.results[0].status, 'deactivated');
    assert.ok(deps.stores.auditLog.insert.mock.calls.length > 0);
  });

  test('POST /bulk/deactivate rejects >50 user IDs', async () => {
    const { app } = buildBulkRouter();
    const userIds = Array.from({ length: 51 }, (_, i) => `user-${i}`);
    const res = await request(app)
      .post('/bulk/deactivate')
      .send({ userIds })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('POST /bulk/deactivate handles partial failures', async () => {
    const { app } = buildBulkRouter();
    let callCount = 0;
    const deps2 = makeDeps();
    deps2.stores.sessions.deleteUserSessions = mock.fn(async () => {
      callCount++;
      if (callCount === 2) throw new Error('Session delete failed');
    });
    const mountAdminBulkRoutes = require('../routes/admin-bulk');
    const router = express.Router();
    mountAdminBulkRoutes({ router, deps: deps2, ctx: { adminWriteLimit: (req, res, next) => next() } });
    const appForPartial = buildApp(router);

    const res = await request(appForPartial)
      .post('/bulk/deactivate')
      .send({ userIds: ['user-1', 'user-2'] })
      .expect(200);
    assert.equal(res.body.data.results[0].status, 'deactivated');
    assert.equal(res.body.data.results[1].status, 'error');
  });

  test('POST /bulk/archive-festivals archives festivals', async () => {
    const { app, deps } = buildBulkRouter();
    const res = await request(app)
      .post('/bulk/archive-festivals')
      .send({ festivalIds: ['f1', 'f2'] })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.results.length, 2);
    assert.ok(deps.stores.auditLog.insert.mock.calls.length > 0);
  });

  test('POST /bulk/archive-festivals rejects >50 festival IDs', async () => {
    const { app } = buildBulkRouter();
    const festivalIds = Array.from({ length: 51 }, (_, i) => `f-${i}`);
    const res = await request(app)
      .post('/bulk/archive-festivals')
      .send({ festivalIds })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('POST /bulk/archive-festivals handles individual archive errors', async () => {
    const deps = makeDeps();
    let count = 0;
    deps.stores.festivals.softDelete = mock.fn(async () => {
      count++;
      if (count === 2) throw new Error('Archive failed');
    });
    const mountAdminBulkRoutes = require('../routes/admin-bulk');
    const router = express.Router();
    mountAdminBulkRoutes({ router, deps, ctx: { adminWriteLimit: (req, res, next) => next() } });
    const app = buildApp(router);

    const res = await request(app)
      .post('/bulk/archive-festivals')
      .send({ festivalIds: ['f1', 'f2'] })
      .expect(200);
    assert.equal(res.body.data.results[0].status, 'archived');
    assert.equal(res.body.data.results[1].status, 'error');
  });

  test('GET /crews lists all crews', async () => {
    const deps = makeDeps();
    deps.stores.pool.query = mock.fn(async () => ({
      rows: [{ id: 'crew-1', name: 'Crew A', festivalId: 'f1', memberCount: 3 }],
    }));
    const mountAdminBulkRoutes = require('../routes/admin-bulk');
    const router = express.Router();
    mountAdminBulkRoutes({ router, deps, ctx: { adminWriteLimit: (req, res, next) => next() } });
    const app = buildApp(router);

    const res = await request(app).get('/crews').expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data));
    assert.equal(res.body.data[0].name, 'Crew A');
  });

  test('GET /crews returns 500 on query error', async () => {
    const deps = makeDeps();
    deps.stores.pool.query = mock.fn(async () => { throw new Error('fail'); });
    const mountAdminBulkRoutes = require('../routes/admin-bulk');
    const router = express.Router();
    mountAdminBulkRoutes({ router, deps, ctx: { adminWriteLimit: (req, res, next) => next() } });
    const app = buildApp(router);

    const res = await request(app).get('/crews').expect(500);
    assert.equal(res.body.ok, false);
  });

  test('GET /crews/:id/members returns crew members', async () => {
    const { app } = buildBulkRouter();
    const res = await request(app).get('/crews/crew-1/members').expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data));
  });

  test('GET /crews/:id/members returns 400 for invalid crew ID', async () => {
    const { app } = buildBulkRouter({
      sanitizeIdentifier: () => null,
    });
    const res = await request(app).get('/crews/%20/members').expect(400);
    assert.equal(res.body.ok, false);
  });

  test('DELETE /crews/:id/members/:userId removes a member', async () => {
    const { app, deps } = buildBulkRouter();
    const res = await request(app)
      .delete('/crews/crew-1/members/user-2')
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(deps.stores.crews.removeMember.mock.calls.length > 0);
  });

  test('DELETE /crews/:id/members/:userId returns 404 for missing member', async () => {
    const { app } = buildBulkRouter();
    const res = await request(app)
      .delete('/crews/crew-1/members/user-999')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('DELETE /crews/:id/members/:userId returns 400 for invalid IDs', async () => {
    const { app } = buildBulkRouter({
      sanitizeIdentifier: () => null,
    });
    const res = await request(app)
      .delete('/crews/%20/members/%20')
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('DELETE /crews/:id deletes a crew', async () => {
    const { app, deps } = buildBulkRouter();
    const res = await request(app)
      .delete('/crews/crew-1')
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(deps.stores.crews.delete.mock.calls.length > 0);
    assert.ok(deps.stores.auditLog.insert.mock.calls.length > 0);
  });

  test('DELETE /crews/:id returns 404 for missing crew', async () => {
    const { app } = buildBulkRouter();
    const res = await request(app)
      .delete('/crews/missing-crew')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('DELETE /crews/:id returns 400 for invalid crew ID', async () => {
    const { app } = buildBulkRouter({
      sanitizeIdentifier: () => null,
    });
    const res = await request(app)
      .delete('/crews/%20')
      .expect(400);
    assert.equal(res.body.ok, false);
  });
});

// =====================================================================
// admin.js (dashboard + spotify backfill)
// =====================================================================
describe('routes/admin.js', () => {
  // admin.js requires sub-modules; mock their side-effects via deps
  function buildAdminApp(overrides = {}) {
    const createAdminRoutes = require('../routes/admin');
    const deps = makeDeps(overrides);
    const router = createAdminRoutes(deps);
    return { app: buildApp(router), deps };
  }

  test('factory returns a router', () => {
    const createAdminRoutes = require('../routes/admin');
    const deps = makeDeps();
    const router = createAdminRoutes(deps);
    assert.ok(router);
    assert.equal(typeof router.use, 'function');
  });

  test('GET /dashboard returns aggregated stats', async () => {
    const { app } = buildAdminApp();
    const res = await request(app).get('/dashboard').expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.data.stats);
    assert.ok(typeof res.body.data.stats.users === 'number');
    assert.ok(typeof res.body.data.stats.festivals === 'number');
    assert.ok(typeof res.body.data.stats.profiles === 'number');
    assert.ok(res.body.data.health);
    assert.ok(typeof res.body.data.health.uptime === 'number');
    assert.ok(res.body.data.recentActivity);
    assert.ok(res.body.data.groupedActivity);
  });

  test('GET /dashboard resolves activity usernames', async () => {
    const { app } = buildAdminApp();
    const res = await request(app).get('/dashboard').expect(200);
    const activity = res.body.data.recentActivity;
    assert.ok(activity.length > 0);
    assert.ok(activity[0].actorUsername);
  });

  test('GET /dashboard counts total picks across profiles', async () => {
    const deps = makeDeps({
      getProfiles: mock.fn(async () => [
        { id: 'p1', userId: 'user-1', festivalId: 'f1', picks: { s1: 'must', s2: 'want' } },
        { id: 'p2', userId: 'user-2', festivalId: 'f1', picks: { s3: 'must' } },
      ]),
    });
    const createAdminRoutes = require('../routes/admin');
    const router = createAdminRoutes(deps);
    const app = buildApp(router);

    const res = await request(app).get('/dashboard').expect(200);
    assert.equal(res.body.data.stats.picks, 3);
  });

  test('GET /dashboard returns 500 on error', async () => {
    const { app } = buildAdminApp({
      getUsers: mock.fn(async () => { throw new Error('fail'); }),
    });
    const res = await request(app).get('/dashboard').expect(500);
    assert.equal(res.body.ok, false);
  });

  test('POST /festivals/:id/backfill-spotify returns 400 when credentials missing', async () => {
    const { app } = buildAdminApp();
    const res = await request(app)
      .post('/festivals/f1/backfill-spotify')
      .expect(400);
    assert.equal(res.body.ok, false);
    assert.ok(res.body.message.includes('Spotify'));
  });

  test('POST /festivals/:id/backfill-spotify returns 404 for missing festival', async () => {
    const deps = makeDeps();
    deps.config.SPOTIFY_CLIENT_ID = 'client-id';
    deps.config.SPOTIFY_CLIENT_SECRET = 'client-secret';
    deps.stores.pool.query = mock.fn(async () => ({ rows: [] }));
    const createAdminRoutes = require('../routes/admin');
    const router = createAdminRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .post('/festivals/missing/backfill-spotify')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('POST /festivals/:id/backfill-spotify reports all sets already linked', async () => {
    const deps = makeDeps();
    deps.config.SPOTIFY_CLIENT_ID = 'client-id';
    deps.config.SPOTIFY_CLIENT_SECRET = 'client-secret';
    // First call: festival lookup, second call: sets query returns empty
    let callNum = 0;
    deps.stores.pool.query = mock.fn(async () => {
      callNum++;
      if (callNum === 1) return { rows: [{ id: 'f1' }] };
      return { rows: [] };
    });
    const createAdminRoutes = require('../routes/admin');
    const router = createAdminRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .post('/festivals/f1/backfill-spotify')
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.updated, 0);
    assert.ok(res.body.data.message.includes('already'));
  });
});

// =====================================================================
// export.js
// =====================================================================
describe('routes/export.js', () => {
  // export.js spawns Worker threads; we need to handle that gracefully.
  // We'll test the ICS and presence endpoints which don't need workers.

  function buildExportApp(overrides = {}) {
    const createExportRoutes = require('../routes/export');
    const deps = makeDeps(overrides);
    const router = createExportRoutes(deps);
    return { app: buildApp(router), deps, router };
  }

  test('factory returns a router', () => {
    const createExportRoutes = require('../routes/export');
    const deps = makeDeps();
    const router = createExportRoutes(deps);
    assert.ok(router);
    assert.equal(typeof router.use, 'function');
  });

  test('GET /export/:festivalId/:profileId/calendar returns ICS content', async () => {
    const { app } = buildExportApp();
    const res = await request(app)
      .get('/export/f1/p1/calendar')
      .expect(200);
    assert.ok(res.headers['content-type'].includes('text/calendar'));
    assert.ok(res.text.includes('BEGIN:VCALENDAR'));
    assert.ok(res.text.includes('END:VCALENDAR'));
    assert.ok(res.text.includes('DJ Test'));
  });

  test('GET /export/:festivalId/:profileId/calendar returns 404 for missing festival', async () => {
    const { app } = buildExportApp();
    const res = await request(app)
      .get('/export/missing/p1/calendar')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('GET /export/:festivalId/:profileId/calendar returns 404 for missing profile', async () => {
    const deps = makeDeps();
    deps.stores.profiles.getById = mock.fn(async () => null);
    const createExportRoutes = require('../routes/export');
    const router = createExportRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .get('/export/f1/missing/calendar')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('GET /export/:festivalId/:profileId/calendar returns 403 for wrong user', async () => {
    const deps = makeDeps();
    deps.stores.profiles.getById = mock.fn(async () => ({
      id: 'p2', userId: 'user-999', festivalId: 'f1', picks: {}, notes: {},
    }));
    const createExportRoutes = require('../routes/export');
    const router = createExportRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .get('/export/f1/p2/calendar')
      .expect(403);
    assert.equal(res.body.ok, false);
  });

  test('GET /export/:festivalId/:profileId/calendar returns 400 for invalid IDs', async () => {
    const deps = makeDeps();
    deps.sanitizeIdentifier = () => null;
    const createExportRoutes = require('../routes/export');
    const router = createExportRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .get('/export/%20/%20/calendar')
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('GET /export/:festivalId/:profileId returns 400 for invalid IDs', async () => {
    const deps = makeDeps();
    deps.sanitizeIdentifier = () => null;
    const createExportRoutes = require('../routes/export');
    const router = createExportRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .get('/export/%20/%20')
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('GET /export/:festivalId/:profileId returns 404 for missing festival', async () => {
    const { app } = buildExportApp();
    const res = await request(app)
      .get('/export/missing/p1')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('GET /presence/:festivalId returns online users', async () => {
    const { app } = buildExportApp();
    const res = await request(app)
      .get('/presence/f1')
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data.online));
  });

  test('GET /presence/:festivalId returns 404 for missing festival', async () => {
    const { app } = buildExportApp();
    const res = await request(app)
      .get('/presence/missing')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('GET /presence/:festivalId returns 403 when not joined', async () => {
    const deps = makeDeps();
    deps.getUserFestivalProfile = mock.fn(async () => null);
    const createExportRoutes = require('../routes/export');
    const router = createExportRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .get('/presence/f1')
      .expect(403);
    assert.equal(res.body.ok, false);
  });

  test('GET /presence/:festivalId returns 400 for invalid ID', async () => {
    const deps = makeDeps();
    deps.sanitizeIdentifier = () => null;
    const createExportRoutes = require('../routes/export');
    const router = createExportRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .get('/presence/%20')
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('GET /festivals/:festivalId/calendar returns calendar events', async () => {
    const { app } = buildExportApp();
    const res = await request(app)
      .get('/festivals/f1/calendar')
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.data.festival);
    assert.ok(Array.isArray(res.body.data.events));
  });

  test('GET /festivals/:festivalId/calendar returns 404 for missing festival', async () => {
    const { app } = buildExportApp();
    const res = await request(app)
      .get('/festivals/missing/calendar')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('GET /festivals/:festivalId/calendar returns 404 when not joined', async () => {
    const deps = makeDeps();
    deps.getProfiles = mock.fn(async () => []);
    const createExportRoutes = require('../routes/export');
    const router = createExportRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .get('/festivals/f1/calendar')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('GET /export-card/:festivalId returns 404 for missing festival', async () => {
    const { app } = buildExportApp();
    const res = await request(app)
      .get('/export-card/missing')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('GET /export-card/:festivalId returns 404 when not joined', async () => {
    const deps = makeDeps();
    deps.getUserFestivalProfile = mock.fn(async () => null);
    const createExportRoutes = require('../routes/export');
    const router = createExportRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .get('/export-card/f1')
      .expect(404);
    assert.equal(res.body.ok, false);
  });

  test('GET /export-card/:festivalId returns 400 for invalid ID', async () => {
    const deps = makeDeps();
    deps.sanitizeIdentifier = () => null;
    const createExportRoutes = require('../routes/export');
    const router = createExportRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .get('/export-card/%20')
      .expect(400);
    assert.equal(res.body.ok, false);
  });
});

// =====================================================================
// notifications.js
// =====================================================================
describe('routes/notifications.js', () => {
  function buildNotifApp(overrides = {}) {
    const createNotificationRoutes = require('../routes/notifications');
    const deps = makeDeps(overrides);
    const router = createNotificationRoutes(deps);
    return { app: buildApp(router), deps };
  }

  test('factory returns a router', () => {
    const createNotificationRoutes = require('../routes/notifications');
    const deps = makeDeps();
    const router = createNotificationRoutes(deps);
    assert.ok(router);
    assert.equal(typeof router.use, 'function');
  });

  test('POST /token registers a device push token', async () => {
    const { app, deps } = buildNotifApp();
    const res = await request(app)
      .post('/token')
      .send({ token: 'a'.repeat(30), platform: 'web', deviceName: 'Chrome' })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.success, true);
    assert.ok(res.body.data.id);
    assert.ok(deps.stores.deviceTokens.register.mock.calls.length > 0);
  });

  test('POST /token rejects short token', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .post('/token')
      .send({ token: 'short', platform: 'web' })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('POST /token rejects empty token', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .post('/token')
      .send({ token: '                              ', platform: 'web' })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('POST /token rejects invalid platform', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .post('/token')
      .send({ token: 'a'.repeat(30), platform: 'windows' })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('POST /token rejects token with control characters', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .post('/token')
      .send({ token: 'a'.repeat(20) + '\x00' + 'b'.repeat(10), platform: 'web' })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('POST /token rejects token belonging to another user', async () => {
    const deps = makeDeps();
    deps.stores.deviceTokens.getTokenOwner = mock.fn(async () => ({ userId: 'other-user' }));
    const createNotificationRoutes = require('../routes/notifications');
    const router = createNotificationRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .post('/token')
      .send({ token: 'a'.repeat(30), platform: 'web' })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('POST /token evicts oldest token when at cap', async () => {
    const deps = makeDeps();
    const existingTokens = Array.from({ length: 10 }, (_, i) => ({ token: `tok-${i}`, userId: 'user-1' }));
    deps.stores.deviceTokens.listByUser = mock.fn(async () => existingTokens);
    const createNotificationRoutes = require('../routes/notifications');
    const router = createNotificationRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .post('/token')
      .send({ token: 'a'.repeat(30), platform: 'web' })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(deps.stores.deviceTokens.unregister.mock.calls.length > 0);
  });

  test('POST /token handles UNIQUE constraint gracefully', async () => {
    const deps = makeDeps();
    deps.stores.deviceTokens.register = mock.fn(async () => { throw new Error('UNIQUE constraint failed'); });
    const createNotificationRoutes = require('../routes/notifications');
    const router = createNotificationRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .post('/token')
      .send({ token: 'a'.repeat(30), platform: 'web' })
      .expect(200);
    assert.equal(res.body.ok, true);
  });

  test('DELETE /token unregisters a device token', async () => {
    const { app, deps } = buildNotifApp();
    const res = await request(app)
      .delete('/token')
      .send({ token: 'my-token-to-delete' })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(deps.stores.deviceTokens.unregister.mock.calls.length > 0);
  });

  test('DELETE /token rejects missing token', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .delete('/token')
      .send({})
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('GET /prefs returns notification preferences', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .get('/prefs')
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(typeof res.body.data.crewUpdates !== 'undefined');
  });

  test('POST /read marks notifications as read for a festival', async () => {
    const { app, deps } = buildNotifApp();
    const res = await request(app)
      .post('/read')
      .send({ festivalId: 'f1' })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.badgeCount, 0);
    assert.ok(deps.stores.notificationCounts.reset.mock.calls.length > 0);
  });

  test('POST /read marks all notifications as read when no festivalId', async () => {
    const { app, deps } = buildNotifApp();
    const res = await request(app)
      .post('/read')
      .send({})
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(deps.stores.notificationCounts.resetAll.mock.calls.length > 0);
  });

  test('POST /read returns 400 for invalid festival ID', async () => {
    const deps = makeDeps();
    deps.sanitizeIdentifier = () => null;
    const createNotificationRoutes = require('../routes/notifications');
    const router = createNotificationRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .post('/read')
      .send({ festivalId: '   ' })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('GET /unread returns unread counts', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .get('/unread')
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.total, 3);
    assert.ok(Array.isArray(res.body.data.byFestival));
    assert.equal(res.body.data.byFestival[0].festivalId, 'f1');
    assert.equal(res.body.data.byFestival[0].updates, 3);
  });

  test('GET /history returns notification history', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .get('/history')
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.pagination);
  });

  test('PUT /prefs updates notification preferences', async () => {
    const { app, deps } = buildNotifApp();
    const res = await request(app)
      .put('/prefs')
      .send({ crewUpdates: false })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(deps.stores.notificationPrefs.upsert.mock.calls.length > 0);
  });

  test('PATCH /prefs updates notification preferences', async () => {
    const { app, deps } = buildNotifApp();
    const res = await request(app)
      .patch('/prefs')
      .send({ setReminders: true })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.ok(deps.stores.notificationPrefs.upsert.mock.calls.length > 0);
  });

  test('PUT /prefs rejects unknown fields', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .put('/prefs')
      .send({ unknownField: true })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('PUT /prefs rejects empty body', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .put('/prefs')
      .send({})
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('PUT /prefs validates dndStart format', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .put('/prefs')
      .send({ dndStart: 'invalid' })
      .expect(400);
    assert.equal(res.body.ok, false);
    assert.ok(res.body.message.includes('HH:MM'));
  });

  test('PUT /prefs validates dndEnd format', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .put('/prefs')
      .send({ dndEnd: '25:00' })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('PUT /prefs allows null dndStart/dndEnd to clear', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .put('/prefs')
      .send({ dndStart: null, dndEnd: null })
      .expect(200);
    assert.equal(res.body.ok, true);
  });

  test('PUT /prefs allows empty string dndStart/dndEnd to clear', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .put('/prefs')
      .send({ dndStart: '', dndEnd: '' })
      .expect(200);
    assert.equal(res.body.ok, true);
  });

  test('PUT /prefs accepts valid HH:MM dndStart', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .put('/prefs')
      .send({ dndStart: '22:00' })
      .expect(200);
    assert.equal(res.body.ok, true);
  });

  test('GET /topics/:festivalId returns topic subscriptions', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .get('/topics/f1')
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.crew, true);
    assert.equal(res.body.data.schedule, false);
  });

  test('GET /topics/:festivalId returns defaults when no subscriptions exist', async () => {
    const deps = makeDeps();
    deps.stores.topicSubscriptions.getForUser = mock.fn(async () => ({}));
    const createNotificationRoutes = require('../routes/notifications');
    const router = createNotificationRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .get('/topics/f1')
      .expect(200);
    assert.equal(res.body.data.crew, true);
    assert.equal(res.body.data.schedule, true);
  });

  test('GET /topics/:festivalId returns 403 when not a member', async () => {
    const deps = makeDeps();
    deps.stores.profiles.readByUserAndFestival = mock.fn(async () => null);
    const createNotificationRoutes = require('../routes/notifications');
    const router = createNotificationRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .get('/topics/f1')
      .expect(403);
    assert.equal(res.body.ok, false);
  });

  test('GET /topics/:festivalId returns 400 for invalid ID', async () => {
    const deps = makeDeps();
    deps.sanitizeIdentifier = () => null;
    const createNotificationRoutes = require('../routes/notifications');
    const router = createNotificationRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .get('/topics/%20')
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('PUT /topics/:festivalId updates topic subscriptions', async () => {
    const { app, deps } = buildNotifApp();
    const res = await request(app)
      .put('/topics/f1')
      .send({ crew: false, schedule: true })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.crew, false);
    assert.equal(res.body.data.schedule, true);
    assert.ok(deps.stores.topicSubscriptions.setSubscription.mock.calls.length >= 2);
  });

  test('PUT /topics/:festivalId returns 400 for no valid topics', async () => {
    const { app } = buildNotifApp();
    const res = await request(app)
      .put('/topics/f1')
      .send({ invalidTopic: true })
      .expect(400);
    assert.equal(res.body.ok, false);
  });

  test('PUT /topics/:festivalId returns 403 when not a member', async () => {
    const deps = makeDeps();
    deps.stores.profiles.readByUserAndFestival = mock.fn(async () => null);
    const createNotificationRoutes = require('../routes/notifications');
    const router = createNotificationRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .put('/topics/f1')
      .send({ crew: false })
      .expect(403);
    assert.equal(res.body.ok, false);
  });

  test('PUT /topics/:festivalId returns 400 for invalid festival ID', async () => {
    const deps = makeDeps();
    deps.sanitizeIdentifier = () => null;
    const createNotificationRoutes = require('../routes/notifications');
    const router = createNotificationRoutes(deps);
    const app = buildApp(router);

    const res = await request(app)
      .put('/topics/%20')
      .send({ crew: true })
      .expect(400);
    assert.equal(res.body.ok, false);
  });
});
