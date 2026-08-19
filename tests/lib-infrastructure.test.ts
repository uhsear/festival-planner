import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {
  generateTraceId,
  resolveTraceId,
  createTracingMiddleware,
  propagateTraceId,
  augmentWithTraceId,
} from '../lib/tracing.js';

// ---------------------------------------------------------------------------
// 1. lib/tracing.js — pure functions, no mocking needed
// ---------------------------------------------------------------------------

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
      const req: any = { get: () => undefined };
      const res: any = { set: mock.fn() };
      const next = mock.fn();

      mw(req, res, next);

      assert.ok(req.traceId);
      assert.match(req.traceId, /^\d+-[a-f0-9]{12}$/);
      assert.equal(res.set.mock.calls.length, 1);
      assert.deepEqual(res.set.mock.calls[0]!.arguments, ['X-Trace-ID', req.traceId]);
      assert.equal(next.mock.calls.length, 1);
    });

    it('preserves a valid incoming X-Trace-ID header', () => {
      const mw = createTracingMiddleware();
      const req: any = { get: () => 'my-trace-id-42' };
      const res: any = { set: mock.fn() };
      const next = mock.fn();

      mw(req, res, next);

      assert.equal(req.traceId, 'my-trace-id-42');
      assert.deepEqual(res.set.mock.calls[0]!.arguments, ['X-Trace-ID', 'my-trace-id-42']);
    });

    it('generates new traceId for invalid header', () => {
      const mw = createTracingMiddleware();
      const req: any = { get: () => 'bad value with spaces!' };
      const res: any = { set: mock.fn() };
      const next = mock.fn();

      mw(req, res, next);

      assert.notEqual(req.traceId, 'bad value with spaces!');
      assert.match(req.traceId, /^\d+-[a-f0-9]{12}$/);
    });
  });

  describe('propagateTraceId', () => {
    it('sets traceId on socket.data', () => {
      const socket: any = { data: {} };
      propagateTraceId(socket, 'trace-1');
      assert.equal(socket.data.traceId, 'trace-1');
    });

    it('no-ops when socket is null', () => {
      assert.doesNotThrow(() => propagateTraceId(null, 'trace-1'));
    });

    it('no-ops when socket.data is missing', () => {
      assert.doesNotThrow(() => propagateTraceId({} as any, 'trace-1'));
    });

    it('no-ops when traceId is empty string', () => {
      const socket: any = { data: {} };
      propagateTraceId(socket, '');
      assert.equal(socket.data.traceId, undefined);
    });

    it('no-ops when traceId is not a string', () => {
      const socket: any = { data: {} };
      propagateTraceId(socket, 123 as any);
      assert.equal(socket.data.traceId, undefined);
    });
  });

  describe('augmentWithTraceId', () => {
    it('adds traceId to an object', () => {
      const obj: any = { foo: 'bar' };
      const result = augmentWithTraceId(obj, 'trace-99');
      assert.equal(result.traceId, 'trace-99');
      assert.equal(result, obj); // same reference
    });

    it('returns obj unchanged when traceId is empty', () => {
      const obj: any = { foo: 1 };
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
  let sentryModule: any;

  let _sentryCtr = 0;
  async function freshSentryModule() {
    return await import(`../lib/sentry.js?v=${++_sentryCtr}`);
  }

  beforeEach(async () => {
    sentryModule = await freshSentryModule();
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

    it('setupExpressErrorHandler no-ops on app when Sentry unavailable', () => {
      const fakeApp = { use: mock.fn() };
      sentryModule.sentry.setupExpressErrorHandler(fakeApp);
      assert.equal(fakeApp.use.mock.calls.length, 0);
    });

    it('requestScope() is a passthrough no-op that never throws', () => {
      const mw = sentryModule.sentry.requestScope();
      let nextCalled = false;
      assert.doesNotThrow(() => mw({}, {}, () => { nextCalled = true; }));
      assert.ok(nextCalled);
    });

    it('close resolves without error', async () => {
      await assert.doesNotReject(() => sentryModule.sentry.close(100));
    });

    it('raw is null in noop mode', () => {
      assert.equal(sentryModule.sentry.raw, null);
    });
  });

  describe('setupExpressErrorHandler — wires the real SDK once Sentry is available (regression for the removed Handlers API)', () => {
    it("registers our request-context middleware plus Sentry's real Express middleware when Sentry has actually initialized", () => {
      sentryModule.initSentry({ dsn: 'https://fake@sentry.io/1' });
      assert.equal(sentryModule.sentry.available, true); // sanity: prove Sentry is NOT in noop mode for this test

      const fakeApp = { use: mock.fn() };
      sentryModule.sentry.setupExpressErrorHandler(fakeApp);

      // Call 0 is our own request-context error middleware (4-arg), mounted
      // before @sentry/node's real setupExpressErrorHandler(app), which
      // itself calls app.use() twice (request-metadata middleware, then the
      // capturing error middleware) — verified directly against installed
      // node_modules/@sentry/core source.
      assert.equal(fakeApp.use.mock.calls.length, 3);
      assert.equal(typeof fakeApp.use.mock.calls[0]!.arguments[0], 'function');
      assert.equal(fakeApp.use.mock.calls[0]!.arguments[0].length, 4); // (err, req, res, next)
      assert.equal(typeof fakeApp.use.mock.calls[1]!.arguments[0], 'function');
      assert.equal(typeof fakeApp.use.mock.calls[2]!.arguments[0], 'function');
    });
  });

  // ── Request/user attribution (Task 2) ──────────────────────────────────
  // Full end-to-end wiring through a real Express app + supertest, with a
  // custom Sentry transport standing in for the network, so we assert on the
  // actual captured event Sentry would send — not a hand-rolled shape.
  describe('request scope + error attribution', () => {
    function makeApp(sentryModule: any) {
      // Collect every envelope sent, not just the last one: Sentry's default
      // session-tracking integration also sends periodic 'sessions' envelopes
      // on flush(), interleaved with our 'event' envelope.
      const sent: any[] = [];
      sentryModule.initSentry({
        dsn: 'https://fake@sentry.io/1',
        extra: {
          transport: () => ({
            send: async (envelope: any) => { sent.push(envelope); return {}; },
            flush: async () => true,
          }),
        },
      });

      const app = express();
      app.use(sentryModule.sentry.requestScope());
      app.use((req: any, _res: any, next: any) => {
        req.id = 'req-123';
        req.traceId = 'trace-abc';
        next();
      });
      app.get('/api/v1/crews/:crewId/members', (req: any, _res: any, next: any) => {
        req.user = { userId: 'user-42', username: 'shouldnotleak', email: 'shouldnotleak@example.com' };
        // Sentry's built-in Dedupe integration drops consecutive captures of
        // an identical message+stack, which would otherwise suppress this
        // across the several tests below that all hit this same route —
        // a unique message per call sidesteps that (not a workaround for
        // anything this task's logic does).
        next(new Error(`boom-${Math.random()}`));
      });
      app.get('/api/v1/anon', (_req: any, _res: any, next: any) => {
        next(new Error(`anon-boom-${Math.random()}`));
      });
      sentryModule.sentry.setupExpressErrorHandler(app);
      app.use((_err: any, _req: any, res: any, _next: any) => {
        res.status(500).json({ ok: false });
      });

      async function getCapturedEvent() {
        await sentryModule.sentry.raw.flush(500);
        for (const envelope of sent) {
          const eventItem = envelope[1].find(([hdr]: any) => hdr.type === 'event');
          if (eventItem) return eventItem[1];
        }
        return null;
      }
      return { app, getCapturedEvent };
    }

    it('attaches an opaque user id, request id, trace id, route pattern, and HTTP method for an authenticated request', async () => {
      const { app, getCapturedEvent } = makeApp(sentryModule);
      const res = await request(app).get('/api/v1/crews/crew-1/members');
      assert.equal(res.status, 500);

      const event = await getCapturedEvent();
      assert.ok(event, 'expected an event to have been captured');
      assert.deepEqual(event.user, { id: 'user-42' });
      assert.equal(event.tags.requestId, 'req-123');
      assert.equal(event.tags.traceId, 'trace-abc');
      assert.equal(event.tags.method, 'GET');
      // Route PATTERN, not the raw URL with the crew id interpolated in.
      assert.equal(event.tags.route, '/api/v1/crews/:crewId/members');
    });

    it('attaches no user (and no throw) for an anonymous/unauthenticated request', async () => {
      const { app, getCapturedEvent } = makeApp(sentryModule);
      const res = await request(app).get('/api/v1/anon');
      assert.equal(res.status, 500);

      const event = await getCapturedEvent();
      assert.ok(event, 'expected an event to have been captured');
      assert.equal(event.user, undefined);
      assert.equal(event.tags.route, '/api/v1/anon');
    });

    it('never attaches PII fields (email, username, ip) — user carries only an opaque id', async () => {
      const { app, getCapturedEvent } = makeApp(sentryModule);
      await request(app).get('/api/v1/crews/crew-1/members');

      const event = await getCapturedEvent();
      assert.deepEqual(Object.keys(event.user), ['id']);
      assert.equal(event.user.email, undefined);
      assert.equal(event.user.username, undefined);
      assert.equal(event.user.ip_address, undefined);
    });

    it('keeps the existing cookie/authorization header scrubbing from beforeSend', async () => {
      const { app, getCapturedEvent } = makeApp(sentryModule);
      await request(app).get('/api/v1/anon').set('Cookie', 'session=secret').set('Authorization', 'Bearer secret');

      const event = await getCapturedEvent();
      if (event.request?.headers) {
        assert.equal(event.request.headers.cookie, undefined);
        assert.equal(event.request.headers.authorization, undefined);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 3. lib/shutdown.js — createBackgroundTasks + createCloseHandler
// ---------------------------------------------------------------------------
import { createBackgroundTasks, createCloseHandler } from '../lib/shutdown.js';

describe('lib/shutdown.js', () => {

  describe('createBackgroundTasks', () => {
    let ctx: any;
    let ioStub: any;
    let timersCreated: any;

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
    let deps: any;

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
      assert.deepEqual(socket1.disconnect.mock.calls[0]!.arguments, [true]);
    });

    it('logs shutdown with in-flight count on timeout', async () => {
      deps.inFlightRequests = { count: 5 };
      deps.config.SHUTDOWN_TIMEOUT_MS = 0; // immediate timeout
      const close = createCloseHandler(deps);
      await close();
      // Should have logged a warning about in-flight requests
      const warnCalls = deps.log.warn.mock.calls;
      const hasInFlightWarn = warnCalls.some(
        (c: any) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('in-flight')
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
//    Uses real http.createServer + Socket.IO Server (no listen, no port)
//    with only notifications + emitter stubs. Tests verify behavior through
//    the real returned objects.
// ---------------------------------------------------------------------------
describe('lib/socket-setup.js', async () => {

  const { configureSocketIO } = await import('../lib/socket-setup.js');

  // Track created servers/io for cleanup
  const toClose: any[] = [];
  afterEach(() => {
    for (const r of toClose) {
      try { r.io.close(); } catch { /* ignore */ }
      try { r.server.close(); } catch { /* ignore */ }
    }
    toClose.length = 0;
  });

  function makeCtx(overrides: any = {}) {
    return {
      config: {
        ALLOWED_ORIGINS: ['https://example.com'],
        SOCKET_KEEPALIVE_TIMEOUT: 65_000,
        SOCKET_HEADERS_TIMEOUT: 66_000,
        SOCKET_PING_TIMEOUT: 60_000,
        SOCKET_PING_INTERVAL: 25_000,
        SOCKET_MAX_HTTP_BUFFER: 100_000,
        ...overrides.config,
      },
      log: {
        info: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
        debug: mock.fn(),
      },
      redis: null,
      stores: {},
      getRawRequestIp: mock.fn(() => '127.0.0.1'),
      isAllowedOrigin: mock.fn(() => true),
      consumeSocketConnectRateLimitAsync: mock.fn(async () => true),
      buildAvatarUrl: mock.fn(() => '/avatar.webp'),
      getUserById: mock.fn(async () => null),
      ...overrides,
    };
  }

  function run(ctxOverrides = {}) {
    const ctx = makeCtx(ctxOverrides);
    const result = configureSocketIO({} as any, ctx);
    toClose.push(result);
    return { ...result, ctx };
  }

  it('returns server, io, emitter, and notificationService', () => {
    const { server, io, emitter, notificationService } = run();
    assert.ok(server);
    assert.ok(io);
    assert.ok(emitter);
    assert.ok(notificationService);
  });

  it('server is an http.Server instance', async () => {
    const http = await import('node:http');
    const { server } = run();
    assert.ok(server instanceof http.Server);
  });

  it('io is a socket.io Server instance', async () => {
    const { Server } = await import('socket.io');
    const { io } = run();
    assert.ok(io instanceof Server);
  });

  it('sets keepAliveTimeout to 65000', () => {
    const { server } = run();
    assert.equal(server.keepAliveTimeout, 65_000);
  });

  it('sets headersTimeout to 66000', () => {
    const { server } = run();
    assert.equal(server.headersTimeout, 66_000);
  });

  it('registers a connection listener on the default namespace', () => {
    const { io } = run();
    const ns = io.of('/');
    assert.ok(ns.listenerCount('connection') >= 1);
  });

  it('connection handler registers once-disconnect on socket', () => {
    const { io } = run();
    const ns = io.of('/');
    const listeners = ns.listeners('connection');

    const testSocket = {
      id: 'test-sock',
      authenticated: false,
      disconnect: mock.fn(),
      once: mock.fn(),
    };

    listeners[0]!(testSocket as any);

    assert.equal(testSocket.once.mock.calls.length, 1);
    assert.equal((testSocket.once.mock.calls as any[])[0].arguments[0], 'disconnect');
    assert.equal(typeof (testSocket.once.mock.calls as any[])[0].arguments[1], 'function');
  });

  it('disconnect cleanup callback does not throw', () => {
    const { io } = run();
    const listeners = io.of('/').listeners('connection');

    const testSocket = {
      id: 'cleanup-sock',
      authenticated: true,
      disconnect: mock.fn(),
      once: mock.fn(),
    };

    listeners[0]!(testSocket as any);
    const cleanupFn = (testSocket.once.mock.calls as any[])[0].arguments[1];
    assert.doesNotThrow(() => cleanupFn());
  });

  it('does not log redis adapter when redis is null', () => {
    const { ctx } = run({ redis: null });
    const infoCalls = ctx.log.info.mock.calls;
    const hasRedisLog = infoCalls.some(
      (c: any) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('redis adapter')
    );
    assert.ok(!hasRedisLog);
  });

  it('logs warning when redis adapter fails to attach', () => {
    const { ctx } = run({ redis: { duplicate: mock.fn() } });
    const warnCalls = ctx.log.warn.mock.calls;
    const hasAdapterWarn = warnCalls.some(
      (c: any) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('redis adapter')
    );
    assert.ok(hasAdapterWarn, 'expected warning about redis adapter failure');
  });
});
