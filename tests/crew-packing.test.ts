/**
 * Mock-based route tests for routes/crew-packing.js
 *
 * Covers: GET /:crewId/packing, POST /:crewId/packing,
 *         PUT /:crewId/packing/:itemId, DELETE /:crewId/packing/:itemId
 * Mounts the route factory on a minimal Express app with fully stubbed deps.
 * No database required — all stores are mock.fn() stubs. Pattern cloned
 * from tests/crew-polls.test.ts (identical deps shape / router wiring).
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

const DEFAULT_ITEM = {
  id: 'pack-1',
  crew_id: 'crew-1',
  created_by: 'user-1',
  label: 'Tent',
  brought_by: null,
  claimed: false,
  created_at: '2026-01-01T00:00:00.000Z',
};

/**
 * Build a deps object tailored for crew-packing.js.
 */
function makePackingDeps(overrides: any = {}) {
  const ioObj = makeIo();
  const storesBase = {
    crews: {
      getMember: mock.fn(async () => null),
    },
    crewPacking: {
      listByCrew: mock.fn(async () => []),
      countByCrew: mock.fn(async () => 0),
      create: mock.fn(async (data: any) => ({
        id: 'pack-new',
        crew_id: data.crewId,
        created_by: data.createdBy,
        label: data.label,
        brought_by: data.broughtBy,
        claimed: data.claimed,
        created_at: new Date().toISOString(),
      })),
      getById: mock.fn(async () => null),
      update: mock.fn(async () => ({ ...DEFAULT_ITEM })),
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
    stores.crewPacking = { ...storesBase.crewPacking, ...overrides.stores.crewPacking };
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
      packingCreate: {},
      packingUpdate: {},
    },
    validate: overrides.validate || ((_schema: any) => (req: any, _res: any, next: any) => { req.validatedBody = req.body; next(); }),
    validateParams: overrides.validateParams || ((_schema: any) => (req: any, _res: any, next: any) => { req.validatedParams = req.params; next(); }),
    io: overrides.io !== undefined ? overrides.io : ioObj,
    stores,
  };

  return deps;
}

async function buildPackingApp(overrides: any = {}) {
  const deps = makePackingDeps(overrides);
  const { default: createCrewPackingRoutes } = await import('../routes/crew-packing.js');
  const router = createCrewPackingRoutes(deps);
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return { app, deps };
}

// =====================================================================
//  GET /:crewId/packing — List packing items for a crew
// =====================================================================
describe('routes/crew-packing.js — GET /:crewId/packing', () => {

  test('factory returns an Express router', async () => {
    const { app } = await buildPackingApp();
    assert.ok(app);
  });

  // ── Happy path ────────────────────────────────────────────────────
  test('returns packing items list for a crew member', async () => {
    const items = [
      { ...DEFAULT_ITEM },
      { ...DEFAULT_ITEM, id: 'pack-2', label: 'Cooler', claimed: true },
    ];
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          listByCrew: mock.fn(async () => items),
        },
      },
    });

    const res = await request(app).get('/crew-1/packing');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.items.length, 2);
    assert.equal(res.body.data.items[0].id, 'pack-1');
    assert.equal(res.body.data.items[1].id, 'pack-2');
  });

  test('returns empty array when crew has no packing items', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          listByCrew: mock.fn(async () => []),
        },
      },
    });

    const res = await request(app).get('/crew-1/packing');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.deepEqual(res.body.data.items, []);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).get('/crew-1/packing');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Not a crew member/i);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app).get('/crew-1/packing');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  POST /:crewId/packing — Create a packing item
