'use strict';

const assert = require('node:assert/strict');
const { describe, it, mock } = require('node:test');

const createActivityRoutes = require('../routes/activity');

// ---------------------------------------------------------------------------
// Helpers — mock factories (same pattern as tests/pages.test.js)
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
  return fn;
}

function mockReq(overrides = {}) {
  return {
    params: {},
    query: {},
    path: '/',
    method: 'GET',
    headers: {},
    user: { userId: 'user-1' },
    validatedParams: { crewId: 'crew-1' },
    validatedQuery: { cursor: undefined, limit: 50 },
    ...overrides,
  };
}

function mockRes() {
  const res = {
    _status: 200,
    _headers: {},
    _sent: null,
    headersSent: false,
    status(code) { res._status = code; return res; },
    setHeader(k, v) { res._headers[k] = v; return res; },
    json(body) { res._sent = body; res.headersSent = true; return res; },
    send(body) { res._sent = body; res.headersSent = true; return res; },
    end() { res.headersSent = true; return res; },
  };
  return res;
}

function buildDeps(overrides = {}) {
  const express = createMockExpress();
  return {
    express,
    stores: {
      crews: {
        getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
      },
      activity: {
        getByCrew: mock.fn(async () => ({
          items: [{ id: 'act-1', type: 'join', userId: 'user-1', createdAt: '2026-06-01' }],
          nextCursor: null,
        })),
      },
      ...overrides.stores,
    },
    userAuth: (_req, _res, next) => next(),
    sendSuccess: (res, data) => res.json({ ok: true, ...data }),
    sendError: (res, status, msg, code) => res.status(status).json({ ok: false, code, message: msg }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      FORBIDDEN: 'FORBIDDEN',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    log: {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
      debug: mock.fn(),
    },
    sanitizeIdentifier: (v) => {
      if (typeof v !== 'string') return null;
      const trimmed = v.trim().slice(0, 100);
      if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
      return trimmed;
    },
    rateLimit: (max, label) => (_req, _res, next) => next(),
    schemas: {
      crewIdParams: { parse: (v) => v },
      paginationQuery: { parse: (v) => v },
    },
    validateParams: (_schema) => (req, _res, next) => next(),
    validateQuery: (_schema) => (req, _res, next) => next(),
    ...overrides,
  };
}

function getHandler(router, path) {
  const route = router._routes.find((r) => r.path === path);
  if (!route) throw new Error(`Route not found: ${path}`);
  // Return the last handler (the async controller), skipping middleware
  return route.handlers[route.handlers.length - 1];
}

function getMiddleware(router, path) {
  const route = router._routes.find((r) => r.path === path);
  if (!route) throw new Error(`Route not found: ${path}`);
  return route.handlers;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('activity: route registration', () => {
  it('registers GET /crews/:crewId/activity', () => {
    const router = createActivityRoutes(buildDeps());
    const paths = router._routes.map((r) => r.path);
    assert.ok(paths.includes('/crews/:crewId/activity'));
  });

  it('uses GET method', () => {
    const router = createActivityRoutes(buildDeps());
    const route = router._routes.find((r) => r.path === '/crews/:crewId/activity');
    assert.equal(route.method, 'GET');
  });

  it('has userAuth, rateLimit, validateParams, validateQuery middleware', () => {
    const router = createActivityRoutes(buildDeps());
    const mw = getMiddleware(router, '/crews/:crewId/activity');
    // Should have: userAuth, readLimit, validateParams, validateQuery, handler = 5
    assert.ok(mw.length >= 5, `Expected at least 5 handlers (middleware + controller), got ${mw.length}`);
  });
});

describe('activity: GET /crews/:crewId/activity', () => {
  it('returns activity items for a crew member', async () => {
    const deps = buildDeps();
    const router = createActivityRoutes(deps);
    const handler = getHandler(router, '/crews/:crewId/activity');

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._sent.ok, true);
    assert.ok(Array.isArray(res._sent.items));
    assert.equal(res._sent.items.length, 1);
    assert.equal(res._sent.items[0].id, 'act-1');
    assert.equal(res._sent.nextCursor, null);
  });

  it('returns 400 for invalid crew ID', async () => {
    const deps = buildDeps();
    const router = createActivityRoutes(deps);
    const handler = getHandler(router, '/crews/:crewId/activity');

    const req = mockReq({
      validatedParams: { crewId: '!!invalid!!' },
    });
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 400);
    assert.equal(res._sent.ok, false);
    assert.equal(res._sent.code, 'INVALID_INPUT');
  });

  it('returns 403 when user is not a crew member', async () => {
    const deps = buildDeps({
      stores: {
        crews: { getMember: mock.fn(async () => null) },
        activity: { getByCrew: mock.fn(async () => ({ items: [], nextCursor: null })) },
      },
    });
    const router = createActivityRoutes(deps);
    const handler = getHandler(router, '/crews/:crewId/activity');

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 403);
    assert.equal(res._sent.ok, false);
    assert.equal(res._sent.code, 'FORBIDDEN');
  });

  it('returns 500 when store throws an error', async () => {
    const deps = buildDeps({
      stores: {
        crews: { getMember: mock.fn(async () => { throw new Error('DB down'); }) },
        activity: { getByCrew: mock.fn(async () => ({ items: [], nextCursor: null })) },
      },
    });
    const router = createActivityRoutes(deps);
    const handler = getHandler(router, '/crews/:crewId/activity');

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 500);
    assert.equal(res._sent.ok, false);
    assert.equal(res._sent.code, 'INTERNAL_ERROR');
    assert.equal(deps.log.error.mock.callCount(), 1);
  });

  it('passes cursor and limit from validated query', async () => {
    const getByCrewMock = mock.fn(async () => ({
      items: [],
      nextCursor: 'cursor-2',
    }));
    const deps = buildDeps({
      stores: {
        crews: { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })) },
        activity: { getByCrew: getByCrewMock },
      },
    });
    const router = createActivityRoutes(deps);
    const handler = getHandler(router, '/crews/:crewId/activity');

    const req = mockReq({
      validatedQuery: { cursor: 'cursor-1', limit: 25 },
    });
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 200);
    assert.equal(getByCrewMock.mock.callCount(), 1);
    const [crewId, opts] = getByCrewMock.mock.calls[0].arguments;
    assert.equal(crewId, 'crew-1');
    assert.equal(opts.cursor, 'cursor-1');
    assert.equal(opts.limit, 25);
    assert.equal(res._sent.nextCursor, 'cursor-2');
  });

  it('returns 500 when activity store throws', async () => {
    const deps = buildDeps({
      stores: {
        crews: { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })) },
        activity: { getByCrew: mock.fn(async () => { throw new Error('Query failed'); }) },
      },
    });
    const router = createActivityRoutes(deps);
    const handler = getHandler(router, '/crews/:crewId/activity');

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 500);
    assert.equal(res._sent.ok, false);
    assert.equal(res._sent.code, 'INTERNAL_ERROR');
  });

  it('uses noopLimit when rateLimit is not a function', () => {
    // When rateLimit is not a function, the route should still register fine
    const deps = buildDeps({ rateLimit: 'not-a-function' });
    const router = createActivityRoutes(deps);
    const route = router._routes.find((r) => r.path === '/crews/:crewId/activity');
    assert.ok(route, 'Route should still be registered');
  });
});
