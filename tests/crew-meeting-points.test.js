'use strict';
/**
 * Mock-based route tests for routes/crew-meeting-points.js
 *
 * Covers: PUT /:crewId/home-base, GET /:crewId/meeting-points,
 *         POST /:crewId/meeting-points, PUT /:crewId/meeting-points/:mpId,
 *         DELETE /:crewId/meeting-points/:mpId
 *
 * Mounts the route factory on a minimal Express app with fully stubbed deps.
 * No database required -- all stores are mock.fn() stubs.
 */

const assert = require('node:assert/strict');
const { describe, test, mock } = require('node:test');
const express = require('express');
const request = require('supertest');

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

const DEFAULT_MEETING_POINT = {
  id: 'mp-1',
  crewId: 'crew-1',
  createdBy: 'user-1',
  label: 'Main Stage Left',
  location: 'Near the food trucks',
  type: 'during',
  meetAt: null,
  stageReference: null,
  expiresAt: null,
  active: true,
};

/**
 * Build a deps object tailored for crew-meeting-points.js.
 */
function makeDeps(overrides = {}) {
  const ioObj = makeIo();
  const storesBase = {
    crews: {
      getMember: mock.fn(async () => null),
      updateHomeBase: mock.fn(async () => ({ id: 'crew-1', homeBaseLocation: 'Gate A', homeBaseTime: '3pm' })),
      meetingPoints: {
        listByCrew: mock.fn(async () => []),
        countByCrew: mock.fn(async () => 0),
        create: mock.fn(async (data) => ({ ...data, active: true, createdAt: '2026-05-08T00:00:00.000Z' })),
        getById: mock.fn(async () => null),
        update: mock.fn(async (id, data) => ({ ...DEFAULT_MEETING_POINT, ...data, id })),
        deactivate: mock.fn(async () => {}),
      },
    },
    activity: {
      log: mock.fn(async () => {}),
    },
  };

  // Deep-merge stores
  const stores = { ...storesBase };
  if (overrides.stores) {
    const crewOverrides = overrides.stores.crews || {};
    const mpOverrides = crewOverrides.meetingPoints || {};
    stores.crews = {
      ...storesBase.crews,
      ...crewOverrides,
      meetingPoints: { ...storesBase.crews.meetingPoints, ...mpOverrides },
    };
    if (overrides.stores.activity) {
      stores.activity = { ...storesBase.activity, ...overrides.stores.activity };
    }
  }

  const deps = {
    express,
    log: noopLog,
    userAuth: overrides.userAuth || ((req, _res, next) => {
      req.user = { userId: 'user-1', username: 'testuser' };
      next();
    }),
    sanitizeIdentifier: overrides.sanitizeIdentifier || ((s) => (typeof s === 'string' ? s.trim() : '')),
    createOpaqueId: overrides.createOpaqueId || mock.fn(() => 'mp-new-1'),
    sendSuccess: (res, data) => res.json({ data, error: null }),
    sendError: (res, status, msg, code) => res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    rateLimit: overrides.rateLimit || (() => (_req, _res, next) => next()),
    validate: overrides.validate || (() => (req, _res, next) => { req.validatedBody = req.body; next(); }),
    validateParams: overrides.validateParams || (() => (req, _res, next) => { req.validatedParams = req.params; next(); }),
    schemas: {
      crewIdParams: {},
      crewIdMpIdParams: {},
      crewHomeBase: {},
      meetingPointCreate: {},
      meetingPointUpdate: {},
    },
    io: overrides.io !== undefined ? overrides.io : ioObj,
    stores,
  };

  return deps;
}

function buildApp(overrides = {}) {
  const deps = makeDeps(overrides);
  const createRoutes = require('../routes/crew-meeting-points');
  const router = createRoutes(deps);
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return { app, deps };
}

