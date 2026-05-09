'use strict';

const assert = require('node:assert/strict');
const { describe, it, mock } = require('node:test');
const crypto = require('crypto');

const createPageRoutes = require('../routes/pages');

// ---------------------------------------------------------------------------
// Helpers — mock factories
// ---------------------------------------------------------------------------

function createMockRouter() {
  const routes = [];
  const handler = (method) => (pathPattern, ...handlers) => {
    routes.push({ method, path: pathPattern, handlers });
  };
  return {
    get: handler('GET'),
    post: handler('POST'),
    put: handler('PUT'),
    delete: handler('DELETE'),
    use: handler('USE'),
    _routes: routes,
  };
}

function createMockExpress() {
  const fn = () => {};
  fn.Router = () => createMockRouter();
  fn.static = () => (req, res, next) => next();
  return fn;
}

function mockReq(overrides = {}) {
  return {
    params: {},
    query: {},
    path: '/',
    method: 'GET',
    headers: {},
    ...overrides,
  };
}

function mockRes() {
  const res = {
    _status: 200,
    _headers: {},
    _sent: null,
    _redirectUrl: null,
    _sentFile: null,
    headersSent: false,
    status(code) { res._status = code; return res; },
    setHeader(k, v) { res._headers[k] = v; return res; },
    send(body) { res._sent = body; res.headersSent = true; return res; },
    json(body) { res._sent = JSON.stringify(body); res.headersSent = true; return res; },
    redirect(url) { res._redirectUrl = url; res.headersSent = true; return res; },
    sendFile(filePath, cb) { res._sentFile = filePath; if (cb) cb(); return res; },
    end() { res.headersSent = true; return res; },
  };
  return res;
}

function buildDeps(overrides = {}) {
  const express = createMockExpress();
  return {
    express,
    config: {
      PUBLIC_ORIGIN: 'https://festie.us',
      PUBLIC_DIR: 'C:\\fake\\public',
      AUTH_RATE_LIMIT_MAX: 10,
      ...overrides.config,
    },
    rateLimit: () => (req, res, next) => next(),
    pool: {
      query: async () => ({ rows: [], rowCount: 0 }),
      ...overrides.pool,
    },
    state: {
      _adminResetTokens: new Map(),
      ...overrides.state,
    },
    log: {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
      debug: mock.fn(),
    },
    sendError: (res, status, msg, code) => res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
    ErrorCodes: { NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    ...overrides,
  };
}

function getHandler(router, path) {
  const route = router._routes.find((r) => r.path === path);
  if (!route) throw new Error(`Route not found: ${path}`);
  return route.handlers[route.handlers.length - 1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pages: route registration', () => {
  it('registers all expected routes', () => {
    const router = createPageRoutes(buildDeps());
    const paths = router._routes.map((r) => r.path);

    assert.ok(paths.includes('/join/:code'));
    assert.ok(paths.includes('/reset/:token'));
    assert.ok(paths.includes('/reset-password'));
    assert.ok(paths.includes('/privacy'));
    assert.ok(paths.includes('/terms'));
    assert.ok(paths.includes('/security-whitepaper'));
    assert.ok(paths.includes('/{*splat}'));
  });

  it('all routes use GET method', () => {
    const router = createPageRoutes(buildDeps());
    for (const route of router._routes) {
      assert.equal(route.method, 'GET');
    }
  });
});

describe('pages: /join/:code', () => {
  it('redirects with valid code', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/join/:code');

    const res = mockRes();
    handler(mockReq({ params: { code: 'ABC123' } }), res);
    assert.equal(res._redirectUrl, '/?joinCrew=ABC123');
  });

  it('redirects to / for empty code', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/join/:code');

    const res = mockRes();
    handler(mockReq({ params: { code: '' } }), res);
    assert.equal(res._redirectUrl, '/');
  });

  it('strips special characters', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/join/:code');

    const res = mockRes();
    handler(mockReq({ params: { code: 'AB<script>12' } }), res);
    assert.equal(res._redirectUrl, '/?joinCrew=ABscript12');
  });

  it('truncates to 10 chars', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/join/:code');

    const res = mockRes();
    handler(mockReq({ params: { code: 'A'.repeat(20) } }), res);
    assert.equal(res._redirectUrl, '/?joinCrew=' + 'A'.repeat(10));
  });
});

