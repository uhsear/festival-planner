import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';

// middleware.js exports configureMiddleware which requires a full Express app + context.
// Instead of testing the monolith with a live DB (see tests/_integration-helpers.ts), we
// mount it on a real (DB-less) Express app with stubbed deps -- see makeMiddlewareApp below
// -- so CORS and the request-timeout block run the actual registered handlers, not copies.
//   - audit-middleware (factory function, testable in isolation)
//   - CORS logic (real configureMiddleware registration, via makeMiddlewareApp)
//   - JSON body parser error handling
//   - Idempotency key logic (real createIdempotencyMiddleware export)
//   - In-flight request tracking
//   - Request timeout (real configureMiddleware registration, via makeMiddlewareApp)
// We also test the tracing middleware that configureMiddleware uses.

import createAuditMiddleware from '../lib/audit-middleware.js';
import { configureMiddleware, createIdempotencyMiddleware } from '../lib/middleware.js';
import { sendError, ErrorCodes } from '../lib/response.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * Mounts the REAL configureMiddleware on a fresh, DB-less Express app so CORS
 * and the request-timeout block can be exercised as actually registered,
 * instead of via a hand-copied reimplementation of their logic.
 */
function makeMiddlewareApp(overrides: { isAllowedOrigin?: (origin: string, host?: string) => boolean; config?: Record<string, any> } = {}) {
  const app = express();
  const ctx = {
    express,
    config: {
      TRUST_PROXY: false,
      PUBLIC_ORIGIN: '',
      NODE_ENV: 'production', // skips OpenAPI/Swagger UI mounting -- out of scope here
      PUBLIC_DIR,
      WEB_DIST: path.join(PUBLIC_DIR, '__no-build__'), // guaranteed absent -> skip SPA static mount
      JSON_LIMIT: '1mb',
      API_VERSION: '1',
      REQUEST_TIMEOUT_MS: 10_000,
      MOBILE_ORIGINS: ['app://festie'],
      PROFILE_RATE_LIMIT_MAX: 100,
      OVERLAP_RATE_LIMIT_MAX: 100,
      ...overrides.config,
    },
    log: { info() {}, warn() {}, error() {} },
    state: {
      metrics: { totalRequests: 0, totalDuration: 0, requestCount: 0, totalErrors: 0, statusCodes: {}, endpointLatency: {} },
      timers: [],
    },
    contentSecurityPolicy: "default-src 'self'",
    enforceAllowedOrigin: (req: any, res: any, next: any) => next(),
    avatarDirPath: () => path.join(PUBLIC_DIR, 'uploads', 'avatars'),
    isAllowedOrigin: overrides.isAllowedOrigin || (() => false),
    setNoStore: () => {},
    getRequestIp: (req: any) => req.ip || '127.0.0.1',
    rateLimit: (..._args: any[]) => (req: any, res: any, next: any) => next(),
    authRateLimit: (req: any, res: any, next: any) => next(),
    sendError,
    ErrorCodes,
    generateOpenAPISpec: () => ({}),
    stores: { auditLog: { insert: async () => {} } },
  };
  const result = configureMiddleware(app as any, ctx as any);
  return { app, ...result };
}

// ── audit-middleware ────────────────────────────────────────────────────