// =====================================================================
//  PUT /:crewId/home-base -- set crew home base (owner only)
// =====================================================================
describe('routes/crew-meeting-points.js -- PUT /:crewId/home-base', () => {

  test('factory returns an Express router', () => {
    const { app } = buildApp();
    assert.ok(app);
  });

  // ── Happy path ────────────────────────────────────────────────────
  test('owner can set home base location and time', async () => {
    const updateHomeBase = mock.fn(async () => ({
      id: 'crew-1', homeBaseLocation: 'Gate A', homeBaseTime: '3pm',
    }));
    const { app, deps } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          updateHomeBase,
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/home-base')
      .send({ location: 'Gate A', time: '3pm' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.ok(res.body.data.crew);
    assert.equal(updateHomeBase.mock.calls.length, 1);
    assert.equal(updateHomeBase.mock.calls[0].arguments[0], 'crew-1');
    assert.deepEqual(updateHomeBase.mock.calls[0].arguments[1], { location: 'Gate A', time: '3pm' });
  });

  test('broadcasts crew:home-base-updated via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = buildApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          updateHomeBase: mock.fn(async () => ({ id: 'crew-1' })),
        },
      },
    });

    await request(app)
      .put('/crew-1/home-base')
      .send({ location: 'Gate A', time: '3pm' });

    assert.equal(ioObj.to.mock.calls.length, 1);
    assert.equal(ioObj.to.mock.calls[0].arguments[0], 'crew:crew-1');
    assert.equal(ioObj._emit.mock.calls[0].arguments[0], 'crew:home-base-updated');
    assert.deepEqual(ioObj._emit.mock.calls[0].arguments[1], {
      crewId: 'crew-1', location: 'Gate A', time: '3pm',
    });
  });

  test('logs activity after setting home base', async () => {
    const activityLog = mock.fn(async () => {});
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          updateHomeBase: mock.fn(async () => ({ id: 'crew-1' })),
        },
        activity: { log: activityLog },
      },
    });

    await request(app)
      .put('/crew-1/home-base')
      .send({ location: 'Gate A', time: '3pm' });

    assert.equal(activityLog.mock.calls.length, 1);
    const logArg = activityLog.mock.calls[0].arguments[0];
    assert.equal(logArg.crewId, 'crew-1');
    assert.equal(logArg.userId, 'user-1');
    assert.equal(logArg.type, 'home-base-updated');
    assert.equal(logArg.detail, 'Gate A');
  });

  // ── Permission checks ─────────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/home-base')
      .send({ location: 'Gate A' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Not a crew member/);
  });

  test('returns 403 when user is a member but not owner', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/home-base')
      .send({ location: 'Gate A' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Only owner/);
  });

  // ── Edge cases ────────────────────────────────────────────────────
  test('allows setting home base with null location', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          updateHomeBase: mock.fn(async () => ({ id: 'crew-1' })),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/home-base')
      .send({ location: null, time: null });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  test('activity log detail is null when location is falsy', async () => {
    const activityLog = mock.fn(async () => {});
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          updateHomeBase: mock.fn(async () => ({ id: 'crew-1' })),
        },
        activity: { log: activityLog },
      },
    });

    await request(app)
      .put('/crew-1/home-base')
      .send({ time: '3pm' });

    assert.equal(activityLog.mock.calls[0].arguments[0].detail, null);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/home-base')
      .send({ location: 'Gate A' });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  GET /:crewId/meeting-points -- list meeting points
// =====================================================================
describe('routes/crew-meeting-points.js -- GET /:crewId/meeting-points', () => {

  test('returns meeting points for crew member', async () => {
    const points = [
      { ...DEFAULT_MEETING_POINT },
      { ...DEFAULT_MEETING_POINT, id: 'mp-2', label: 'Ferris Wheel' },
    ];
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            listByCrew: mock.fn(async () => points),
          },
        },
      },
    });

    const res = await request(app).get('/crew-1/meeting-points');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.meetingPoints.length, 2);
    assert.equal(res.body.data.meetingPoints[0].id, 'mp-1');
    assert.equal(res.body.data.meetingPoints[1].id, 'mp-2');
  });

  test('returns empty array when crew has no meeting points', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            listByCrew: mock.fn(async () => []),
          },
        },
      },
    });

    const res = await request(app).get('/crew-1/meeting-points');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.meetingPoints, []);
  });

  test('returns 403 when user is not a crew member', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).get('/crew-1/meeting-points');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('returns 500 on internal error', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app).get('/crew-1/meeting-points');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  POST /:crewId/meeting-points -- create meeting point
