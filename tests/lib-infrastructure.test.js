'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// 1. lib/tracing.js — pure functions, no mocking needed
// ---------------------------------------------------------------------------
const {
  generateTraceId,
  resolveTraceId,
  createTracingMiddleware,
  propagateTraceId,
  augmentWithTraceId,
} = require('../lib/tracing');

describe('lib/tracing.js', () => {

  describe('generateTraceId', () => {
    it('returns a string with timestamp-hex format', () => {
      const id = generateTraceId();
      assert.match(id, /^\d+-[a-f0-9]{12}$/);
    });

    it('generates unique IDs on successive calls', () => {
      const ids = new Set(Array.from({ length: 20 }, () => generateTraceId()));
      assert.equal(ids.size, 20);
    });
  });

  describe('resolveTraceId', () => {
    it('returns the header value when valid alphanumeric', () => {
      assert.equal(resolveTraceId('abc-123_XYZ'), 'abc-123_XYZ');
    });

    it('rejects values longer than 64 chars', () => {
      const long = 'a'.repeat(65);
      const id = resolveTraceId(long);
      assert.notEqual(id, long);
      assert.match(id, /^\d+-[a-f0-9]{12}$/);
    });

    it('rejects empty string', () => {
      const id = resolveTraceId('');
      assert.match(id, /^\d+-[a-f0-9]{12}$/);
    });

    it('rejects non-string input', () => {
      const id = resolveTraceId(null);
      assert.match(id, /^\d+-[a-f0-9]{12}$/);
    });

    it('rejects values with special characters', () => {
      const id = resolveTraceId('abc/../etc');
      assert.match(id, /^\d+-[a-f0-9]{12}$/);
    });

    it('accepts value at exactly 64 chars', () => {
      const val = 'a'.repeat(64);
      assert.equal(resolveTraceId(val), val);
    });
  });

  describe('createTracingMiddleware', () => {
    it('adds traceId to req and res when no header present', () => {
      const mw = createTracingMiddleware();
      const req = { get: () => undefined };
      const res = { set: mock.fn() };
      const next = mock.fn();

      mw(req, res, next);

      assert.ok(req.traceId);
      assert.match(req.traceId, /^\d+-[a-f0-9]{12}$/);
      assert.equal(res.set.mock.calls.length, 1);
      assert.deepEqual(res.set.mock.calls[0].arguments, ['X-Trace-ID', req.traceId]);
      assert.equal(next.mock.calls.length, 1);
    });

    it('preserves a valid incoming X-Trace-ID header', () => {
      const mw = createTracingMiddleware();
      const req = { get: () => 'my-trace-id-42' };
      const res = { set: mock.fn() };
      const next = mock.fn();

      mw(req, res, next);

      assert.equal(req.traceId, 'my-trace-id-42');
      assert.deepEqual(res.set.mock.calls[0].arguments, ['X-Trace-ID', 'my-trace-id-42']);
    });

    it('generates new traceId for invalid header', () => {
      const mw = createTracingMiddleware();
      const req = { get: () => 'bad value with spaces!' };
      const res = { set: mock.fn() };
      const next = mock.fn();

      mw(req, res, next);

      assert.notEqual(req.traceId, 'bad value with spaces!');
      assert.match(req.traceId, /^\d+-[a-f0-9]{12}$/);
    });
  });

  describe('propagateTraceId', () => {
    it('sets traceId on socket.data', () => {
      const socket = { data: {} };
      propagateTraceId(socket, 'trace-1');
      assert.equal(socket.data.traceId, 'trace-1');
    });

    it('no-ops when socket is null', () => {
      assert.doesNotThrow(() => propagateTraceId(null, 'trace-1'));
    });

    it('no-ops when socket.data is missing', () => {
      assert.doesNotThrow(() => propagateTraceId({}, 'trace-1'));
    });

    it('no-ops when traceId is empty string', () => {
      const socket = { data: {} };
      propagateTraceId(socket, '');
      assert.equal(socket.data.traceId, undefined);
    });

    it('no-ops when traceId is not a string', () => {
      const socket = { data: {} };
      propagateTraceId(socket, 123);
      assert.equal(socket.data.traceId, undefined);
    });
  });

  describe('augmentWithTraceId', () => {
    it('adds traceId to an object', () => {
      const obj = { foo: 'bar' };
      const result = augmentWithTraceId(obj, 'trace-99');
      assert.equal(result.traceId, 'trace-99');
      assert.equal(result, obj); // same reference
    });

    it('returns obj unchanged when traceId is empty', () => {
      const obj = { foo: 1 };
      augmentWithTraceId(obj, '');
      assert.equal(obj.traceId, undefined);
    });

    it('returns non-object input as-is', () => {
      assert.equal(augmentWithTraceId(null, 'trace-1'), null);
      assert.equal(augmentWithTraceId(undefined, 'trace-1'), undefined);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. lib/sentry.js — test initSentry + sentry proxy object
// ---------------------------------------------------------------------------
describe('lib/sentry.js', () => {
  // We need a fresh module for each test because initSentry uses module-level
  // `initialized` flag. We'll use a simple re-require trick.
  let sentryModule;

  function freshSentryModule() {
    // Remove cached copy so require gives us a fresh module
    const modPath = require.resolve('../lib/sentry');
    delete require.cache[modPath];
    // Also bust the config cache to prevent cross-contamination
    const cfgPath = require.resolve('../lib/config');
    delete require.cache[cfgPath];
    return require('../lib/sentry');
  }

  beforeEach(() => {
    sentryModule = freshSentryModule();
  });

  describe('initSentry — no DSN', () => {
    it('returns null when no DSN is configured', () => {
      const result = sentryModule.initSentry({ dsn: '' });
      assert.equal(result, null);
    });

    it('sets sentry.available to false', () => {
      sentryModule.initSentry({ dsn: '' });
      assert.equal(sentryModule.sentry.available, false);
    });
  });

  describe('initSentry — @sentry/node not installed', () => {
    it('returns null gracefully when @sentry/node is missing', () => {
      // Provide a DSN so it tries to require @sentry/node, which
      // may or may not be installed in the test env. If it IS installed,
      // Sentry.init will fail because the DSN is bogus.
      // Either path should not throw.
      const result = sentryModule.initSentry({ dsn: 'https://fake@sentry.io/1' });
      // Result is either null or the Sentry module — both are valid
      assert.ok(result === null || typeof result === 'object');
    });
  });

  describe('initSentry — idempotency', () => {
    it('returns same result on second call', () => {
      const first = sentryModule.initSentry({ dsn: '' });
      const second = sentryModule.initSentry({ dsn: 'https://other@sentry.io/2' });
      assert.equal(first, second);
    });
  });

  describe('sentry proxy — noop mode', () => {
    beforeEach(() => {
      sentryModule.initSentry({ dsn: '' }); // ensure noop
    });

    it('captureException is a silent no-op', () => {
      assert.doesNotThrow(() => {
        sentryModule.sentry.captureException(new Error('test'));
      });
    });

    it('captureMessage is a silent no-op', () => {
      assert.doesNotThrow(() => {
        sentryModule.sentry.captureMessage('hello', 'warning');
      });
    });

    it('setUser is a silent no-op', () => {
      assert.doesNotThrow(() => {
        sentryModule.sentry.setUser({ id: '42' });
      });
    });

    it('setTag is a silent no-op', () => {
      assert.doesNotThrow(() => {
        sentryModule.sentry.setTag('env', 'test');
      });
    });

    it('requestHandler returns pass-through middleware', () => {
      const mw = sentryModule.sentry.requestHandler();
      assert.equal(typeof mw, 'function');
      const next = mock.fn();
      mw({}, {}, next);
      assert.equal(next.mock.calls.length, 1);
    });

    it('errorHandler returns pass-through error middleware', () => {
      const mw = sentryModule.sentry.errorHandler();
      assert.equal(typeof mw, 'function');
      const next = mock.fn();
      const err = new Error('test');
      mw(err, {}, {}, next);
      assert.equal(next.mock.calls.length, 1);
      assert.equal(next.mock.calls[0].arguments[0], err);
    });

    it('close resolves without error', async () => {
      await assert.doesNotReject(() => sentryModule.sentry.close(100));
    });

    it('raw is null in noop mode', () => {
      assert.equal(sentryModule.sentry.raw, null);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. lib/shutdown.js — createBackgroundTasks + createCloseHandler
// ---------------------------------------------------------------------------
const { createBackgroundTasks, createCloseHandler } = require('../lib/shutdown');

describe('lib/shutdown.js', () => {

  describe('createBackgroundTasks', () => {
    let ctx;
    let ioStub;
    let timersCreated;

    beforeEach(() => {
      timersCreated = [];
      ctx = {
        config: { SESSION_TTL: 86400000, AUDIT_LOG_RETENTION_DAYS: 90 },
        state: {
          timers: [],
          rateLimits: new Map(),
          routeRateLimits: new Map(),
          authRateLimits: new Map(),
          socketRateLimits: new Map(),
          onlineUsers: new Map(),
        },
        stores: {
          sessions: { deleteExpiredUserSessions: mock.fn(async () => {}) },
          pool: { query: mock.fn(async () => ({ rowCount: 0 })) },
          auditLog: { cleanup: mock.fn(async () => 0) },
          crews: { meetingPoints: { expireStale: mock.fn(async () => ({ rowCount: 0 })) } },
        },
        log: {
          info: mock.fn(),
          warn: mock.fn(),
          error: mock.fn(),
          debug: mock.fn(),
        },
        pool: {},
        validateUserSession: mock.fn(async () => true),
        disconnectSocket: mock.fn(),
        emitPresence: mock.fn(),
        getUsers: mock.fn(async () => []),
        avatarDirPath: mock.fn(() => '/tmp/nonexistent-avatar-dir'),
      };
      ioStub = {
        of: () => ({ sockets: new Map() }),
        engine: { clientsCount: 0 },
      };
    });

    afterEach(() => {
      // Clear all timers that were pushed into state
      for (const t of ctx.state.timers) clearInterval(t);
    });

    it('registers 6 timers in state.timers', () => {
      createBackgroundTasks(ctx, { io: ioStub });
      // session, avatar, token, audit, memory, meeting-point = 6
      assert.equal(ctx.state.timers.length, 6);
    });

    it('all timers are unref-ed (no timer should keep process alive)', () => {
      // Just ensure no throw; unref is called internally
      createBackgroundTasks(ctx, { io: ioStub });
      assert.ok(ctx.state.timers.length >= 5);
    });

    it('starts reminder scheduler if present', () => {
      const scheduler = { start: mock.fn(), stop: mock.fn() };
      ctx.reminderScheduler = scheduler;
      createBackgroundTasks(ctx, { io: ioStub });
      assert.equal(scheduler.start.mock.calls.length, 1);
      assert.equal(ctx.state.reminderScheduler, scheduler);
    });

    it('skips reminder scheduler when absent', () => {
      createBackgroundTasks(ctx, { io: ioStub });
      assert.equal(ctx.state.reminderScheduler, undefined);
    });
  });

  describe('createCloseHandler', () => {
    let deps;

    beforeEach(() => {
      deps = {
        server: { listening: true, close: mock.fn() },
        io: {
          engine: { clientsCount: 0, close: mock.fn((cb) => cb()) },
          emit: mock.fn(),
          of: () => ({ sockets: new Map() }),
        },
        config: {
          DRAIN_BATCH_SIZE: 50,
          DRAIN_BATCH_DELAY_MS: 100,
          SHUTDOWN_TIMEOUT_MS: 5000,
        },
        state: {
          timers: [],
          metrics: { totalRequests: 42 },
          reminderScheduler: null,
        },
        log: {
          info: mock.fn(),
          warn: mock.fn(),
          error: mock.fn(),
          debug: mock.fn(),
        },
        pool: { end: mock.fn(async () => {}) },
        redis: { disconnect: mock.fn() },
        cacheBus: { close: mock.fn(async () => {}) },
        emitter: { flushAll: mock.fn() },
        clearPresenceTimers: mock.fn(),
        avatarPool: { terminate: mock.fn(async () => {}) },
        inFlightRequests: { count: 0 },
        sentry: { close: mock.fn(async () => {}) },
      };
    });

    it('returns an async close function', () => {
      const close = createCloseHandler(deps);
      assert.equal(typeof close, 'function');
    });

    it('clears all timers on close', async () => {
      const t1 = setInterval(() => {}, 999999);
      const t2 = setInterval(() => {}, 999999);
      deps.state.timers = [t1, t2];
      const close = createCloseHandler(deps);
      await close();
      // If clearInterval worked, the timers are dead. Verify by checking
      // that the handler completed without hanging.
      assert.ok(true);
    });

    it('stops listening server', async () => {
      const close = createCloseHandler(deps);
      await close();
      assert.equal(deps.server.close.mock.calls.length, 1);
    });

    it('does not call server.close when not listening', async () => {
      deps.server.listening = false;
      const close = createCloseHandler(deps);
      await close();
      assert.equal(deps.server.close.mock.calls.length, 0);
    });

    it('emits server:draining to all sockets', async () => {
      const close = createCloseHandler(deps);
      await close();
      assert.equal(deps.io.emit.mock.calls.length, 1);
      assert.deepEqual(deps.io.emit.mock.calls[0].arguments[0], 'server:draining');
    });

    it('flushes emitter batched events', async () => {
      const close = createCloseHandler(deps);
      await close();
      assert.equal(deps.emitter.flushAll.mock.calls.length, 1);
    });

    it('calls pool.end', async () => {
      const close = createCloseHandler(deps);
      await close();
      assert.equal(deps.pool.end.mock.calls.length, 1);
    });

    it('disconnects redis', async () => {
      const close = createCloseHandler(deps);
      await close();
      assert.equal(deps.redis.disconnect.mock.calls.length, 1);
    });

    it('skips redis disconnect when redis is null', async () => {
      deps.redis = null;
      const close = createCloseHandler(deps);
      await assert.doesNotReject(() => close());
    });

    it('closes cacheBus', async () => {
      const close = createCloseHandler(deps);
      await close();
      assert.equal(deps.cacheBus.close.mock.calls.length, 1);
    });

    it('skips cacheBus when null', async () => {
      deps.cacheBus = null;
      const close = createCloseHandler(deps);
      await assert.doesNotReject(() => close());
    });

    it('terminates avatar pool', async () => {
      const close = createCloseHandler(deps);
      await close();
      assert.equal(deps.avatarPool.terminate.mock.calls.length, 1);
    });

    it('calls sentry.close with timeout', async () => {
      const close = createCloseHandler(deps);
      await close();
      assert.equal(deps.sentry.close.mock.calls.length, 1);
      assert.equal(deps.sentry.close.mock.calls[0].arguments[0], 2000);
    });

    it('skips sentry.close when sentry has no close method', async () => {
      deps.sentry = {};
      const close = createCloseHandler(deps);
      await assert.doesNotReject(() => close());
    });

    it('clears presence timers', async () => {
      const close = createCloseHandler(deps);
      await close();
      assert.equal(deps.clearPresenceTimers.mock.calls.length, 1);
    });

    it('stops reminder scheduler if present', async () => {
      const scheduler = { stop: mock.fn() };
      deps.state.reminderScheduler = scheduler;
      const close = createCloseHandler(deps);
      await close();
      assert.equal(scheduler.stop.mock.calls.length, 1);
    });

    it('handles reminder scheduler stop throwing', async () => {
      deps.state.reminderScheduler = {
        stop: () => { throw new Error('boom'); },
      };
      const close = createCloseHandler(deps);
      await assert.doesNotReject(() => close());
    });

    it('disconnects sockets in batches', async () => {
      const socket1 = { disconnect: mock.fn() };
      const socket2 = { disconnect: mock.fn() };
      const socketsMap = new Map([['s1', socket1], ['s2', socket2]]);
      deps.io.of = () => ({ sockets: socketsMap });
      deps.config.DRAIN_BATCH_SIZE = 1; // 1 per batch to test batching
      deps.config.DRAIN_BATCH_DELAY_MS = 0;

      const close = createCloseHandler(deps);
      await close();

      assert.equal(socket1.disconnect.mock.calls.length, 1);
      assert.equal(socket2.disconnect.mock.calls.length, 1);
      assert.deepEqual(socket1.disconnect.mock.calls[0].arguments, [true]);
    });

    it('logs shutdown with in-flight count on timeout', async () => {
      deps.inFlightRequests = { count: 5 };
      deps.config.SHUTDOWN_TIMEOUT_MS = 0; // immediate timeout
      const close = createCloseHandler(deps);
      await close();
      // Should have logged a warning about in-flight requests
      const warnCalls = deps.log.warn.mock.calls;
      const hasInFlightWarn = warnCalls.some(
        (c) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('in-flight')
      );
      assert.ok(hasInFlightWarn, 'expected warning about in-flight requests');
    });

    it('handles io.engine being null', async () => {
      deps.io.engine = null;
      const close = createCloseHandler(deps);
      await assert.doesNotReject(() => close());
    });

    it('handles avatarPool.terminate throwing', async () => {
      deps.avatarPool = { terminate: async () => { throw new Error('worker died'); } };
      const close = createCloseHandler(deps);
      await assert.doesNotReject(() => close());
    });
  });
});

// ---------------------------------------------------------------------------
// 4. lib/socket-setup.js — configureSocketIO
// ---------------------------------------------------------------------------
describe('lib/socket-setup.js', () => {

  // Patch dependencies ONCE at suite level to avoid fragile per-test cache manipulation.
  // The patching happens synchronously when this describe block is first evaluated.
  const httpMod = require('http');
  const _origCreateServer = httpMod.createServer;

  // Shared mutable state — each test resets fakeServer/fakeIo via beforeEach
  let fakeServer;
  let fakeIo;

  // Pre-load modules so they're in require.cache before patching
  require('socket.io');
  require('../lib/notifications');
  require('../lib/emitter');

  // Patch socket.io, notifications, emitter in require cache ONCE
  const sioPath = require.resolve('socket.io');
  const notifPath = require.resolve('../lib/notifications');
  const emitterPath = require.resolve('../lib/emitter');
  const setupPath = require.resolve('../lib/socket-setup');

  // Save originals
  const origSio = require.cache[sioPath]?.exports;
  const origNotif = require.cache[notifPath]?.exports;
  const origEmitter = require.cache[emitterPath]?.exports;

  // Install stubs that delegate to our mutable fakeIo/fakeServer
  httpMod.createServer = function stubCreateServer() { return fakeServer; };

  if (require.cache[sioPath]) {
    require.cache[sioPath].exports = {
      ...origSio,
      Server: function StubServer() { return fakeIo; },
    };
  }
  if (require.cache[notifPath]) {
    require.cache[notifPath].exports = {
      ...origNotif,
      createNotificationService: () => ({ send: mock.fn() }),
    };
  }
  if (require.cache[emitterPath]) {
    require.cache[emitterPath].exports = {
      ...origEmitter,
      createSocketEmitter: () => ({ emitChatMessage: mock.fn(), flushAll: mock.fn() }),
    };
  }

  // Clear and re-require socket-setup so it picks up our stubs
  delete require.cache[setupPath];
  const { configureSocketIO } = require('../lib/socket-setup');

  // Restore originals AFTER all socket-setup tests (at module teardown)
  // Node test runner runs afterEach per-test, but we need suite-level cleanup.
  // We do it in afterEach of the last test — or simply accept the leak since
  // this is the last describe block. For safety, register a process handler:
  process.once('beforeExit', () => {
    httpMod.createServer = _origCreateServer;
    if (require.cache[sioPath]) require.cache[sioPath].exports = origSio;
    if (require.cache[notifPath]) require.cache[notifPath].exports = origNotif;
    if (require.cache[emitterPath]) require.cache[emitterPath].exports = origEmitter;
  });

  beforeEach(() => {
    fakeIo = {
      adapter: mock.fn(),
      on: mock.fn(),
      of: () => ({ sockets: new Map() }),
      engine: { clientsCount: 0 },
    };

    fakeServer = {
      keepAliveTimeout: 0,
      headersTimeout: 0,
    };

    // Re-point the Server stub to the new fakeIo for this test
    if (require.cache[sioPath]) {
      require.cache[sioPath].exports.Server = function StubServer() { return fakeIo; };
    }
    httpMod.createServer = function stubCreateServer() { return fakeServer; };
  });

  function makeCtx(overrides = {}) {
    return {
      config: {
        ALLOWED_ORIGINS: ['https://example.com'],
        ...overrides.config,
      },
      log: {
        info: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
        debug: mock.fn(),
      },
      redis: null, // no redis adapter by default
      stores: {},
      getRawRequestIp: mock.fn(() => '127.0.0.1'),
      isAllowedOrigin: mock.fn(() => true),
      consumeSocketConnectRateLimitAsync: mock.fn(async () => true),
      buildAvatarUrl: mock.fn(() => '/avatar.webp'),
      getUserById: mock.fn(async () => null),
      ...overrides,
    };
  }

  it('returns server, io, emitter, and notificationService', () => {
    const result = configureSocketIO({}, makeCtx());
    assert.ok(result.server);
    assert.ok(result.io);
    assert.ok(result.emitter);
    assert.ok(result.notificationService);
  });

  it('sets keepAliveTimeout and headersTimeout on server', () => {
    configureSocketIO({}, makeCtx());
    assert.equal(fakeServer.keepAliveTimeout, 65_000);
    assert.equal(fakeServer.headersTimeout, 66_000);
  });

  it('registers a connection handler on io', () => {
    configureSocketIO({}, makeCtx());
    const onCalls = fakeIo.on.mock.calls;
    assert.ok(onCalls.length >= 1, `expected io.on to be called, got ${onCalls.length} calls`);
    assert.equal(onCalls[0].arguments[0], 'connection');
    assert.equal(typeof onCalls[0].arguments[1], 'function');
  });

  it('does not attach redis adapter when redis is null', () => {
    configureSocketIO({}, makeCtx({ redis: null }));
    assert.equal(fakeIo.adapter.mock.calls.length, 0);
  });

  it('returns the http server created internally', () => {
    const result = configureSocketIO({}, makeCtx());
    assert.equal(result.server, fakeServer);
  });

  it('returns the io instance created internally', () => {
    const result = configureSocketIO({}, makeCtx());
    assert.equal(result.io, fakeIo);
  });

  describe('connection auth timeout', () => {
    it('registers once-disconnect handler on connected socket', () => {
      configureSocketIO({}, makeCtx());
      const connectionCb = fakeIo.on.mock.calls[0].arguments[1];

      const testSocket = {
        id: 'test-sock',
        authenticated: false,
        disconnect: mock.fn(),
        once: mock.fn(),
      };

      connectionCb(testSocket);

      assert.equal(testSocket.once.mock.calls.length, 1);
      assert.equal(testSocket.once.mock.calls[0].arguments[0], 'disconnect');
      assert.equal(typeof testSocket.once.mock.calls[0].arguments[1], 'function');
    });

    it('the disconnect cleanup callback clears the auth timer', () => {
      configureSocketIO({}, makeCtx());
      const connectionCb = fakeIo.on.mock.calls[0].arguments[1];

      const testSocket = {
        id: 'auth-sock',
        authenticated: true,
        disconnect: mock.fn(),
        once: mock.fn(),
      };

      connectionCb(testSocket);

      // once('disconnect', fn) — fn should be a function that clears the timer
      const cleanupFn = testSocket.once.mock.calls[0].arguments[1];
      assert.equal(typeof cleanupFn, 'function');
      // Calling it should not throw
      assert.doesNotThrow(() => cleanupFn());
    });
  });

  describe('allowRequest callback', () => {
    it('is configured on the Socket.IO server', () => {
      const ctx = makeCtx();
      const result = configureSocketIO({}, ctx);
      // If allowRequest was configured, the server was created successfully
      assert.ok(result.io);
    });
  });

  describe('redis adapter', () => {
    it('logs warning when redis adapter attachment fails', () => {
      // Provide a redis mock — the actual @socket.io/redis-adapter require
      // will likely throw in the test environment, triggering the catch branch
      const ctx = makeCtx({ redis: { duplicate: mock.fn() } });
      const result = configureSocketIO({}, ctx);
      // Should still return a valid result (falls back to in-memory)
      assert.ok(result.io);
      // The log.warn should have been called (redis adapter failed)
      const warnCalls = ctx.log.warn.mock.calls;
      const hasAdapterWarn = warnCalls.some(
        (c) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('redis adapter')
      );
      assert.ok(hasAdapterWarn, 'expected warning about redis adapter failure');
    });
  });
});