// =====================================================================
describe('routes/crew-packing.js — POST /:crewId/packing', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('creates a packing item successfully', async () => {
    const createFn = mock.fn(async (data: any) => ({
      id: 'pack-new',
      crew_id: data.crewId,
      created_by: data.createdBy,
      label: data.label,
      brought_by: data.broughtBy,
      claimed: data.claimed,
    }));
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          countByCrew: mock.fn(async () => 0),
          create: createFn,
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/packing')
      .send({ label: 'Tent' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.item.id, 'pack-new');
    assert.equal(res.body.data.item.label, 'Tent');
    assert.equal(createFn.mock.calls.length, 1);
    assert.equal((createFn.mock.calls as any[])[0].arguments[0].crewId, 'crew-1');
    assert.equal((createFn.mock.calls as any[])[0].arguments[0].createdBy, 'user-1');
  });

  test('passes broughtBy and claimed through when provided', async () => {
    const createFn = mock.fn(async (data: any) => ({
      id: 'pack-new',
      crew_id: data.crewId,
      created_by: data.createdBy,
      label: data.label,
      brought_by: data.broughtBy,
      claimed: data.claimed,
    }));
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          countByCrew: mock.fn(async () => 0),
          create: createFn,
        },
      },
    });

    await request(app)
      .post('/crew-1/packing')
      .send({ label: 'Cooler', broughtBy: 'user-2', claimed: true });

    const passed = (createFn.mock.calls as any[])[0].arguments[0];
    assert.equal(passed.broughtBy, 'user-2');
    assert.equal(passed.claimed, true);
  });

  test('defaults broughtBy to null and claimed to false when not provided', async () => {
    const createFn = mock.fn(async (data: any) => ({
      id: 'pack-new',
      crew_id: data.crewId,
      created_by: data.createdBy,
      label: data.label,
    }));
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          countByCrew: mock.fn(async () => 0),
          create: createFn,
        },
      },
    });

    await request(app)
      .post('/crew-1/packing')
      .send({ label: 'Chairs' });

    const passed = (createFn.mock.calls as any[])[0].arguments[0];
    assert.equal(passed.broughtBy, null);
    assert.equal(passed.claimed, false);
  });

  // ── Socket.IO broadcast ───────────────────────────────────────────
  test('broadcasts crew:packing-created via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildPackingApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          countByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data: any) => ({
            id: 'pack-new',
            label: data.label,
          })),
        },
      },
    });

    await request(app)
      .post('/crew-1/packing')
      .send({ label: 'Tent' });

    assert.equal(ioObj.to.mock.calls.length, 1);
    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:packing-created');
    const payload = (ioObj._emit.mock.calls as any[])[0].arguments[1];
    assert.equal(payload.item.id, 'pack-new');
    assert.equal(payload.item.label, 'Tent');
  });

  // ── Activity logging ──────────────────────────────────────────────
  test('logs packing-created activity', async () => {
    const activityLog = mock.fn(async () => {});
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          countByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data: any) => ({
            id: 'pack-new',
            label: data.label,
          })),
        },
        activity: {
          log: activityLog,
        },
      },
    });

    await request(app)
      .post('/crew-1/packing')
      .send({ label: 'Tent' });

    assert.equal(activityLog.mock.calls.length, 1);
    const logArgs = (activityLog.mock.calls as any[])[0].arguments[0];
    assert.equal(logArgs.crewId, 'crew-1');
    assert.equal(logArgs.userId, 'user-1');
    assert.equal(logArgs.type, 'packing-created');
    assert.equal(logArgs.detail, 'Tent');
  });

  // ── Max items limit ────────────────────────────────────────────────
  test('returns 409 when crew already has 200 packing items', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          countByCrew: mock.fn(async () => 200),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/packing')
      .send({ label: 'Too many?' });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
    assert.match(res.body.error.message, /Max 200 packing items/i);
  });

  test('allows creating an item when crew has fewer than 200 items', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          countByCrew: mock.fn(async () => 199),
          create: mock.fn(async (data: any) => ({
            id: 'pack-new',
            label: data.label,
          })),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/packing')
      .send({ label: 'Almost full?' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/packing')
      .send({ label: 'Tent' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Activity log failure does not break response ──────────────────
  test('succeeds even when activity logging fails', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          countByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data: any) => ({
            id: 'pack-new',
            label: data.label,
          })),
        },
        activity: {
          log: mock.fn(async () => { throw new Error('activity store down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/packing')
      .send({ label: 'Still works?' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          countByCrew: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/packing')
      .send({ label: 'Crash?' });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  PUT /:crewId/packing/:itemId — Update a packing item
// =====================================================================
describe('routes/crew-packing.js — PUT /:crewId/packing/:itemId', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('updates a packing item successfully', async () => {
    const updateFn = mock.fn(async () => ({ ...DEFAULT_ITEM, claimed: true }));
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          getById: mock.fn(async () => ({ ...DEFAULT_ITEM })),
          update: updateFn,
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/packing/pack-1')
      .send({ claimed: true });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.item.claimed, true);
    assert.equal(updateFn.mock.calls.length, 1);
    assert.equal((updateFn.mock.calls as any[])[0].arguments[0], 'pack-1');
  });

  // ── Socket.IO broadcast ───────────────────────────────────────────
  test('broadcasts crew:packing-updated via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildPackingApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          getById: mock.fn(async () => ({ ...DEFAULT_ITEM })),
          update: mock.fn(async () => ({ ...DEFAULT_ITEM, claimed: true })),
        },
      },
    });

    await request(app)
      .put('/crew-1/packing/pack-1')
      .send({ claimed: true });

    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:packing-updated');
    const payload = (ioObj._emit.mock.calls as any[])[0].arguments[1];
    assert.equal(payload.item.claimed, true);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/packing/pack-1')
      .send({ claimed: true });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Item not found ────────────────────────────────────────────────
  test('returns 404 when item does not exist', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          getById: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/packing/pack-missing')
      .send({ claimed: true });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Item belongs to different crew ────────────────────────────────
  test('returns 404 when item belongs to a different crew', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          getById: mock.fn(async () => ({ ...DEFAULT_ITEM, crew_id: 'crew-other' })),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/packing/pack-1')
      .send({ claimed: true });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          getById: mock.fn(async () => ({ ...DEFAULT_ITEM })),
          update: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/packing/pack-1')
      .send({ claimed: true });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  DELETE /:crewId/packing/:itemId — Remove a packing item
// =====================================================================
describe('routes/crew-packing.js — DELETE /:crewId/packing/:itemId', () => {

  // ── Happy path: creator removes own item ──────────────────────────
  test('creator can remove their own item', async () => {
    const deleteFn = mock.fn(async () => {});
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          getById: mock.fn(async () => ({ ...DEFAULT_ITEM, created_by: 'user-1' })),
          delete: deleteFn,
        },
      },
    });

    const res = await request(app).delete('/crew-1/packing/pack-1');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.deleted, true);
    assert.equal(deleteFn.mock.calls.length, 1);
    assert.equal((deleteFn.mock.calls as any[])[0].arguments[0], 'pack-1');
  });

  // ── Happy path: owner removes any item ─────────────────────────────
  test('crew owner can remove any item regardless of creator', async () => {
    const deleteFn = mock.fn(async () => {});
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        crewPacking: {
          getById: mock.fn(async () => ({ ...DEFAULT_ITEM, created_by: 'other-user' })),
          delete: deleteFn,
        },
      },
    });

    const res = await request(app).delete('/crew-1/packing/pack-1');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(deleteFn.mock.calls.length, 1);
  });

  // ── Socket.IO broadcast ───────────────────────────────────────────
  test('broadcasts crew:packing-deleted via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildPackingApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        crewPacking: {
          getById: mock.fn(async () => ({ ...DEFAULT_ITEM })),
          delete: mock.fn(async () => {}),
        },
      },
    });

    await request(app).delete('/crew-1/packing/pack-1');

    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:packing-deleted');
    assert.deepEqual((ioObj._emit.mock.calls as any[])[0].arguments[1], { itemId: 'pack-1' });
  });

  // ── Permission: regular member cannot remove another's item ───────
  test('returns 403 when non-owner member tries to remove another users item', async () => {
    const deleteFn = mock.fn(async () => {});
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        crewPacking: {
          getById: mock.fn(async () => ({ ...DEFAULT_ITEM, created_by: 'other-user' })),
          delete: deleteFn,
        },
      },
    });

    const res = await request(app).delete('/crew-1/packing/pack-1');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Only creator or owner/i);
    assert.equal(deleteFn.mock.calls.length, 0);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).delete('/crew-1/packing/pack-1');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Item not found ────────────────────────────────────────────────
  test('returns 404 when item does not exist', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        crewPacking: {
          getById: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).delete('/crew-1/packing/pack-missing');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Item belongs to different crew ────────────────────────────────
  test('returns 404 when item belongs to a different crew', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        crewPacking: {
          getById: mock.fn(async () => ({ ...DEFAULT_ITEM, crew_id: 'crew-other' })),
        },
      },
    });

    const res = await request(app).delete('/crew-1/packing/pack-1');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildPackingApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        crewPacking: {
          getById: mock.fn(async () => ({ ...DEFAULT_ITEM })),
          delete: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app).delete('/crew-1/packing/pack-1');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  Rate limiting
