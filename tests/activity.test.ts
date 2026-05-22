import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import express from 'express';
import createActivityRoutes from '../routes/activity';

function mockReq(overrides: any = {}): any {
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

function mockRes(): any {
  const res: any = {
    _status: 200,
    _headers: {} as any,
    _sent: null as any,
    headersSent: false,
    status(code: any) { res._status = code; return res; },
    setHeader(k: any, v: any) { res._headers[k] = v; return res; },
    json(body: any) { res._sent = body; res.headersSent = true; return res; },
    send(body: any) { res._sent = body; res.headersSent = true; return res; },
    end() { res.headersSent = true; return res; },
  };
  return res;
}

function buildDeps(overrides: any = {}): any {
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
    userAuth: (_req: any, _res: any, next: any) => next(),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: any, msg: any, code: any) => res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
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
    sanitizeIdentifier: (v: any) => {
      if (typeof v !== 'string') return null;
      const trimmed = v.trim().slice(0, 100);
      if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
      return trimmed;
    },
    rateLimit: (max: any, label: any) => (_req: any, _res: any, next: any) => next(),
    schemas: {
      crewIdParams: { parse: (v: any) => v },
      paginationQuery: { parse: (v: any) => v },
    },
    validateParams: (_schema: any) => (req: any, _res: any, next: any) => next(),
    validateQuery: (_schema: any) => (req: any, _res: any, next: any) => next(),
    ...overrides,
  };
}

function getHandler(router: any, routePath: string): any {
  const layer = router.stack.find((l: any) => l.route && l.route.path === routePath);
  if (!layer) throw new Error(`Route not found: ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function getMiddleware(router: any, routePath: string): any {
  const layer = router.stack.find((l: any) => l.route && l.route.path === routePath);
  if (!layer) throw new Error(`Route not found: ${routePath}`);
  return layer.route.stack.map((s: any) => s.handle);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('activity: route registration', () => {
  it('registers GET /crews/:crewId/activity', () => {
    const router = createActivityRoutes(buildDeps());
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/crews/:crewId/activity');
    assert.ok(layer, 'route should exist');
  });

  it('uses GET method', () => {
    const router = createActivityRoutes(buildDeps());
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/crews/:crewId/activity');
    assert.ok((layer!.route as any).methods.get, 'should use GET method');
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
    assert.equal(res._sent.error, null);
    assert.ok(Array.isArray(res._sent.data.items));
    assert.equal(res._sent.data.items.length, 1);
    assert.equal(res._sent.data.items[0].id, 'act-1');
    assert.equal(res._sent.data.nextCursor, null);
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
    assert.equal(res._sent.data, null);
    assert.equal(res._sent.error.code, 'INVALID_INPUT');
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
    assert.equal(res._sent.data, null);
    assert.equal(res._sent.error.code, 'FORBIDDEN');
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
    assert.equal(res._sent.data, null);
    assert.equal(res._sent.error.code, 'INTERNAL_ERROR');
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
    const [crewId, opts] = (getByCrewMock.mock.calls[0] as any).arguments;
    assert.equal(crewId, 'crew-1');
    assert.equal(opts.cursor, 'cursor-1');
    assert.equal(opts.limit, 25);
    assert.equal(res._sent.data.nextCursor, 'cursor-2');
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
    assert.equal(res._sent.data, null);
    assert.equal(res._sent.error.code, 'INTERNAL_ERROR');
  });

  it('uses noopLimit when rateLimit is not a function', () => {
    // When rateLimit is not a function, the route should still register fine
    const deps = buildDeps({ rateLimit: 'not-a-function' });
    const router = createActivityRoutes(deps);
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/crews/:crewId/activity');
    assert.ok(layer, 'Route should still be registered');
  });
});