// =====================================================================
describe('routes/crew-meeting-points.js -- POST /:crewId/meeting-points', () => {

  test('creates meeting point for crew member', async () => {
    const createFn = mock.fn(async (data) => ({ ...data, active: true, createdAt: '2026-05-08T00:00:00.000Z' }));
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Main Stage', location: 'Left side', type: 'during' });

    assert.equal(res.status, 201);
    assert.equal(res.body.error, null);
    assert.ok(res.body.data.meetingPoint);
    assert.equal(res.body.data.meetingPoint.label, 'Main Stage');
    assert.equal(res.body.data.meetingPoint.crewId, 'crew-1');
    assert.equal(res.body.data.meetingPoint.createdBy, 'user-1');
    assert.equal(createFn.mock.calls.length, 1);
  });

  test('uses createOpaqueId to generate meeting point id', async () => {
    const createOpaqueId = mock.fn(() => 'mp-generated');
    const createFn = mock.fn(async (data) => data);
    const { app } = buildApp({
      createOpaqueId,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Test', location: 'Here' });

    assert.equal(createOpaqueId.mock.calls[0].arguments[0], 'mp');
    assert.equal(createFn.mock.calls[0].arguments[0].id, 'mp-generated');
  });

  test('defaults type to during when not provided', async () => {
    const createFn = mock.fn(async (data) => data);
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Test', location: 'Here' });

    assert.equal(createFn.mock.calls[0].arguments[0].type, 'during');
  });

  test('calculates expiresAt as meetAt + 30 minutes when meetAt is provided', async () => {
    const createFn = mock.fn(async (data) => data);
    const meetAt = '2026-06-15T14:00:00.000Z';
    const expectedExpiry = new Date(new Date(meetAt).getTime() + 30 * 60_000).toISOString();

    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Test', location: 'Here', meetAt });

    assert.equal(createFn.mock.calls[0].arguments[0].expiresAt, expectedExpiry);
    assert.equal(createFn.mock.calls[0].arguments[0].meetAt, meetAt);
  });

  test('sets expiresAt to null when meetAt is not provided', async () => {
    const createFn = mock.fn(async (data) => data);
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Test', location: 'Here' });

    assert.equal(createFn.mock.calls[0].arguments[0].expiresAt, null);
  });

  test('broadcasts crew:meeting-point-created via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = buildApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: mock.fn(async (data) => ({ ...data, active: true })),
          },
        },
      },
    });

    await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Stage B', location: 'Right side' });

    assert.equal(ioObj.to.mock.calls[0].arguments[0], 'crew:crew-1');
    assert.equal(ioObj._emit.mock.calls[0].arguments[0], 'crew:meeting-point-created');
  });

  // ── Max limit ─────────────────────────────────────────────────────
  test('returns 400 when max meeting points limit is reached', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 20),
          },
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'One more', location: 'Nope' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.match(res.body.error.message, /Maximum 20/);
  });

  // ── Permission checks ─────────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Test', location: 'Here' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('returns 500 on internal error', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Test', location: 'Here' });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  PUT /:crewId/meeting-points/:mpId -- update meeting point