// =====================================================================
describe('routes/crew-packing.js — rate limiting', () => {

  test('applies rate limit to GET /:crewId/packing', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildPackingApp({
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

    await request(app).get('/crew-1/packing');

    const limit = rateLimitCalls.find((c: any) => c.key === 'crew-packing-list');
    assert.ok(limit, 'crew-packing-list rate limit should be applied');
    assert.equal(limit.max, 120);
  });

  test('applies rate limit to POST /:crewId/packing', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildPackingApp({
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
      .post('/crew-1/packing')
      .send({ label: 'Test?' });

    const limit = rateLimitCalls.find((c: any) => c.key === 'crew-packing-create');
    assert.ok(limit, 'crew-packing-create rate limit should be applied');
    assert.equal(limit.max, 30);
  });

  test('applies rate limit to PUT /:crewId/packing/:itemId', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildPackingApp({
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
      .put('/crew-1/packing/pack-1')
      .send({ claimed: true });

    const limit = rateLimitCalls.find((c: any) => c.key === 'crew-packing-update');
    assert.ok(limit, 'crew-packing-update rate limit should be applied');
    assert.equal(limit.max, 60);
  });

  test('applies rate limit to DELETE /:crewId/packing/:itemId', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildPackingApp({
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

    await request(app).delete('/crew-1/packing/pack-1');

    const limit = rateLimitCalls.find((c: any) => c.key === 'crew-packing-delete');
    assert.ok(limit, 'crew-packing-delete rate limit should be applied');
    assert.equal(limit.max, 30);
  });
});
