/**
 * Mock-based route tests for routes/crew-rides.js
 *
 * Covers: GET /:crewId/rides, POST /:crewId/rides,
 *         PUT /:crewId/rides/:itemId, DELETE /:crewId/rides/:itemId
 * Mounts the route factory on a minimal Express app with fully stubbed deps.
 * No database required — all stores are mock.fn() stubs. Pattern cloned
 * from tests/crew-polls.test.ts / tests/crew-packing.test.ts.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';

// ── Shared helpers ───────────────────────────────────────────────────

function noop() {}
const noopLog = { info: noop, warn: noop, error: noop, debug: noop };

function makeIo() {
  const emitFn = mock.fn(() => {});
  return {
    to: mock.fn(() => ({ emit: emitFn })),
    _emit: emitFn,
  };
}

const DEFAULT_OFFER = {
  id: 'ride-1',
  crew_id: 'crew-1',
  created_by: 'user-1',
  driver: 'Ada',
  seats: 3,
  depart_from: 'North lot',
  depart_at: 'Fri 2pm',
  note: 'Leaving sharp',
  created_at: '2026-01-01T00:00:00.000Z',
};

/**
 * Build a deps object tailored for crew-rides.js.
 */
function makeRidesDeps(overrides: any = {}) {
  const ioObj = makeIo();
  const storesBase = {
    crews: {
      getMember: mock.fn(async () => null),
    },
    crewRides: {
      listByCrew: mock.fn(async () => []),
      countByCrew: mock.fn(async () => 0),
      create: mock.fn(async (data: any) => ({
        id: 'ride-new',
        crew_id: data.crewId,
        created_by: data.createdBy,
        driver: data.driver,
        seats: data.seats,
        depart_from: data.departFrom,
        depart_at: data.departAt,
        note: data.note,
        created_at: new Date().toISOString(),
      })),
      getById: mock.fn(async () => null),
      update: mock.fn(async () => ({ ...DEFAULT_OFFER })),
      delete: mock.fn(async () => {}),
    },
    activity: {
      log: mock.fn(async () => {}),
    },
  };

  // Deep-merge stores
  const stores: any = { ...storesBase };
  if (overrides.stores) {
    stores.crews = { ...storesBase.crews, ...overrides.stores.crews };
    stores.crewRides = { ...storesBase.crewRides, ...overrides.stores.crewRides };
    stores.activity = { ...storesBase.activity, ...overrides.stores.activity };
  }

  const deps = {
    express,
    log: noopLog,
    userAuth: overrides.userAuth || ((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', username: 'testuser' };
      next();
    }),
    sanitizeIdentifier: overrides.sanitizeIdentifier || ((s: any) => (typeof s === 'string' ? s.trim() : '')),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: any, msg: any, code: any) => res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      CONFLICT: 'CONFLICT',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    rateLimit: overrides.rateLimit || ((_max: any, _key: any) => (_req: any, _res: any, next: any) => next()),
    schemas: {
      crewIdParams: {},
      crewIdItemIdParams: {},
      rideCreate: {},
      rideUpdate: {},
    },
    validate: overrides.validate || ((_schema: any) => (req: any, _res: any, next: any) => { req.validatedBody = req.body; next(); }),
    validateParams: overrides.validateParams || ((_schema: any) => (req: any, _res: any, next: any) => { req.validatedParams = req.params; next(); }),
    io: overrides.io !== undefined ? overrides.io : ioObj,
    stores,
  };

  return deps;
}

async function buildRidesApp(overrides: any = {}) {
  const deps = makeRidesDeps(overrides);
  const { default: createCrewRidesRoutes } = await import('../routes/crew-rides.js');
  const router = createCrewRidesRoutes(deps);
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return { app, deps };
}

