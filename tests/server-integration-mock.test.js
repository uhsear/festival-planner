'use strict';

process.env.REDIS_ENABLED = 'false';

const assert = require('node:assert/strict');
const { describe, it, after } = require('node:test');

const { createFestivalPlanner, createFestieApp } = require('../server');

describe('createFestieApp with mock DATABASE_URL', () => {
  let result;

  it('returns expected shape when called with valid config', () => {
    assert.equal(typeof createFestieApp, 'function');
    assert.equal(typeof createFestivalPlanner, 'function');
    assert.equal(createFestieApp, createFestivalPlanner);
  });

  it('constructs app, server, io, config, state, close, setHealthReady', () => {
    result = createFestieApp({
      DATABASE_URL: 'postgresql://localhost:5432/festie_test_dummy',
      REDIS_ENABLED: false,
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: 'http://localhost:3000',
      SESSION_SECRET: 'test-secret-12345',
      FIREBASE_CREDENTIALS_PATH: '',
    });

    assert.ok(result.app, 'app should exist');
    assert.ok(result.server, 'server should exist');
    assert.ok(result.io, 'io should exist');
    assert.ok(result.config, 'config should exist');
    assert.ok(result.state, 'state should exist');
    assert.equal(typeof result.close, 'function');
    assert.equal(typeof result.setHealthReady, 'function');
  });

  it('config reflects test overrides', () => {
    assert.equal(result.config.NODE_ENV, 'test');
    assert.equal(result.config.REDIS_ENABLED, false);
  });

  it('state has expected structure', () => {
    assert.ok(result.state.rateLimits instanceof Map);
    assert.ok(result.state.onlineUsers instanceof Map);
    assert.ok(result.state.timers instanceof Array);
    assert.ok(result.state.stores);
    assert.ok(result.state.metrics);
  });

  it('io has default namespace', () => {
    assert.ok(result.io.of('/'));
  });

  it('server is an http.Server', () => {
    const http = require('http');
    assert.ok(result.server instanceof http.Server);
  });

  after(async () => {
    if (result?.close) {
      await result.close().catch(() => {});
    }
  });
});
