'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const express = require('express');

const createHealthCoreRoutes = require('../routes/health-core');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides = {}) {
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  return {
    express,
    log,
    stores: overrides.stores || { pool: { query: async () => ({ rows: [{ '?column?': 1 }] }) } },
    pool: {},
    config: overrides.config || {
      REDIS_ENABLED: false,
      API_VERSION: '1',
      FIREBASE_CREDENTIALS_PATH: '',
      MAX_PICKS: 100,
      MAX_NOTES: 20,
      MAX_NOTE_LENGTH: 500,
      MAX_STATUS_TEXT: 100,
    },
    sendSuccess: (res, data) => res.json({ data, error: null }),
    sendError: (res, status, msg, code) => res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
    ErrorCodes: { MISSING_FIELD: 'MISSING_FIELD', INVALID_INPUT: 'INVALID_INPUT' },
    rateLimit: () => (req, res, next) => next(),
    redis: overrides.redis || null,
    ...overrides,
  };
}

/** Lightweight supertest replacement using express directly */
function testApp(deps) {
  const app = express();
  const result = createHealthCoreRoutes(deps);
  app.use('/', result.router);
  return { app, ...result };
}

async function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method: method.toUpperCase(),
        headers: body ? { 'Content-Type': 'application/json' } : {},
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body: data });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// ─── /health ─────────────────────────────────────────────────────────────────

describe('health-core: GET /health', () => {
  it('returns status ok with uptime', async () => {
    const deps = makeDeps();
    const { app } = testApp(deps);
    const res = await request(app, 'GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'ok');
    assert.equal(typeof res.body.data.uptime, 'number');
  });

  it('sets Cache-Control header', async () => {
    const deps = makeDeps();
    const { app } = testApp(deps);
    const res = await request(app, 'GET', '/health');
    assert.ok(res.headers['cache-control'].includes('max-age=5'));
  });
});

// ─── /ready ──────────────────────────────────────────────────────────────────

describe('health-core: GET /ready', () => {
  it('returns 503 when not ready', async () => {
    const deps = makeDeps();
    const { app } = testApp(deps);
    const res = await request(app, 'GET', '/ready');
    assert.equal(res.status, 503);
    assert.equal(res.body.data.status, 'not_ready');
  });

  it('returns 200 when ready', async () => {
    const deps = makeDeps();
    const { app, setReady } = testApp(deps);
    setReady(true);
    const res = await request(app, 'GET', '/ready');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'ready');
    assert.ok(res.body.data.checks);
  });

  it('reports redis as disabled when REDIS_ENABLED is false', async () => {
    const deps = makeDeps({ config: { ...makeDeps().config, REDIS_ENABLED: false } });
    const { app, setReady } = testApp(deps);
    setReady(true);
    const res = await request(app, 'GET', '/ready');
    assert.equal(res.body.data.checks.redis, 'disabled');
  });

  it('reports database degraded when stores.pool.query is missing', async () => {
    const deps = makeDeps({ stores: {} });
    const { app, setReady } = testApp(deps);
    setReady(true);
    const res = await request(app, 'GET', '/ready');
    assert.equal(res.body.data.checks.database, 'degraded');
  });
});

// ─── /info ───────────────────────────────────────────────────────────────────

describe('health-core: GET /info', () => {
  it('returns API version and features', async () => {
    const deps = makeDeps();
    const { app } = testApp(deps);
    const res = await request(app, 'GET', '/info');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.apiVersion, '1');
    assert.ok(res.body.data.features);
    assert.equal(res.body.data.features.export, true);
    assert.equal(res.body.data.features.avatars, true);
  });

  it('returns limits from config', async () => {
    const deps = makeDeps();
    const { app } = testApp(deps);
    const res = await request(app, 'GET', '/info');
    assert.equal(res.body.data.limits.maxPicks, 100);
    assert.equal(res.body.data.limits.maxNotes, 20);
  });

  it('returns mobile auth methods', async () => {
    const deps = makeDeps();
    const { app } = testApp(deps);
    const res = await request(app, 'GET', '/info');
    assert.ok(Array.isArray(res.body.data.mobile.authMethods));
    assert.ok(res.body.data.mobile.authMethods.includes('bearer'));
  });
});

// ─── POST /metrics/client ────────────────────────────────────────────────────

describe('health-core: POST /metrics/client', () => {
  it('accepts valid metrics', async () => {
    const deps = makeDeps();
    const { app } = testApp(deps);
    const res = await request(app, 'POST', '/metrics/client', { lcp: 1500, fid: 50 });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.received, true);
  });

  it('rejects missing lcp/fid', async () => {
    const deps = makeDeps();
    const { app } = testApp(deps);
    const res = await request(app, 'POST', '/metrics/client', { cls: 0.1 });
    assert.equal(res.status, 400);
  });

  it('increments client metrics counters', async () => {
    const deps = makeDeps();
    const { app, clientMetrics } = testApp(deps);
    const before = clientMetrics.samples;
    await request(app, 'POST', '/metrics/client', { lcp: 2000, fid: 80 });
    assert.equal(clientMetrics.samples, before + 1);
  });
});

// ─── setReady ────────────────────────────────────────────────────────────────

describe('health-core: setReady', () => {
  it('is a function returned by the factory', () => {
    const deps = makeDeps();
    const result = createHealthCoreRoutes(deps);
    assert.equal(typeof result.setReady, 'function');
  });

  it('clientMetrics and clientMetricsBuckets are exposed', () => {
    const deps = makeDeps();
    const result = createHealthCoreRoutes(deps);
    assert.ok(result.clientMetrics);
    assert.ok(result.clientMetricsBuckets);
    assert.equal(typeof result.clientMetrics.samples, 'number');
  });
});
