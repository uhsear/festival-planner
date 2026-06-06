/**
 * Mock-based route tests for routes/crew-sos.ts (safety-critical path).
 *
 * Covers POST /:crewId/sos and POST /:crewId/sos/clear:
 *   - success (200 { ok, activityId, raisedAt }), crew_activity row written,
 *     sos:raised / sos:cleared broadcast, push fan-out triggered
 *   - auth required (userAuth rejects), non-member forbidden (403)
 *   - Zod validation: message too long, bad coords (out-of-range lat/lng,
 *     missing capturedAt) → 400 VALIDATION_ERROR
 *   - per-user SOS_RAISE_LIMIT throttle → 429 with Retry-After
 *   - feature flag off → 503; activity-log failure is non-fatal (still broadcasts)
 *
 * Mounts the route factory on a minimal Express app. Stores / io /
 * notificationService are mock.fn() stubs, but the SAFETY-CRITICAL plumbing is
 * the REAL code: real Zod schemas (lib/schemas), real validate/validateParams,
 * real SOS_RAISE_LIMIT throttle (lib/rate-limiting), real sendSuccess/sendError
 * + ErrorCodes (lib/response), real sanitizeIdentifier. No database required.
 *
 * Runs locally AND in CI (no Postgres needed).
 */

import assert from 'node:assert/strict';
import { describe, test, beforeEach, mock } from 'node:test';
import express from 'express';
import request from 'supertest';

import { validate, validateParams, schemas } from '../lib/schemas.js';
import { sendSuccess, sendError, ErrorCodes } from '../lib/response.js';
import { SOS_RAISE_LIMIT } from '../lib/rate-limiting.js';
import { sanitizeIdentifier } from '../lib/helpers/sanitize.js';

// ── Shared helpers ────────────────────────────────────────────────────

function noop() {}
const noopLog = { info: noop, warn: noop, error: noop, debug: noop };

function makeIo() {
  const emitFn = mock.fn(() => {});
  return {
    to: mock.fn(() => ({ emit: emitFn })),
    _emit: emitFn,
  };
}

const VALID_POSITION = {
  lat: 41.88425,
  lng: -87.63245,
  accuracy: 12,
  capturedAt: '2026-06-06T18:00:00.000Z',
};

/**
 * Build a deps object tailored for crew-sos.ts. Only stores / io /
 * notificationService are mocks; validation + rate-limit + response shaping use
 * the real production modules so the safety path is genuinely exercised.
 */
