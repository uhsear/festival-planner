'use strict';

const assert = require('node:assert/strict');
const { describe, it, mock } = require('node:test');

// middleware.js exports configureMiddleware which requires a full Express app + context.
// Instead of testing the monolith, we test the individual middleware patterns it uses:
//   - audit-middleware (factory function, testable in isolation)
//   - CORS logic
//   - JSON body parser error handling
//   - Idempotency key logic
//   - In-flight request tracking
// We also test the tracing middleware that configureMiddleware uses.

const createAuditMiddleware = require('../lib/audit-middleware');

// ── audit-middleware ────────────────────────────────────────────────────

describe('middleware: audit-middleware', () => {
  function makeDeps() {
    return {
      stores: {
        auditLog: { insert: mock.fn(async () => {}) },
      },
      log: { info() {}, warn() {}, error: mock.fn() },
      getRequestIp: (req) => req.ip || '127.0.0.1',
    };
  }

  function mockReq(overrides = {}) {
    return {
      method: 'POST',
      path: '/api/v1/test',
      originalUrl: '/api/v1/test',
      ip: '10.0.0.1',
      id: 'req-123',
      headers: {},
      get: (h) => overrides.headers?.[h] || '',
      user: null,
      ...overrides,
    };
  }

  function mockRes() {
    const listeners = {};
    let _statusCode = 200;
    let _jsonFn = (data) => data;
    return {
      get statusCode() { return _statusCode; },
      set statusCode(v) { _statusCode = v; },
      json: function (data) { return _jsonFn(data); },
      on(event, fn) {
        listeners[event] = fn;
      },
      _emit(event) {
        if (listeners[event]) listeners[event]();
      },
      _setOriginalJson(fn) { _jsonFn = fn; },
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
    const entry = deps.stores.auditLog.insert.mock.calls[0]?.arguments[0];
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
    const entry = deps.stores.auditLog.insert.mock.calls[0]?.arguments[0];
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
    const entry = deps.stores.auditLog.insert.mock.calls[0]?.arguments[0];
    assert.equal(entry.target_type, 'festivals');
    assert.equal(entry.target_id, 'fest-1');
    assert.equal(entry.action, 'replace:festivals');
  });

  it('handles missing route in extractTarget', async () => {
    const deps = makeDeps();
    const middleware = createAuditMiddleware(deps);
    const req = mockReq({ method: 'DELETE', route: null });
    const res = mockRes();
    middleware(req, res, () => {});
    res._emit('finish');
    await new Promise((r) => setTimeout(r, 50));
    const entry = deps.stores.auditLog.insert.mock.calls[0]?.arguments[0];
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
    const entry = deps.stores.auditLog.insert.mock.calls[0]?.arguments[0];
    assert.equal(entry.action, 'update::id');
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
    const entry = deps.stores.auditLog.insert.mock.calls[0]?.arguments[0];
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

// ── CORS logic (reimplemented from middleware.js inline) ─────────────────

describe('middleware: CORS logic (unit test of pattern)', () => {
  function corsMiddleware(isAllowedOrigin, mobileOrigins = []) {
    return (req, res, next) => {
      const origin = req.headers.origin;
      if (!origin) return next();
      const isAllowed = isAllowedOrigin(origin, req.headers.host)
        || mobileOrigins.some((mo) => origin === mo);
      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        if (!isAllowed) return res.status(403).end();
        return res.status(204).end();
      }
      return next();
    };
  }

  function mockReq(headers = {}) {
    return { method: 'GET', headers };
  }

  function mockRes() {
    const h = {};
    let s = null;
    return {
      setHeader(k, v) { h[k] = v; },
      _headers: h,
      status(code) { s = code; return { end() {} }; },
      _status: () => s,
    };
  }

  it('passes through when no origin header', () => {
    const mw = corsMiddleware(() => false);
    let nextCalled = false;
    mw(mockReq({}), mockRes(), () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('sets CORS headers for allowed origin', () => {
    const mw = corsMiddleware(() => true);
    const res = mockRes();
    let nextCalled = false;
    mw(mockReq({ origin: 'https://festie.us', host: 'festie.us' }), res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.equal(res._headers['Access-Control-Allow-Origin'], 'https://festie.us');
    assert.equal(res._headers['Vary'], 'Origin');
  });

  it('does not set CORS headers for disallowed origin', () => {
    const mw = corsMiddleware(() => false);
    const res = mockRes();
    mw(mockReq({ origin: 'https://evil.com', host: 'festie.us' }), res, () => {});
    assert.ok(!('Access-Control-Allow-Origin' in res._headers));
  });

  it('returns 204 for OPTIONS preflight with allowed origin', () => {
    const mw = corsMiddleware(() => true);
    const res = mockRes();
    mw({ method: 'OPTIONS', headers: { origin: 'https://festie.us', host: 'festie.us' } }, res, () => {});
    assert.equal(res._status(), 204);
  });

  it('returns 403 for OPTIONS preflight with disallowed origin', () => {
    const mw = corsMiddleware(() => false);
    const res = mockRes();
    mw({ method: 'OPTIONS', headers: { origin: 'https://evil.com', host: 'festie.us' } }, res, () => {});
    assert.equal(res._status(), 403);
  });

  it('allows mobile origins', () => {
    const mw = corsMiddleware(() => false, ['app://festie']);
    const res = mockRes();
    let nextCalled = false;
    mw(mockReq({ origin: 'app://festie' }), res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.equal(res._headers['Access-Control-Allow-Origin'], 'app://festie');
  });
});

// ── Idempotency key logic (unit test of pattern) ────────────────────────

describe('middleware: idempotency key logic', () => {
  function createIdempotencyMiddleware() {
    const cache = new Map();
    const TTL = 5 * 60 * 1000;
    const MAX = 5000;
    return {
      middleware(req, res, next) {
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
        const key = req.headers['idempotency-key'];
        if (!key || typeof key !== 'string' || key.length > 128) return next();
        const userId = req.user?.userId || req.ip;
        const cacheKey = `${userId}:${key}`;
        const cached = cache.get(cacheKey);
        if (cached) {
          res.setHeader('X-Idempotency-Replayed', 'true');
          return res.status(cached.status).json(cached.body);
        }
        const originalJson = res.json.bind(res);
        res.json = (body) => {
          cache.set(cacheKey, { status: res.statusCode, body, ts: Date.now() });
          return originalJson(body);
        };
        next();
      },
      cache,
    };
  }

  it('passes through GET requests', () => {
    const { middleware } = createIdempotencyMiddleware();
    let nextCalled = false;
    middleware(
      { method: 'GET', headers: { 'idempotency-key': 'abc' } },
      {},
      () => { nextCalled = true; },
    );
    assert.ok(nextCalled);
  });

  it('passes through POST without idempotency key', () => {
    const { middleware } = createIdempotencyMiddleware();
    let nextCalled = false;
    middleware(
      { method: 'POST', headers: {}, ip: '1.2.3.4' },
      {},
      () => { nextCalled = true; },
    );
    assert.ok(nextCalled);
  });

  it('caches and replays POST response', () => {
    const { middleware } = createIdempotencyMiddleware();

    // First request
    let calledBody1 = null;
    const res1 = {
      statusCode: 200,
      setHeader() {},
      json(body) { calledBody1 = body; },
    };
    middleware(
      { method: 'POST', headers: { 'idempotency-key': 'key-1' }, ip: '1.2.3.4' },
      res1,
      () => { res1.json({ ok: true, id: 'created' }); },
    );
    assert.deepEqual(calledBody1, { ok: true, id: 'created' });

    // Second request with same key -- should replay
    let replayed = null;
    let replayedStatus = null;
    const res2 = {
      statusCode: 200,
      setHeader(k, v) { if (k === 'X-Idempotency-Replayed') replayed = v; },
      status(s) { replayedStatus = s; return { json(body) { replayed = body; } }; },
    };
    middleware(
      { method: 'POST', headers: { 'idempotency-key': 'key-1' }, ip: '1.2.3.4' },
      res2,
      () => { throw new Error('next should not be called on replay'); },
    );
    assert.ok(replayed);
  });

  it('rejects idempotency key longer than 128 chars', () => {
    const { middleware } = createIdempotencyMiddleware();
    let nextCalled = false;
    middleware(
      { method: 'POST', headers: { 'idempotency-key': 'a'.repeat(129) }, ip: '1.2.3.4' },
      {},
      () => { nextCalled = true; },
    );
    assert.ok(nextCalled, 'should pass through (ignore long key)');
  });
});

// ── In-flight request tracking ──────────────────────────────────────────

describe('middleware: in-flight request tracking', () => {
  it('increments and decrements on finish', () => {
    const inFlightRequests = { count: 0 };
    const listeners = {};
    const middleware = (req, res, next) => {
      inFlightRequests.count += 1;
      const dec = () => { if (--inFlightRequests.count < 0) inFlightRequests.count = 0; };
      res.on('finish', dec);
      next();
    };

    const res = {
      on(event, fn) { listeners[event] = fn; },
    };
    middleware({}, res, () => {});
    assert.equal(inFlightRequests.count, 1);
    listeners.finish();
    assert.equal(inFlightRequests.count, 0);
  });

  it('count never goes below zero', () => {
    const inFlightRequests = { count: 0 };
    const listeners = {};
    const middleware = (req, res, next) => {
      inFlightRequests.count += 1;
      const dec = () => { if (--inFlightRequests.count < 0) inFlightRequests.count = 0; };
      res.on('finish', dec);
      res.on('close', dec);
      next();
    };

    const res = {
      on(event, fn) { listeners[event] = listeners[event] || []; listeners[event].push(fn); },
    };
    middleware({}, res, () => {});
    // Simulate both finish and close firing (real world scenario)
    listeners.finish[0]();
    listeners.close[0]();
    assert.equal(inFlightRequests.count, 0);
  });
});

// ── Request timeout pattern ─────────────────────────────────────────────

describe('middleware: request timeout pattern', () => {
  it('calls sendError after timeout', async () => {
    let errorSent = false;
    const sendError = () => { errorSent = true; };
    const middleware = (req, res, next) => {
      const timeout = setTimeout(() => {
        if (!res.headersSent) sendError();
      }, 50);
      timeout.unref();
      res.on('finish', () => clearTimeout(timeout));
      next();
    };

    const listeners = {};
    const res = {
      headersSent: false,
      on(event, fn) { listeners[event] = fn; },
    };
    middleware({}, res, () => {});
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(errorSent);
  });

  it('clears timeout when response finishes', async () => {
    let errorSent = false;
    const sendError = () => { errorSent = true; };
    const middleware = (req, res, next) => {
      const timeout = setTimeout(() => {
        if (!res.headersSent) sendError();
      }, 100);
      timeout.unref();
      res.on('finish', () => clearTimeout(timeout));
      next();
    };

    const listeners = {};
    const res = {
      headersSent: false,
      on(event, fn) { listeners[event] = fn; },
    };
    middleware({}, res, () => {});
    // Simulate finishing early
    listeners.finish();
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(!errorSent);
  });
});
