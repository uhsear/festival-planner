/**
 * Mock-based route tests for routes/crew-status.js (M5 + 055).
 *
 * Covers: GET /:crewId/status, PUT /:crewId/status — with the 055 offline
 * presence breadcrumb (optional `position` mapped to latitude/longitude/
 * locationCapturedAt; now() default when capturedAt is omitted).
 *
 * Mounts the route factory on a minimal Express app with fully stubbed deps.
 * No database required — all stores are mock.fn() stubs and validate is a
 * passthrough, so the body shape is exercised exactly as the route reads it.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';

function noop() {}
const noopLog = { info: noop, warn: noop, error: noop, debug: noop };

function makeIo() {
  const emitFn = mock.fn(() => {});
  return {
    to: mock.fn(() => ({ emit: emitFn })),
    _emit: emitFn,
  };
}

function makeDeps(overrides: any = {}) {
  const ioObj = makeIo();
  const storesBase = {
    crews: {
      getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
    },
    crewStatus: {
      listByCrew: mock.fn(async () => []),
      upsert: mock.fn(async (data: any) => ({
        crew_id: data.crewId,
        user_id: data.userId,
        status: data.status ?? null,
        target_meeting_point_id: data.targetMeetingPointId ?? null,
        eta_minutes: data.etaMinutes ?? null,
        note: data.note ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        location_captured_at: data.locationCapturedAt ?? null,
        updated_at: '2026-06-14T12:00:00.000Z',
      })),
    },
  };

  const stores: any = { ...storesBase };
  if (overrides.stores) {
    stores.crews = { ...storesBase.crews, ...(overrides.stores.crews || {}) };
    stores.crewStatus = { ...storesBase.crewStatus, ...(overrides.stores.crewStatus || {}) };
  }

  return {
    express,
    log: noopLog,
    userAuth:
      overrides.userAuth ||
      ((req: any, _res: any, next: any) => {
        req.user = { userId: 'user-1', username: 'testuser' };
        next();
      }),
    sanitizeIdentifier: overrides.sanitizeIdentifier || ((s: any) => (typeof s === 'string' ? s.trim() : '')),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: any, msg: any, code: any) =>
      res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
    ErrorCodes: {
      FORBIDDEN: 'FORBIDDEN',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    rateLimit: overrides.rateLimit || (() => (_req: any, _res: any, next: any) => next()),
    validate:
      overrides.validate ||
      (() => (req: any, _res: any, next: any) => {
        req.validatedBody = req.body;
        next();
      }),
    validateParams:
      overrides.validateParams ||
      (() => (req: any, _res: any, next: any) => {
        req.validatedParams = req.params;
        next();
      }),
    schemas: { crewIdParams: {}, crewStatus: {} },
    io: overrides.io !== undefined ? overrides.io : ioObj,
    stores,
  };
}

async function buildApp(overrides: any = {}) {
  const deps = makeDeps(overrides);
  const { default: createRoutes } = await import('../routes/crew-status.js');
  const router = createRoutes(deps as any);
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return { app, deps };
}

// =====================================================================
//  GET /:crewId/status
// =====================================================================
describe('routes/crew-status.js -- GET /:crewId/status', () => {
  test('returns the crew statuses for a member', async () => {
    const rows = [{ crew_id: 'crew-1', user_id: 'user-1', status: 'here', latitude: 41.85, longitude: -87.65 }];
    const { app } = await buildApp({ stores: { crewStatus: { listByCrew: mock.fn(async () => rows) } } });

    const res = await request(app).get('/crew-1/status');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.statuses, rows);
  });

  test('returns 403 when not a crew member', async () => {
    const { app } = await buildApp({ stores: { crews: { getMember: mock.fn(async () => null) } } });
    const res = await request(app).get('/crew-1/status');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });
});

// =====================================================================
//  PUT /:crewId/status — 055 offline presence breadcrumb
// =====================================================================
describe('routes/crew-status.js -- PUT /:crewId/status', () => {
  test('maps position {lat,lng,capturedAt} to latitude/longitude/locationCapturedAt', async () => {
    const upsert = mock.fn(async (data: any) => ({ crew_id: data.crewId, user_id: data.userId }));
    const { app } = await buildApp({ stores: { crewStatus: { upsert } } });

    await request(app)
      .put('/crew-1/status')
      .send({ status: 'on-my-way', position: { lat: 41.85, lng: -87.65, capturedAt: '2026-06-14T12:00:00.000Z' } });

    const arg = (upsert.mock.calls as any[])[0].arguments[0];
    assert.equal(arg.latitude, 41.85);
    assert.equal(arg.longitude, -87.65);
    assert.equal(arg.locationCapturedAt, '2026-06-14T12:00:00.000Z');
  });

  test('defaults locationCapturedAt to an ISO now() when position omits capturedAt', async () => {
    const upsert = mock.fn(async (data: any) => ({ crew_id: data.crewId, user_id: data.userId }));
    const { app } = await buildApp({ stores: { crewStatus: { upsert } } });

    await request(app)
      .put('/crew-1/status')
      .send({ position: { lat: 0, lng: 0 } });

    const arg = (upsert.mock.calls as any[])[0].arguments[0];
    assert.equal(arg.latitude, 0);
    assert.equal(arg.longitude, 0);
    assert.ok(typeof arg.locationCapturedAt === 'string');
    // A valid ISO timestamp.
    assert.ok(!Number.isNaN(Date.parse(arg.locationCapturedAt)));
  });

  test('passes null breadcrumb fields when no position is provided', async () => {
    const upsert = mock.fn(async (data: any) => ({ crew_id: data.crewId, user_id: data.userId }));
    const { app } = await buildApp({ stores: { crewStatus: { upsert } } });

    await request(app).put('/crew-1/status').send({ status: 'here' });

    const arg = (upsert.mock.calls as any[])[0].arguments[0];
    assert.equal(arg.latitude, null);
    assert.equal(arg.longitude, null);
    assert.equal(arg.locationCapturedAt, null);
  });

  test('broadcasts crew:status-updated with the upserted (snake_case) row', async () => {
    const ioObj = makeIo();
    const { app } = await buildApp({ io: ioObj });

    await request(app)
      .put('/crew-1/status')
      .send({ status: 'on-my-way', position: { lat: 1, lng: 2 } });

    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:status-updated');
    const payload = (ioObj._emit.mock.calls as any[])[0].arguments[1];
    assert.ok(payload.status);
    assert.equal(payload.status.location_captured_at !== undefined, true);
  });

  test('returns 403 when not a crew member', async () => {
    const { app } = await buildApp({ stores: { crews: { getMember: mock.fn(async () => null) } } });
    const res = await request(app).put('/crew-1/status').send({ status: 'here' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('returns 500 on internal error', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => {
            throw new Error('db down');
          }),
        },
      },
    });
    const res = await request(app).put('/crew-1/status').send({ status: 'here' });
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});