// =====================================================================
describe('routes/crew-meeting-points.js -- PUT /:crewId/meeting-points/:mpId', () => {

  test('creator can update their own meeting point', async () => {
    const updateFn = mock.fn(async (id, data) => ({ ...DEFAULT_MEETING_POINT, ...data, id }));
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })),
            update: updateFn,
          },
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/meeting-points/mp-1')
      .send({ label: 'Updated Label' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.meetingPoint.label, 'Updated Label');
    assert.equal(updateFn.mock.calls[0].arguments[0], 'mp-1');
  });

  test('crew owner can update any meeting point', async () => {
    const mpByOtherUser = { ...DEFAULT_MEETING_POINT, createdBy: 'user-2' };
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          meetingPoints: {
            getById: mock.fn(async () => mpByOtherUser),
            update: mock.fn(async (id, data) => ({ ...mpByOtherUser, ...data, id })),
          },
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/meeting-points/mp-1')
      .send({ label: 'Owner Edit' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  test('broadcasts crew:meeting-point-updated via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = buildApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })),
            update: mock.fn(async (id, data) => ({ ...DEFAULT_MEETING_POINT, ...data, id })),
          },
        },
      },
    });

    await request(app)
      .put('/crew-1/meeting-points/mp-1')
      .send({ label: 'Updated' });

    assert.equal(ioObj.to.mock.calls[0].arguments[0], 'crew:crew-1');
    assert.equal(ioObj._emit.mock.calls[0].arguments[0], 'crew:meeting-point-updated');
  });

  // ── Not found cases ───────────────────────────────────────────────
  test('returns 404 when meeting point does not exist', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => null),
          },
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/meeting-points/mp-nonexistent')
      .send({ label: 'Updated' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('returns 404 when meeting point belongs to different crew', async () => {
    const mpFromOtherCrew = { ...DEFAULT_MEETING_POINT, crewId: 'crew-other' };
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => mpFromOtherCrew),
          },
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/meeting-points/mp-1')
      .send({ label: 'Updated' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('returns 404 when meeting point is inactive', async () => {
    const inactiveMp = { ...DEFAULT_MEETING_POINT, active: false };
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => inactiveMp),
          },
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/meeting-points/mp-1')
      .send({ label: 'Updated' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Permission checks ─────────────────────────────────────────────
  test('returns 403 when non-creator non-owner tries to update', async () => {
    const mpByOtherUser = { ...DEFAULT_MEETING_POINT, createdBy: 'user-2' };
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => mpByOtherUser),
          },
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/meeting-points/mp-1')
      .send({ label: 'Updated' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /creator or crew owner/);
  });

  test('returns 403 when user is not a crew member', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/meeting-points/mp-1')
      .send({ label: 'Updated' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('returns 500 on internal error', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .put('/crew-1/meeting-points/mp-1')
      .send({ label: 'Updated' });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  DELETE /:crewId/meeting-points/:mpId -- deactivate meeting point
// =====================================================================
describe('routes/crew-meeting-points.js -- DELETE /:crewId/meeting-points/:mpId', () => {

  test('creator can delete their own meeting point', async () => {
    const deactivateFn = mock.fn(async () => {});
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })),
            deactivate: deactivateFn,
          },
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.removed, true);
    assert.equal(deactivateFn.mock.calls.length, 1);
    assert.equal(deactivateFn.mock.calls[0].arguments[0], 'mp-1');
  });

  test('crew owner can delete any meeting point', async () => {
    const mpByOther = { ...DEFAULT_MEETING_POINT, createdBy: 'user-2' };
    const deactivateFn = mock.fn(async () => {});
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          meetingPoints: {
            getById: mock.fn(async () => mpByOther),
            deactivate: deactivateFn,
          },
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 200);
    assert.equal(res.body.data.removed, true);
    assert.equal(deactivateFn.mock.calls.length, 1);
  });

  test('broadcasts crew:meeting-point-removed via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = buildApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })),
            deactivate: mock.fn(async () => {}),
          },
        },
      },
    });

    await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(ioObj.to.mock.calls[0].arguments[0], 'crew:crew-1');
    assert.equal(ioObj._emit.mock.calls[0].arguments[0], 'crew:meeting-point-removed');
    assert.deepEqual(ioObj._emit.mock.calls[0].arguments[1], { id: 'mp-1', crewId: 'crew-1' });
  });

  test('returns 404 when meeting point does not exist', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => null),
          },
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-nonexistent');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('returns 404 when meeting point belongs to different crew', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT, crewId: 'crew-other' })),
          },
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('returns 404 when meeting point is already inactive', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT, active: false })),
          },
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('returns 403 when non-creator non-owner tries to delete', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT, createdBy: 'user-2' })),
          },
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /creator or crew owner/);
  });

  test('returns 403 when user is not a crew member', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('returns 500 on internal error', async () => {
    const { app } = buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});