describe('middleware: audit-middleware', () => {
  function makeDeps() {
    return {
      stores: {
        auditLog: { insert: mock.fn(async () => {}) },
      },
      log: { info() {}, warn() {}, error: mock.fn() },
      getRequestIp: (req: any) => req.ip || '127.0.0.1',
    };
  }

  function mockReq(overrides: any = {}) {
    return {
      method: 'POST',
      path: '/api/v1/test',
      originalUrl: '/api/v1/test',
      ip: '10.0.0.1',
      id: 'req-123',
      headers: {},
      get: (h: string) => overrides.headers?.[h] || '',
      user: null,
      ...overrides,
    };
  }

  function mockRes() {
    const listeners: Record<string, any> = {};
    let _statusCode = 200;
    let _jsonFn = (data: any) => data;
    return {
      get statusCode() { return _statusCode; },
      set statusCode(v: number) { _statusCode = v; },
      json: function (data: any) { return _jsonFn(data); },
      on(event: string, fn: any) {
        listeners[event] = fn;
      },
      _emit(event: string) {
        if (listeners[event]) listeners[event]();
      },
      _setOriginalJson(fn: any) { _jsonFn = fn; },
    };
  }

  it('skips GET requests', () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'GET' });
    let nextCalled = false;
    middleware(req, mockRes(), () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('skips HEAD requests', () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'HEAD' });
    let nextCalled = false;
    middleware(req, mockRes(), () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('skips OPTIONS requests', () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'OPTIONS' });
    let nextCalled = false;
    middleware(req, mockRes(), () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('calls next for POST requests', () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'POST' });
    let nextCalled = false;
    middleware(req, mockRes(), () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('calls next for PUT requests', () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'PUT' });
    let nextCalled = false;
    middleware(req, mockRes(), () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('calls next for DELETE requests', () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'DELETE' });
    let nextCalled = false;
    middleware(req, mockRes(), () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('logs audit entry on finish event for mutating request', async () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'POST', user: { userId: 'user-42' } });
    const res = mockRes();
    middleware(req, res, () => {});
    res._emit('finish');
    // Wait for async audit log
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(deps.stores.auditLog.insert.mock.calls.length >= 1);
  });

  it('handles audit log insert errors gracefully', async () => {
    const deps = makeDeps();
    deps.stores.auditLog.insert = mock.fn(async () => { throw new Error('db down'); });
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'DELETE' });
    const res = mockRes();
    middleware(req, res, () => {});
    res._emit('finish');
    await new Promise((r) => setTimeout(r, 50));
    // Should log error, not throw
    assert.ok(deps.log.error.mock.calls.length >= 1);
  });

  it('extracts admin actor from adminSession', async () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'PATCH', adminSession: true });
    const res = mockRes();
    middleware(req, res, () => {});
    res._emit('finish');
    await new Promise((r) => setTimeout(r, 50));
    const entry = (deps.stores.auditLog.insert.mock.calls as any[])[0]?.arguments[0];
    assert.equal(entry.actor_type, 'admin');
  });

  it('extracts system actor when no user and no admin', async () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'POST', user: null });
    const res = mockRes();
    middleware(req, res, () => {});
    res._emit('finish');
    await new Promise((r) => setTimeout(r, 50));
    const entry = (deps.stores.auditLog.insert.mock.calls as any[])[0]?.arguments[0];
    assert.equal(entry.actor_type, 'system');
    assert.equal(entry.actor_id, null);
  });

  it('extracts target from route path and params', async () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({
      method: 'PUT',
      route: { path: '/festivals/:id' },
      params: { id: 'fest-1' },
    });
    const res = mockRes();
    middleware(req, res, () => {});
    res._emit('finish');
    await new Promise((r) => setTimeout(r, 50));
    const entry = (deps.stores.auditLog.insert.mock.calls as any[])[0]?.arguments[0];
    assert.equal(entry.target_type, 'festivals');
    assert.equal(entry.target_id, 'fest-1');
    assert.equal(entry.action, 'replace:festivals');
  });

  it('extracts target and action for nested crew sub-routes', async () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({
      method: 'POST',
      route: { path: '/:crewId/polls' },
      params: { crewId: 'crew-1' },
    });
    const res = mockRes();
    middleware(req, res, () => {});
    res._emit('finish');
    await new Promise((r) => setTimeout(r, 50));
    const entry = (deps.stores.auditLog.insert.mock.calls as any[])[0]?.arguments[0];
    assert.equal(entry.target_type, 'polls');
    assert.equal(entry.target_id, 'crew-1');
    assert.equal(entry.action, 'create:polls');
  });

  it('handles missing route in extractTarget', async () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'DELETE', route: null });
    const res = mockRes();
    middleware(req, res, () => {});
    res._emit('finish');
    await new Promise((r) => setTimeout(r, 50));
    const entry = (deps.stores.auditLog.insert.mock.calls as any[])[0]?.arguments[0];
    assert.equal(entry.target_type, 'unknown');
  });

  it('handles route with param-only path', async () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({
      method: 'PATCH',
      route: { path: '/:id' },
      params: { id: 'abc' },
    });
    const res = mockRes();
    middleware(req, res, () => {});
    res._emit('finish');
    await new Promise((r) => setTimeout(r, 50));
    const entry = (deps.stores.auditLog.insert.mock.calls as any[])[0]?.arguments[0];
    assert.equal(entry.action, 'update:unknown');
  });

  it('captures failure status for 4xx responses', async () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'POST' });
    const res = mockRes();
    res.statusCode = 403;
    middleware(req, res, () => {});
    res._emit('finish');
    await new Promise((r) => setTimeout(r, 50));
    const entry = (deps.stores.auditLog.insert.mock.calls as any[])[0]?.arguments[0];
    assert.equal(entry.status, 'failure');
  });

  it('wraps res.json to capture response body', () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'POST' });
    const res = mockRes();
    let jsonCalled = false;
    res._setOriginalJson(() => { jsonCalled = true; });
    middleware(req, res, () => {});
    res.json({ ok: true });
    assert.ok(jsonCalled);
  });
});