// =====================================================================
//  GET /:crewId/rides — List ride offers for a crew
// =====================================================================
describe('routes/crew-rides.js — GET /:crewId/rides', () => {

  test('factory returns an Express router', async () => {
    const { app } = await buildRidesApp();
    assert.ok(app);
  });

  // ── Happy path ────────────────────────────────────────────────────
  test('returns ride offers list for a crew member', async () => {
    const offers = [
      { ...DEFAULT_OFFER },
      { ...DEFAULT_OFFER, id: 'ride-2', driver: 'Bo' },
    ];
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          listByCrew: mock.fn(async () => offers),
        },
      },
    });

    const res = await request(app).get('/crew-1/rides');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.offers.length, 2);
    assert.equal(res.body.data.offers[0].id, 'ride-1');
    assert.equal(res.body.data.offers[1].id, 'ride-2');
  });

  test('returns empty array when crew has no ride offers', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          listByCrew: mock.fn(async () => []),
        },
      },
    });

    const res = await request(app).get('/crew-1/rides');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.deepEqual(res.body.data.offers, []);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).get('/crew-1/rides');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Not a crew member/i);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app).get('/crew-1/rides');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  POST /:crewId/rides — Create a ride offer
// =====================================================================
describe('routes/crew-rides.js — POST /:crewId/rides', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('creates a ride offer successfully', async () => {
    const createFn = mock.fn(async (data: any) => ({
      id: 'ride-new',
      crew_id: data.crewId,
      created_by: data.createdBy,
      driver: data.driver,
      seats: data.seats,
      depart_from: data.departFrom,
      depart_at: data.departAt,
      note: data.note,
    }));
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          countByCrew: mock.fn(async () => 0),
          create: createFn,
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/rides')
      .send({ driver: 'Ada', seats: 3 });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.offer.id, 'ride-new');
    assert.equal(res.body.data.offer.driver, 'Ada');
    assert.equal(createFn.mock.calls.length, 1);
    assert.equal((createFn.mock.calls as any[])[0].arguments[0].crewId, 'crew-1');
    assert.equal((createFn.mock.calls as any[])[0].arguments[0].createdBy, 'user-1');
  });

  test('passes departFrom, departAt and note through when provided', async () => {
    const createFn = mock.fn(async (data: any) => ({
      id: 'ride-new',
      crew_id: data.crewId,
      created_by: data.createdBy,
      driver: data.driver,
      seats: data.seats,
      depart_from: data.departFrom,
      depart_at: data.departAt,
      note: data.note,
    }));
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          countByCrew: mock.fn(async () => 0),
          create: createFn,
        },
      },
    });

    await request(app)
      .post('/crew-1/rides')
      .send({ driver: 'Cy', seats: 2, departFrom: 'South gate', departAt: 'Sat 9am', note: 'Two open seats' });

    const passed = (createFn.mock.calls as any[])[0].arguments[0];
    assert.equal(passed.departFrom, 'South gate');
    assert.equal(passed.departAt, 'Sat 9am');
    assert.equal(passed.note, 'Two open seats');
  });

  test('defaults all optional fields to null when not provided', async () => {
    const createFn = mock.fn(async (data: any) => ({
      id: 'ride-new',
      crew_id: data.crewId,
      created_by: data.createdBy,
    }));
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          countByCrew: mock.fn(async () => 0),
          create: createFn,
        },
      },
    });

    await request(app)
      .post('/crew-1/rides')
      .send({});

    const passed = (createFn.mock.calls as any[])[0].arguments[0];
    assert.equal(passed.driver, null);
    assert.equal(passed.seats, null);
    assert.equal(passed.departFrom, null);
    assert.equal(passed.departAt, null);
    assert.equal(passed.note, null);
  });

  // ── Socket.IO broadcast ───────────────────────────────────────────
  test('broadcasts crew:ride-created via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildRidesApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          countByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data: any) => ({
            id: 'ride-new',
            driver: data.driver,
          })),
        },
      },
    });

    await request(app)
      .post('/crew-1/rides')
      .send({ driver: 'Ada' });

    assert.equal(ioObj.to.mock.calls.length, 1);
    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:ride-created');
    const payload = (ioObj._emit.mock.calls as any[])[0].arguments[1];
    assert.equal(payload.offer.id, 'ride-new');
    assert.equal(payload.offer.driver, 'Ada');
  });

  // ── Activity logging ──────────────────────────────────────────────
  test('logs ride-created activity using driver name', async () => {
    const activityLog = mock.fn(async () => {});
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          countByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data: any) => ({
            id: 'ride-new',
            driver: data.driver,
            depart_from: data.departFrom,
          })),
        },
        activity: {
          log: activityLog,
        },
      },
    });

    await request(app)
      .post('/crew-1/rides')
      .send({ driver: 'Ada' });

    assert.equal(activityLog.mock.calls.length, 1);
    const logArgs = (activityLog.mock.calls as any[])[0].arguments[0];
    assert.equal(logArgs.crewId, 'crew-1');
    assert.equal(logArgs.userId, 'user-1');
    assert.equal(logArgs.type, 'ride-created');
    assert.equal(logArgs.detail, 'Ada');
  });

  test('logs ride-created activity falling back to Ride label when driver and departFrom are empty', async () => {
    const activityLog = mock.fn(async () => {});
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          countByCrew: mock.fn(async () => 0),
          create: mock.fn(async () => ({
            id: 'ride-new',
            driver: null,
            depart_from: null,
          })),
        },
        activity: {
          log: activityLog,
        },
      },
    });

    await request(app)
      .post('/crew-1/rides')
      .send({});

    const logArgs = (activityLog.mock.calls as any[])[0].arguments[0];
    assert.equal(logArgs.detail, 'Ride');
  });

  // ── Max offers limit ────────────────────────────────────────────────
  test('returns 409 when crew already has 200 ride offers', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          countByCrew: mock.fn(async () => 200),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/rides')
      .send({ driver: 'Too many?' });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
    assert.match(res.body.error.message, /Max 200 ride offers/i);
  });

  test('allows creating an offer when crew has fewer than 200 offers', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          countByCrew: mock.fn(async () => 199),
          create: mock.fn(async (data: any) => ({
            id: 'ride-new',
            driver: data.driver,
          })),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/rides')
      .send({ driver: 'Almost full?' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/rides')
      .send({ driver: 'Ada' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Activity log failure does not break response ──────────────────
  test('succeeds even when activity logging fails', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          countByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data: any) => ({
            id: 'ride-new',
            driver: data.driver,
          })),
        },
        activity: {
          log: mock.fn(async () => { throw new Error('activity store down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/rides')
      .send({ driver: 'Still works?' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          countByCrew: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/rides')
      .send({ driver: 'Crash?' });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  PUT /:crewId/rides/:itemId — Update a ride offer
// =====================================================================
describe('routes/crew-rides.js — PUT /:crewId/rides/:itemId', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('updates a ride offer successfully', async () => {
    const updateFn = mock.fn(async () => ({ ...DEFAULT_OFFER, seats: 1 }));
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          getById: mock.fn(async () => ({ ...DEFAULT_OFFER })),
          update: updateFn,
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/rides/ride-1')
      .send({ seats: 1 });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.offer.seats, 1);
    assert.equal(updateFn.mock.calls.length, 1);
    assert.equal((updateFn.mock.calls as any[])[0].arguments[0], 'ride-1');
  });

  // ── Socket.IO broadcast ───────────────────────────────────────────
  test('broadcasts crew:ride-updated via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildRidesApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          getById: mock.fn(async () => ({ ...DEFAULT_OFFER })),
          update: mock.fn(async () => ({ ...DEFAULT_OFFER, seats: 1 })),
        },
      },
    });

    await request(app)
      .put('/crew-1/rides/ride-1')
      .send({ seats: 1 });

    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:ride-updated');
    const payload = (ioObj._emit.mock.calls as any[])[0].arguments[1];
    assert.equal(payload.offer.seats, 1);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/rides/ride-1')
      .send({ seats: 1 });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Offer not found ───────────────────────────────────────────────
  test('returns 404 when offer does not exist', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          getById: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/rides/ride-missing')
      .send({ seats: 1 });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Offer belongs to different crew ───────────────────────────────
  test('returns 404 when offer belongs to a different crew', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          getById: mock.fn(async () => ({ ...DEFAULT_OFFER, crew_id: 'crew-other' })),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/rides/ride-1')
      .send({ seats: 1 });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          getById: mock.fn(async () => ({ ...DEFAULT_OFFER })),
          update: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/rides/ride-1')
      .send({ seats: 1 });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  DELETE /:crewId/rides/:itemId — Remove a ride offer
// =====================================================================
describe('routes/crew-rides.js — DELETE /:crewId/rides/:itemId', () => {

  // ── Happy path: creator removes own offer ─────────────────────────
  test('creator can remove their own offer', async () => {
    const deleteFn = mock.fn(async () => {});
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          getById: mock.fn(async () => ({ ...DEFAULT_OFFER, created_by: 'user-1' })),
          delete: deleteFn,
        },
      },
    });

    const res = await request(app).delete('/crew-1/rides/ride-1');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.deleted, true);
    assert.equal(deleteFn.mock.calls.length, 1);
    assert.equal((deleteFn.mock.calls as any[])[0].arguments[0], 'ride-1');
  });

  // ── Happy path: owner removes any offer ────────────────────────────
  test('crew owner can remove any offer regardless of creator', async () => {
    const deleteFn = mock.fn(async () => {});
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        crewRides: {
          getById: mock.fn(async () => ({ ...DEFAULT_OFFER, created_by: 'other-user' })),
          delete: deleteFn,
        },
      },
    });

    const res = await request(app).delete('/crew-1/rides/ride-1');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(deleteFn.mock.calls.length, 1);
  });

  // ── Socket.IO broadcast ───────────────────────────────────────────
  test('broadcasts crew:ride-deleted via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildRidesApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        crewRides: {
          getById: mock.fn(async () => ({ ...DEFAULT_OFFER })),
          delete: mock.fn(async () => {}),
        },
      },
    });

    await request(app).delete('/crew-1/rides/ride-1');

    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:ride-deleted');
    assert.deepEqual((ioObj._emit.mock.calls as any[])[0].arguments[1], { itemId: 'ride-1' });
  });

  // ── Permission: regular member cannot remove another's offer ──────
  test('returns 403 when non-owner member tries to remove another users offer', async () => {
    const deleteFn = mock.fn(async () => {});
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewRides: {
          getById: mock.fn(async () => ({ ...DEFAULT_OFFER, created_by: 'other-user' })),
          delete: deleteFn,
        },
      },
    });

    const res = await request(app).delete('/crew-1/rides/ride-1');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Only creator or owner/i);
    assert.equal(deleteFn.mock.calls.length, 0);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).delete('/crew-1/rides/ride-1');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Offer not found ───────────────────────────────────────────────
  test('returns 404 when offer does not exist', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        crewRides: {
          getById: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).delete('/crew-1/rides/ride-missing');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Offer belongs to different crew ───────────────────────────────
  test('returns 404 when offer belongs to a different crew', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        crewRides: {
          getById: mock.fn(async () => ({ ...DEFAULT_OFFER, crew_id: 'crew-other' })),
        },
      },
    });

    const res = await request(app).delete('/crew-1/rides/ride-1');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildRidesApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        crewRides: {
          getById: mock.fn(async () => ({ ...DEFAULT_OFFER })),
          delete: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app).delete('/crew-1/rides/ride-1');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  Rate limiting