function makeDeps(overrides: any = {}) {
  const ioObj = overrides.io !== undefined ? overrides.io : makeIo();

  const storesBase = {
    crews: {
      getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
      getMembers: mock.fn(async () => [{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-3' }]),
    },
    activity: {
      log: mock.fn(async () => 'activity-1'),
    },
  };

  const stores: any = { ...storesBase };
  if (overrides.stores) {
    stores.crews = { ...storesBase.crews, ...(overrides.stores.crews || {}) };
    stores.activity = { ...storesBase.activity, ...(overrides.stores.activity || {}) };
  }

  const notificationService =
    overrides.notificationService !== undefined
      ? overrides.notificationService
      : { send: mock.fn(async () => ({ ok: true })) };

  return {
    express,
    log: noopLog,
    config: overrides.config || {},
    userAuth:
      overrides.userAuth ||
      ((req: any, _res: any, next: any) => {
        req.user = { userId: 'user-1', username: 'testuser' };
        next();
      }),
    sanitizeIdentifier,
    sendSuccess,
    sendError,
    ErrorCodes,
    // Real rate-limit middleware is a coarse no-op here; the precise per-user
    // throttle is SOS_RAISE_LIMIT, exercised for real below.
    rateLimit: overrides.rateLimit || (() => (_req: any, _res: any, next: any) => next()),
    validate,
    validateParams,
    schemas,
    io: ioObj,
    stores,
    notificationService,
    _io: ioObj,
    _notificationService: notificationService,
  };
}

async function buildApp(overrides: any = {}) {
  const deps = makeDeps(overrides);
  const { default: createRoutes } = await import('../routes/crew-sos.js');
  const router = createRoutes(deps as any);
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return { app, deps };
}

// SOS_RAISE_LIMIT is a per-process in-memory limiter shared across tests.
// Reset it before each test so the per-user throttle starts fresh.
beforeEach(() => {
  (SOS_RAISE_LIMIT as any)._reset();
});

// =====================================================================
//  POST /:crewId/sos — raise an SOS
// =====================================================================
describe('routes/crew-sos.ts — POST /:crewId/sos', () => {
  test('factory returns an Express router', async () => {
    const { app } = await buildApp();
    assert.ok(app);
  });

  // ── Happy path ──────────────────────────────────────────────────────
  test('member can raise an SOS → 200 with activityId + raisedAt', async () => {
    const { app, deps } = await buildApp();

    const res = await request(app)
      .post('/crew-1/sos')
      .send({ message: 'Lost near main stage', position: VALID_POSITION });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.code, 'OK');
    assert.equal(res.body.data.activityId, 'activity-1');
    assert.ok(res.body.data.raisedAt, 'response includes raisedAt timestamp');
    // membership re-verified
    assert.equal((deps.stores.crews.getMember as any).mock.calls.length, 1);
  });

  test('raise without message or position still succeeds', async () => {
    const { app } = await buildApp();
    const res = await request(app).post('/crew-1/sos').send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.data.code, 'OK');
  });

  // ── Durable side-effect #1: crew_activity row ───────────────────────
  test('writes a crew_activity row (type sos_raised) with capped message + coarse coords', async () => {
    const logFn = mock.fn(async () => 'activity-99');
    const { app } = await buildApp({ stores: { activity: { log: logFn } } });

    await request(app).post('/crew-1/sos').send({ message: 'help', position: VALID_POSITION });

    assert.equal(logFn.mock.calls.length, 1);
    const arg = (logFn.mock.calls as any[])[0].arguments[0];
    assert.equal(arg.crewId, 'crew-1');
    assert.equal(arg.userId, 'user-1');
    assert.equal(arg.type, 'sos_raised');
    // detail = message + coarse @lat,lng (coords rounded to ~4 decimals)
    assert.match(arg.detail, /^help @41\.8843,-87\.6324$/);
  });

  test('activity-log failure is non-fatal — still 200 and still broadcasts', async () => {
    const ioObj = makeIo();
    const { app } = await buildApp({
      io: ioObj,
      stores: {
        activity: {
          log: mock.fn(async () => {
            throw new Error('db down');
          }),
        },
      },
    });

    const res = await request(app).post('/crew-1/sos').send({ message: 'help' });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.activityId, null);
    // primary delivery (broadcast) still fires even when the durable row fails
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'sos:raised');
  });

  // ── Durable side-effect #2: socket broadcast ────────────────────────
  test('broadcasts sos:raised to the crew room with the payload', async () => {
    const ioObj = makeIo();
    const { app } = await buildApp({ io: ioObj });

    await request(app).post('/crew-1/sos').send({ message: 'over here', position: VALID_POSITION });

    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'sos:raised');
    const payload = (ioObj._emit.mock.calls as any[])[0].arguments[1];
    assert.equal(payload.crewId, 'crew-1');
    assert.equal(payload.userId, 'user-1');
    assert.equal(payload.username, 'testuser');
    assert.equal(payload.message, 'over here');
    // coords are coarsened in the broadcast too (~4 decimals, ~11m)
    assert.equal(payload.position.lat, 41.8843);
    assert.equal(payload.position.lng, -87.6324);
    assert.equal(payload.activityId, 'activity-1');
  });

  // ── Best-effort side-effect #3: push fan-out ────────────────────────
  test('triggers push fan-out to other crew members (excluding raiser)', async () => {
    const sendFn = mock.fn(async () => ({ ok: true }));
    const { app } = await buildApp({
      notificationService: { send: sendFn },
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          getMembers: mock.fn(async () => [{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-3' }]),
        },
      },
    });

    await request(app).post('/crew-1/sos').send({ message: 'help' });

    // push fan-out is fire-and-forget — give the microtask queue a tick
    await new Promise((r) => setTimeout(r, 20));

    // user-2 and user-3 get a push; the raiser (user-1) does not
    assert.equal(sendFn.mock.calls.length, 2);
    const recipients = (sendFn.mock.calls as any[]).map((c) => c.arguments[0].userId).sort();
    assert.deepEqual(recipients, ['user-2', 'user-3']);
    const firstPush = (sendFn.mock.calls as any[])[0].arguments[0];
    assert.equal(firstPush.type, 'crew_sos');
    assert.equal(firstPush.threadId, 'sos-crew-1');
  });

  test('push fan-out rejection does not fail the HTTP response', async () => {
    const { app } = await buildApp({
      notificationService: {
        send: mock.fn(async () => {
          throw new Error('push provider down');
        }),
      },
    });

    const res = await request(app).post('/crew-1/sos').send({ message: 'help' });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 20));
  });

  // ── Auth + permission ───────────────────────────────────────────────
  test('returns 403 when the user is not a crew member', async () => {
    const { app } = await buildApp({
      stores: { crews: { getMember: mock.fn(async () => null) } },
    });

    const res = await request(app).post('/crew-1/sos').send({ message: 'help' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Not a crew member/);
  });

  test('rejects when userAuth blocks the request (auth required)', async () => {
    const { app } = await buildApp({
      userAuth: (_req: any, res: any) =>
        res.status(401).json({ data: null, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' } }),
    });

    const res = await request(app).post('/crew-1/sos').send({ message: 'help' });

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTH_REQUIRED');
  });

  // ── Zod validation (real schemas) ───────────────────────────────────
  test('400 when message exceeds 280 chars', async () => {
    const { app } = await buildApp();
    const res = await request(app)
      .post('/crew-1/sos')
      .send({ message: 'x'.repeat(281) });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  test('400 when latitude is out of range', async () => {
    const { app } = await buildApp();
    const res = await request(app)
      .post('/crew-1/sos')
      .send({ position: { ...VALID_POSITION, lat: 200 } });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  test('400 when longitude is out of range', async () => {
    const { app } = await buildApp();
    const res = await request(app)
      .post('/crew-1/sos')
      .send({ position: { ...VALID_POSITION, lng: -999 } });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  test('400 when position is missing capturedAt', async () => {
    const { app } = await buildApp();
    const res = await request(app)
      .post('/crew-1/sos')
      .send({ position: { lat: 41.0, lng: -87.0 } });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  // ── Rate limit (real SOS_RAISE_LIMIT, 1 per 120s/user) ──────────────
  test('429 with Retry-After on a second raise within the throttle window', async () => {
    const { app } = await buildApp();

    const first = await request(app).post('/crew-1/sos').send({ message: 'help' });
    assert.equal(first.status, 200);

    const second = await request(app).post('/crew-1/sos').send({ message: 'help again' });
    assert.equal(second.status, 429);
    assert.equal(second.body.error.code, 'RATE_LIMITED');
    assert.ok(second.headers['retry-after'], 'sets a Retry-After header');
  });

  // ── Feature flag ────────────────────────────────────────────────────
  test('503 when SOS_ENABLED is explicitly false', async () => {
    const { app } = await buildApp({ config: { SOS_ENABLED: false } });
    const res = await request(app).post('/crew-1/sos').send({ message: 'help' });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
  });

  // ── Internal error ──────────────────────────────────────────────────
  test('returns 500 when membership lookup throws', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => {
            throw new Error('db down');
          }),
        },
      },
    });

    const res = await request(app).post('/crew-1/sos').send({ message: 'help' });
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  POST /:crewId/sos/clear — clear an SOS
// =====================================================================
describe('routes/crew-sos.ts — POST /:crewId/sos/clear', () => {
  test('member can clear an SOS → 200 with activityId + clearedAt', async () => {
    const { app } = await buildApp();
    const res = await request(app).post('/crew-1/sos/clear').send({});

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.code, 'OK');
    assert.equal(res.body.data.activityId, 'activity-1');
    assert.ok(res.body.data.clearedAt);
  });

  test('writes a crew_activity row of type sos_cleared', async () => {
    const logFn = mock.fn(async () => 'activity-clear');
    const { app } = await buildApp({ stores: { activity: { log: logFn } } });

    await request(app).post('/crew-1/sos/clear').send({});

    assert.equal(logFn.mock.calls.length, 1);
    const arg = (logFn.mock.calls as any[])[0].arguments[0];
    assert.equal(arg.type, 'sos_cleared');
    assert.equal(arg.crewId, 'crew-1');
    assert.equal(arg.detail, null);
  });

  test('broadcasts sos:cleared to the crew room', async () => {
    const ioObj = makeIo();
    const { app } = await buildApp({ io: ioObj });

    await request(app).post('/crew-1/sos/clear').send({});

    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'sos:cleared');
    const payload = (ioObj._emit.mock.calls as any[])[0].arguments[1];
    assert.equal(payload.crewId, 'crew-1');
    assert.equal(payload.clearedBy, 'testuser');
  });

  test('clear does NOT trigger a push fan-out', async () => {
    const sendFn = mock.fn(async () => ({ ok: true }));
    const { app } = await buildApp({ notificationService: { send: sendFn } });

    await request(app).post('/crew-1/sos/clear').send({});
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(sendFn.mock.calls.length, 0);
  });

  test('returns 403 when the user is not a crew member', async () => {
    const { app } = await buildApp({
      stores: { crews: { getMember: mock.fn(async () => null) } },
    });

    const res = await request(app).post('/crew-1/sos/clear').send({});
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('clear is NOT throttled by SOS_RAISE_LIMIT (any member, any time)', async () => {
    const { app } = await buildApp();
    const a = await request(app).post('/crew-1/sos/clear').send({});
    const b = await request(app).post('/crew-1/sos/clear').send({});
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
  });

  test('activity-log failure is non-fatal — still 200 and still broadcasts', async () => {
    const ioObj = makeIo();
    const { app } = await buildApp({
      io: ioObj,
      stores: {
        activity: {
          log: mock.fn(async () => {
            throw new Error('db down');
          }),
        },
      },
    });

    const res = await request(app).post('/crew-1/sos/clear').send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.data.activityId, null);
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'sos:cleared');
  });

  test('returns 500 when membership lookup throws', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => {
            throw new Error('db down');
          }),
        },
      },
    });

    const res = await request(app).post('/crew-1/sos/clear').send({});
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});