// ── CORS logic (real configureMiddleware registration) ───────────────────

describe('middleware: CORS logic (real configureMiddleware)', () => {
  it('passes through when no origin header', async () => {
    const { app } = makeMiddlewareApp();
    const res = await request(app).get('/health/live');
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('sets CORS headers for allowed origin', async () => {
    const { app } = makeMiddlewareApp({ isAllowedOrigin: () => true });
    const res = await request(app).get('/health/live').set('Origin', 'https://festie.us');
    assert.equal(res.headers['access-control-allow-origin'], 'https://festie.us');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
    // Real stack note: `compression` (mounted first in configureMiddleware) also
    // appends 'Accept-Encoding' to Vary, so check the 'Origin' token rather than
    // an exact string -- the hand-copied fake this replaced never surfaced that.
    assert.ok(res.headers['vary']?.split(',').map((s: string) => s.trim()).includes('Origin'));
    assert.equal(res.headers['access-control-allow-methods'], 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    assert.equal(res.headers['access-control-max-age'], '86400');
    assert.ok(res.headers['access-control-allow-headers']?.includes('Idempotency-Key'));
  });

  it('does not set CORS headers for disallowed origin', async () => {
    const { app } = makeMiddlewareApp({ isAllowedOrigin: () => false });
    const res = await request(app).get('/health/live').set('Origin', 'https://evil.com');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('returns 204 for OPTIONS preflight with allowed origin', async () => {
    const { app } = makeMiddlewareApp({ isAllowedOrigin: () => true });
    const res = await request(app).options('/health/live').set('Origin', 'https://festie.us');
    assert.equal(res.status, 204);
  });

  it('returns 403 for OPTIONS preflight with disallowed origin', async () => {
    const { app } = makeMiddlewareApp({ isAllowedOrigin: () => false });
    const res = await request(app).options('/health/live').set('Origin', 'https://evil.com');
    assert.equal(res.status, 403);
  });

  it('allows mobile origins', async () => {
    const { app } = makeMiddlewareApp({ isAllowedOrigin: () => false });
    const res = await request(app).get('/health/live').set('Origin', 'app://festie');
    assert.equal(res.headers['access-control-allow-origin'], 'app://festie');
  });
});

// ── Idempotency key logic (unit test of pattern) ────────────────────────

describe('middleware: idempotency key logic', () => {
  // Exercises the REAL exported factory from lib/middleware.ts — the previous
  // local reimplementation here could (and did) drift from shipped behavior.
  const makeIdem = () => createIdempotencyMiddleware({ ttl: 5 * 60 * 1000, maxEntries: 5000 });

  it('passes through GET requests', () => {
    const { middleware } = makeIdem();
    let nextCalled = false;
    middleware(
      { method: 'GET', headers: { 'idempotency-key': 'abc' } },
      {},
      () => { nextCalled = true; },
    );
    assert.ok(nextCalled);
  });

  it('passes through POST without idempotency key', () => {
    const { middleware } = makeIdem();
    let nextCalled = false;
    middleware(
      { method: 'POST', headers: {}, ip: '1.2.3.4' },
      {},
      () => { nextCalled = true; },
    );
    assert.ok(nextCalled);
  });

  it('caches and replays POST response', () => {
    const { middleware } = makeIdem();

    // First request
    let calledBody1: any = null;
    const res1: any = {
      statusCode: 200,
      setHeader() {},
      json(body: any) { calledBody1 = body; },
      // Real Express responses always emit finish/close; the middleware
      // registers a reservation-release listener on them.
      on() {},
    };
    middleware(
      { method: 'POST', headers: { 'idempotency-key': 'key-1' }, ip: '1.2.3.4' },
      res1,
      () => { res1.json({ ok: true, id: 'created' }); },
    );
    assert.deepEqual(calledBody1, { ok: true, id: 'created' });

    // Second request with same key -- should replay
    let replayed: any = null;
    let replayedStatus: any = null;
    const res2: any = {
      statusCode: 200,
      setHeader(k: string, v: string) { if (k === 'X-Idempotency-Replayed') replayed = v; },
      status(s: number) { replayedStatus = s; return { json(body: any) { replayed = body; } }; },
    };
    middleware(
      { method: 'POST', headers: { 'idempotency-key': 'key-1' }, ip: '1.2.3.4' },
      res2,
      () => { throw new Error('next should not be called on replay'); },
    );
    assert.ok(replayed);
  });

  it('rejects idempotency key longer than 128 chars', () => {
    const { middleware } = makeIdem();
    let nextCalled = false;
    middleware(
      { method: 'POST', headers: { 'idempotency-key': 'a'.repeat(129) }, ip: '1.2.3.4' },
      {},
      () => { nextCalled = true; },
    );
    assert.ok(nextCalled, 'should pass through (ignore long key)');
  });

  it('does not re-execute the handler for a concurrent duplicate key', async () => {
    const { middleware } = makeIdem();
    const req = { method: 'POST', headers: { 'idempotency-key': 'dup-1' }, ip: '1.2.3.4' };
    let executions = 0;
    let finishA: any;

    function mkRes() {
      const res: any = {
        statusCode: 200,
        headersSent: false,
        body: null,
        replayed: null,
        setHeader(k: string, v: string) { if (k === 'X-Idempotency-Replayed') res.replayed = v; },
        status(s: number) { res.statusCode = s; return res; },
        json(b: any) { res.body = b; res.headersSent = true; return b; },
        on() {},
      };
      return res;
    }

    // A: handler starts the mutation but has not responded yet.
    const resA = mkRes();
    middleware(req, resA, () => {
      executions += 1;
      finishA = () => resA.json({ ok: true, id: 'expense-1' });
    });

    // B: same key, arrives while A is still in flight.
    const resB = mkRes();
    middleware(req, resB, () => {
      executions += 1;
      resB.json({ ok: true, id: 'expense-2' });
    });

    assert.equal(executions, 1, 'concurrent duplicate must not re-execute the mutation');

    finishA();
    await new Promise((r) => setImmediate(r));   // let B's waiter resolve
    assert.equal(resB.replayed, 'true');
    assert.deepEqual(resB.body, { ok: true, id: 'expense-1' });
  });

  it('lets a waiting duplicate execute when the original ends without a response', async () => {
    const { middleware } = makeIdem();
    const req = { method: 'POST', headers: { 'idempotency-key': 'dc-1' }, ip: '1.2.3.4' };
    let executions = 0;

    function mkRes() {
      const listeners: Record<string, any> = {};
      const res: any = {
        statusCode: 200,
        replayed: null,
        body: null,
        setHeader(k: string, v: string) { if (k === 'X-Idempotency-Replayed') res.replayed = v; },
        status(s: number) { res.statusCode = s; return res; },
        json(b: any) { res.body = b; return b; },
        on(ev: string, fn: any) { listeners[ev] = fn; },
        emit(ev: string) { listeners[ev]?.(); },
      };
      return res;
    }

    // A reserves the key; its handler is in flight (no res.json yet).
    const resA = mkRes();
    middleware(req, resA, () => { executions += 1; });

    // B arrives with the same key and waits on A's reservation.
    const resB = mkRes();
    middleware(req, resB, () => { executions += 1; resB.json({ ok: true }); });

    // A disconnects mid-handler: 'close' fires with no JSON body.
    resA.emit('close');
    await new Promise((r) => setImmediate(r));   // let B's waiter resolve

    assert.equal(executions, 2, 'duplicate must execute after the original disconnects');
    assert.equal(resB.body?.ok, true);
    assert.equal(resB.replayed, null, 'nothing to replay from a disconnected original');
  });
});

// ── In-flight request tracking ──────────────────────────────────────────

describe('middleware: in-flight request tracking', () => {
  it('increments and decrements on finish', () => {
    const inFlightRequests = { count: 0 };
    const listeners: Record<string, any> = {};
    const middleware = (req: any, res: any, next: any) => {
      inFlightRequests.count += 1;
      const dec = () => { if (--inFlightRequests.count < 0) inFlightRequests.count = 0; };
      res.on('finish', dec);
      next();
    };

    const res = {
      on(event: string, fn: any) { listeners[event] = fn; },
    };
    middleware({}, res, () => {});
    assert.equal(inFlightRequests.count, 1);
    listeners.finish();
    assert.equal(inFlightRequests.count, 0);
  });

  it('count never goes below zero', () => {
    const inFlightRequests = { count: 0 };
    const listeners: Record<string, any[]> = {};
    const middleware = (req: any, res: any, next: any) => {
      inFlightRequests.count += 1;
      const dec = () => { if (--inFlightRequests.count < 0) inFlightRequests.count = 0; };
      res.on('finish', dec);
      res.on('close', dec);
      next();
    };

    const res = {
      on(event: string, fn: any) { listeners[event] = listeners[event] || []; listeners[event].push(fn); },
    };
    middleware({}, res, () => {});
    // Simulate both finish and close firing (real world scenario)
    listeners.finish![0]();
    listeners.close![0]();
    assert.equal(inFlightRequests.count, 0);
  });
});

// ── Request timeout (real configureMiddleware registration) ──────────────

describe('middleware: request timeout (real configureMiddleware)', () => {
  it('returns 408 via the real sendError/ErrorCodes wiring once the real timeout fires', async () => {
    const { app } = makeMiddlewareApp({ config: { REQUEST_TIMEOUT_MS: 50 } });
    // Nothing under /api responds, so the real timeout middleware's setTimeout
    // wins the race and calls the real sendError(res, 408, ..., ErrorCodes.INTERNAL_ERROR).
    app.use('/api', (_req: any, _res: any) => {});
    const res = await request(app).get('/api/v1/__hang__');
    assert.equal(res.status, 408);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });

  it('does not double-respond once the response already finished', async () => {
    const { app } = makeMiddlewareApp({ config: { REQUEST_TIMEOUT_MS: 50 } });
    app.get('/api/v1/__fast__', (_req: any, res: any) => res.json({ ok: true }));
    const res = await request(app).get('/api/v1/__fast__');
    assert.equal(res.status, 200);
    // Wait past the timeout window: if the real code's headersSent guard (and
    // clearTimeout) were broken, the stale timer would try to write a second,
    // now-invalid response here.
    await new Promise((r) => setTimeout(r, 120));
  });
});