// =====================================================================
describe('routes/crew-rides.js — rate limiting', () => {

  test('applies rate limit to GET /:crewId/rides', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildRidesApp({
      rateLimit: (max: any, key: any) => {
        rateLimitCalls.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    await request(app).get('/crew-1/rides');

    const limit = rateLimitCalls.find((c: any) => c.key === 'crew-rides-list');
    assert.ok(limit, 'crew-rides-list rate limit should be applied');
    assert.equal(limit.max, 120);
  });

  test('applies rate limit to POST /:crewId/rides', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildRidesApp({
      rateLimit: (max: any, key: any) => {
        rateLimitCalls.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    await request(app)
      .post('/crew-1/rides')
      .send({ driver: 'Test?' });

    const limit = rateLimitCalls.find((c: any) => c.key === 'crew-rides-create');
    assert.ok(limit, 'crew-rides-create rate limit should be applied');
    assert.equal(limit.max, 30);
  });

  test('applies rate limit to PUT /:crewId/rides/:itemId', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildRidesApp({
      rateLimit: (max: any, key: any) => {
        rateLimitCalls.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    await request(app)
      .put('/crew-1/rides/ride-1')
      .send({ seats: 1 });

    const limit = rateLimitCalls.find((c: any) => c.key === 'crew-rides-update');
    assert.ok(limit, 'crew-rides-update rate limit should be applied');
    assert.equal(limit.max, 60);
  });

  test('applies rate limit to DELETE /:crewId/rides/:itemId', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildRidesApp({
      rateLimit: (max: any, key: any) => {
        rateLimitCalls.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    await request(app).delete('/crew-1/rides/ride-1');

    const limit = rateLimitCalls.find((c: any) => c.key === 'crew-rides-delete');
    assert.ok(limit, 'crew-rides-delete rate limit should be applied');
    assert.equal(limit.max, 30);
  });
});