describe('pages: /reset/:token', () => {
  it('shows error page for invalid token format', async () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token: 'short' } }), res);

    assert.ok(res._sent);
    assert.ok(res._sent.includes('Invalid or expired'), 'should show error message');
    assert.equal(res._headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(res._headers['Cache-Control'], 'no-store, no-cache, must-revalidate');
  });

  it('shows error page for empty token', async () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token: '' } }), res);
    assert.ok(res._sent.includes('Invalid or expired'));
  });

  it('shows form page for valid token found in admin reset tokens', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const state = {
      _adminResetTokens: new Map([
        [tokenHash, { userId: 'user-1', expiresAt: Date.now() + 3600000 }],
      ]),
    };
    const router = createPageRoutes(buildDeps({ state }));
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token } }), res);

    assert.ok(res._sent);
    assert.ok(res._sent.includes('Reset Password'), 'should render reset form');
    assert.ok(res._sent.includes('resetForm'), 'should contain the form element');
  });

  it('shows error for expired admin token', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const state = {
      _adminResetTokens: new Map([
        [tokenHash, { userId: 'user-1', expiresAt: Date.now() - 1000 }],
      ]),
    };
    const router = createPageRoutes(buildDeps({ state }));
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token } }), res);
    assert.ok(res._sent.includes('Invalid or expired'));
  });

  it('falls back to database when token is not in admin map', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = {
      query: mock.fn(async () => ({
        rows: [{ userId: 'user-1', expiresAt: new Date(Date.now() + 3600000) }],
      })),
    };
    const router = createPageRoutes(buildDeps({ pool }));
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token } }), res);

    assert.equal(pool.query.mock.callCount(), 1);
    assert.ok(res._sent.includes('Reset Password'));
  });

  it('shows error when database returns no rows', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = {
      query: mock.fn(async () => ({ rows: [] })),
    };
    const router = createPageRoutes(buildDeps({ pool }));
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token } }), res);
    assert.ok(res._sent.includes('Invalid or expired'));
  });

  it('shows error page when database query throws', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = {
      query: mock.fn(async () => { throw new Error('DB down'); }),
    };
    const router = createPageRoutes(buildDeps({ pool }));
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token } }), res);
    assert.ok(res._sent.includes('Failed to load reset page'));
  });

  it('sets CSP header on all responses', async () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token: 'x' } }), res);
    assert.ok(res._headers['Content-Security-Policy']);
  });
});

describe('pages: /reset-password', () => {
  it('shows error for missing token query parameter', async () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/reset-password');

    const res = mockRes();
    await handler(mockReq({ query: {} }), res);
    assert.ok(res._sent.includes('Invalid or expired'));
  });

  it('shows error for invalid token format', async () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/reset-password');

    const res = mockRes();
    await handler(mockReq({ query: { token: 'bad-token' } }), res);
    assert.ok(res._sent.includes('Invalid or expired'));
  });

  it('shows form for valid token in database', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = {
      query: mock.fn(async () => ({ rows: [{ id: 1 }] })),
    };
    const router = createPageRoutes(buildDeps({ pool }));
    const handler = getHandler(router, '/reset-password');

    const res = mockRes();
    await handler(mockReq({ query: { token } }), res);
    assert.ok(res._sent.includes('Reset Password'));
    assert.equal(res._headers['Referrer-Policy'], 'no-referrer');
  });

  it('shows expired message when database returns no rows', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = {
      query: mock.fn(async () => ({ rows: [] })),
    };
    const router = createPageRoutes(buildDeps({ pool }));
    const handler = getHandler(router, '/reset-password');

    const res = mockRes();
    await handler(mockReq({ query: { token } }), res);
    assert.ok(res._sent.includes('expired or already been used'));
  });

  it('shows error when database throws', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = {
      query: mock.fn(async () => { throw new Error('fail'); }),
    };
    const router = createPageRoutes(buildDeps({ pool }));
    const handler = getHandler(router, '/reset-password');

    const res = mockRes();
    await handler(mockReq({ query: { token } }), res);
    assert.ok(res._sent.includes('Failed to load reset page'));
  });
});

describe('pages: static routes', () => {
  it('/privacy serves privacy.html', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/privacy');

    const res = mockRes();
    handler(mockReq(), res);
    assert.ok(res._sentFile);
    assert.ok(res._sentFile.includes('privacy.html'));
  });

  it('/terms serves terms.html', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/terms');

    const res = mockRes();
    handler(mockReq(), res);
    assert.ok(res._sentFile.includes('terms.html'));
  });

  it('/security-whitepaper serves security-whitepaper.html', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/security-whitepaper');

    const res = mockRes();
    handler(mockReq(), res);
    assert.ok(res._sentFile.includes('security-whitepaper.html'));
  });
});

describe('pages: SPA catch-all', () => {
  it('returns 404 for /uploads/ paths', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/{*splat}');

    const res = mockRes();
    handler(mockReq({ path: '/uploads/avatar.png' }), res, () => {});
    assert.equal(res._status, 404);
  });

  it('sets no-store cache header for non-upload paths', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/{*splat}');

    const res = mockRes();
    handler(mockReq({ path: '/dashboard' }), res, () => {});
    assert.equal(res._headers['Cache-Control'], 'no-store');
  });

  it('serves index.html for SPA routes', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/{*splat}');

    const res = mockRes();
    handler(mockReq({ path: '/festivals/1/schedule' }), res, () => {});
    assert.ok(res._sentFile, 'should attempt to serve SPA index');
  });
});
