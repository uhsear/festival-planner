'use strict';
/**
 * Mock-based route tests for crews.js, profiles.js, and share.js
 *
 * Mounts each route factory on a minimal Express app with fully stubbed deps.
 * No database required — all stores are mock.fn() stubs.
 * Goal: hit uncovered branches (error paths, validation, edge cases) to
 * increase code coverage from ~12-16% toward 60%+.
 */

const assert = require('node:assert/strict');
const { describe, test, mock, beforeEach } = require('node:test');
const express = require('express');
const request = require('supertest');

// ── Shared helpers ───────────────────────────────────────────────────

function makeIo() {
  const emitFn = mock.fn(() => {});
  return {
    to: mock.fn(() => ({ emit: emitFn })),
    of: mock.fn(() => ({ to: mock.fn(() => ({ emit: emitFn })) })),
    _emit: emitFn,
  };
}

function noop() {}
const noopLog = { info: noop, warn: noop, error: noop, debug: noop };

// =====================================================================
//  CREWS ROUTE TESTS
// =====================================================================

function makeCrewDeps(overrides = {}) {
  const ioObj = makeIo();
  return {
    express,
    config: { NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://localhost:3000' },
    log: noopLog,
    userAuth: (req, _res, next) => { req.user = { userId: 'user-1', username: 'testuser' }; next(); },
    setNoStore: (_res) => {},
    sanitizeString: (s, _max) => (typeof s === 'string' ? s.trim() : ''),
    sanitizeIdentifier: (s, _max) => (typeof s === 'string' ? s.trim() : ''),
    createOpaqueId: (prefix) => `${prefix}-mock-id`,
    _getRequestIp: () => '127.0.0.1',
    getFestivalById: mock.fn(async (id) => ({ id, name: 'Test Fest', festivalId: id })),
    sendSuccess: (res, data) => res.json({ ok: true, ...data }),
    sendError: (res, status, msg, code) => res.status(status).json({ ok: false, code, message: msg }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT', NOT_FOUND: 'NOT_FOUND', FORBIDDEN: 'FORBIDDEN',
      MISSING_FIELD: 'MISSING_FIELD', INTERNAL_ERROR: 'INTERNAL_ERROR',
      ALREADY_EXISTS: 'ALREADY_EXISTS', MAX_LIMIT_REACHED: 'MAX_LIMIT_REACHED',
    },
    rateLimit: () => (_req, _res, next) => next(),
    validate: () => (req, _res, next) => { req.validatedBody = req.body; next(); },
    validateQuery: () => (req, _res, next) => { req.validatedQuery = req.query; next(); },
    validateParams: () => (req, _res, next) => { req.validatedParams = req.params; next(); },
    schemas: {
      crewCreate: {}, crewListQuery: {}, crewUpdate: {}, crewJoin: {},
      crewTransfer: {}, crewAddMember: {}, crewUserSearchQuery: {},
      crewIdParams: {}, crewIdMpIdParams: {}, crewIdPollIdParams: {},
      crewHomeBase: {}, meetingPointCreate: {}, meetingPointUpdate: {},
      pollCreate: {}, pollVote: {}, festivalIdParams: {}, profileIdParams: {},
    },
    io: ioObj,
    pool: { query: mock.fn(async () => ({ rows: [{ id: 'f1' }] })) },
    stores: {
      crews: {
        getById: mock.fn(async () => null),
        create: mock.fn(async (d) => d),
        getByInviteCode: mock.fn(async () => null),
        getExpiredByInviteCode: mock.fn(async () => null),
        listByUserAndFestival: mock.fn(async () => []),
        listByUser: mock.fn(async () => []),
        getMembers: mock.fn(async () => []),
        getMember: mock.fn(async () => null),
        getMemberCount: mock.fn(async () => 0),
        addMember: mock.fn(async () => {}),
        removeMember: mock.fn(async () => {}),
        update: mock.fn(async () => {}),
        delete: mock.fn(async () => {}),
        regenerateInviteCode: mock.fn(async () => {}),
        updateMemberRole: mock.fn(async () => {}),
        getCrewPickOverlap: mock.fn(async () => []),
        updateHomeBase: mock.fn(async (id, data) => ({ id, ...data })),
        meetingPoints: {
          listByCrew: mock.fn(async () => []),
          countByCrew: mock.fn(async () => 0),
          create: mock.fn(async (d) => d),
          getById: mock.fn(async () => null),
          update: mock.fn(async (id, d) => ({ id, ...d })),
          deactivate: mock.fn(async () => {}),
        },
      },
      festivals: {
        readAll: mock.fn(async () => [{ id: 'f1', name: 'Test Fest' }]),
      },
      profiles: {
        readByUserAndFestival: mock.fn(async () => ({ id: 'prof-1', userId: 'user-1' })),
      },
      roles: {
        hasRole: mock.fn(async () => false),
      },
      users: {
        readAll: mock.fn(async () => []),
        getById: mock.fn(async () => ({ id: 'user-1', username: 'testuser' })),
      },
      polls: {
        listByCrew: mock.fn(async () => []),
        countActiveByCrew: mock.fn(async () => 0),
        create: mock.fn(async (d) => ({ id: 'poll-1', ...d })),
        getById: mock.fn(async () => null),
        vote: mock.fn(async () => {}),
        close: mock.fn(async () => ({ closed: true })),
      },
      activity: {
        log: mock.fn(async () => {}),
      },
    },
    ...overrides,
  };
}

function buildCrewApp(overrides = {}) {
  const deps = makeCrewDeps(overrides);
  const createCrewRoutes = require('../routes/crews');
  const router = createCrewRoutes(deps);
  const app = express();
  app.use(express.json());
  app.use('/crews', router);
  return { app, deps };
}

describe('routes/crews.js', () => {
  // ── Factory ─────────────────────────────────────────────────────
  test('factory returns an express router', () => {
    const { app } = buildCrewApp();
    assert.ok(app);
  });

  // ── POST / — Create crew ────────────────────────────────────────
  describe('POST /crews — create', () => {
    test('returns 400 when name is empty', async () => {
      const { app } = buildCrewApp({
        sanitizeString: () => '',
      });
      const res = await request(app)
        .post('/crews')
        .send({ name: '', festivalId: 'f1' });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MISSING_FIELD');
    });

    test('returns 400 when festivalId is empty', async () => {
      const { app } = buildCrewApp({
        sanitizeString: (s) => s?.trim() || 'Crew Name',
        sanitizeIdentifier: () => '',
      });
      const res = await request(app)
        .post('/crews')
        .send({ name: 'Crew Name', festivalId: '' });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MISSING_FIELD');
    });

    test('returns 404 when festival not found', async () => {
      const { app } = buildCrewApp({
        sanitizeString: (s) => s,
        sanitizeIdentifier: (s) => s,
        pool: { query: mock.fn(async () => ({ rows: [] })) },
      });
      const res = await request(app)
        .post('/crews')
        .send({ name: 'Crew', festivalId: 'nonexistent' });
      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });

    test('returns 403 when user has no festival profile', async () => {
      const { app } = buildCrewApp({
        sanitizeString: (s) => s,
        sanitizeIdentifier: (s) => s,
        stores: {
          ...makeCrewDeps().stores,
          profiles: { readByUserAndFestival: mock.fn(async () => null) },
        },
      });
      const res = await request(app)
        .post('/crews')
        .send({ name: 'Crew', festivalId: 'f1' });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'FORBIDDEN');
    });

    test('returns 400 when user already has max crews for festival', async () => {
      const { app } = buildCrewApp({
        sanitizeString: (s) => s,
        sanitizeIdentifier: (s) => s,
        stores: {
          ...makeCrewDeps().stores,
          crews: {
            ...makeCrewDeps().stores.crews,
            listByUserAndFestival: mock.fn(async () => [{}, {}, {}]),
          },
        },
      });
      const res = await request(app)
        .post('/crews')
        .send({ name: 'Crew', festivalId: 'f1' });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MAX_LIMIT_REACHED');
    });

    test('returns 500 when listByUserAndFestival throws', async () => {
      const { app } = buildCrewApp({
        sanitizeString: (s) => s,
        sanitizeIdentifier: (s) => s,
        stores: {
          ...makeCrewDeps().stores,
          crews: {
            ...makeCrewDeps().stores.crews,
            listByUserAndFestival: mock.fn(async () => { throw new Error('DB error'); }),
          },
        },
      });
      const res = await request(app)
        .post('/crews')
        .send({ name: 'Crew', festivalId: 'f1' });
      assert.equal(res.status, 500);
    });

    test('returns 201 on successful crew creation', async () => {
      const crewData = {
        id: 'crew-mock-id', festivalId: 'f1', name: 'Test Crew',
        createdBy: 'user-1', maxMembers: 30, inviteCode: 'ABC123',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const memberData = [{ userId: 'user-1', username: 'testuser', role: 'owner', joinedAt: new Date().toISOString() }];

      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => crewData),
        getMembers: mock.fn(async () => memberData),
        getByInviteCode: mock.fn(async () => null),
        listByUserAndFestival: mock.fn(async () => []),
      };

      const { app } = buildCrewApp({
        sanitizeString: (s) => s,
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });

      const res = await request(app)
        .post('/crews')
        .send({ name: 'Test Crew', festivalId: 'f1' });
      assert.equal(res.status, 201);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.name, 'Test Crew');
    });

    test('returns 500 when crew creation store throws', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getByInviteCode: mock.fn(async () => null),
        listByUserAndFestival: mock.fn(async () => []),
        create: mock.fn(async () => { throw new Error('store error'); }),
      };
      const { app } = buildCrewApp({
        sanitizeString: (s) => s,
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app)
        .post('/crews')
        .send({ name: 'Crew', festivalId: 'f1' });
      assert.equal(res.status, 500);
    });

    test('returns 500 when getById returns null after creation', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getByInviteCode: mock.fn(async () => null),
        listByUserAndFestival: mock.fn(async () => []),
        create: mock.fn(async () => {}),
        addMember: mock.fn(async () => {}),
        getById: mock.fn(async () => null),
        getMembers: mock.fn(async () => []),
      };
      const { app } = buildCrewApp({
        sanitizeString: (s) => s,
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app)
        .post('/crews')
        .send({ name: 'Crew', festivalId: 'f1' });
      assert.equal(res.status, 500);
    });
  });

  // ── GET / — List crews ──────────────────────────────────────────
  describe('GET /crews — list', () => {
    test('returns crews filtered by festivalId', async () => {
      const crewData = [{ id: 'c1', festivalId: 'f1', name: 'Crew 1', role: 'owner', createdBy: 'user-1' }];
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        listByUserAndFestival: mock.fn(async () => crewData),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app)
        .get('/crews?festivalId=f1');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });

    test('returns all crews when no festivalId', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        listByUser: mock.fn(async () => []),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).get('/crews');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });

    test('returns 500 when list throws', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        listByUser: mock.fn(async () => { throw new Error('fail'); }),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).get('/crews');
      assert.equal(res.status, 500);
    });
  });

  // ── GET /:crewId — Get crew ─────────────────────────────────────
  describe('GET /crews/:crewId — detail', () => {
    test('returns 400 for invalid crew ID', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: () => '' });
      const res = await request(app).get('/crews/bad');
      assert.equal(res.status, 400);
    });

    test('returns 404 when crew not found', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: (s) => s });
      const res = await request(app).get('/crews/nonexistent');
      assert.equal(res.status, 404);
    });

    test('returns 403 when user is not a member', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', name: 'Crew' })),
        getMember: mock.fn(async () => null),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).get('/crews/c1');
      assert.equal(res.status, 403);
    });

    test('returns crew details with members when authorized', async () => {
      const crew = {
        id: 'c1', festivalId: 'f1', name: 'Crew', createdBy: 'user-1', maxMembers: 30,
        inviteCode: 'ABC123', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const members = [{ userId: 'user-1', username: 'testuser', role: 'owner', joinedAt: new Date().toISOString() }];
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => crew),
        getMember: mock.fn(async () => ({ role: 'owner', userId: 'user-1' })),
        getMembers: mock.fn(async () => members),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).get('/crews/c1');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.name, 'Crew');
      assert.ok(Array.isArray(res.body.members));
    });

    test('returns 500 on store error', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => { throw new Error('db error'); }),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).get('/crews/c1');
      assert.equal(res.status, 500);
    });
  });

  // ── PUT /:crewId — Update crew ──────────────────────────────────
  describe('PUT /crews/:crewId — update', () => {
    test('returns 400 for invalid crew ID', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: () => '' });
      const res = await request(app).put('/crews/bad').send({ name: 'New' });
      assert.equal(res.status, 400);
    });

    test('returns 404 when crew not found (resolveCrewOwnership)', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: (s) => s });
      const res = await request(app).put('/crews/c1').send({ name: 'New' });
      assert.equal(res.status, 404);
    });

    test('returns 403 when user is not owner', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', name: 'Crew' })),
        getMember: mock.fn(async () => ({ role: 'member' })),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).put('/crews/c1').send({ name: 'New' });
      assert.equal(res.status, 403);
    });

    test('updates crew name and maxMembers successfully', async () => {
      const crew = {
        id: 'c1', festivalId: 'f1', name: 'Old', maxMembers: 30,
        createdBy: 'user-1', inviteCode: 'ABC123',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const members = [{ userId: 'user-1', username: 'testuser', role: 'owner', joinedAt: new Date().toISOString() }];
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => crew),
        getMember: mock.fn(async () => ({ role: 'owner', userId: 'user-1' })),
        getMembers: mock.fn(async () => members),
        update: mock.fn(async () => {}),
      };
      const { app, deps } = buildCrewApp({
        sanitizeString: (s) => s,
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).put('/crews/c1').send({ name: 'NewName', maxMembers: 50 });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      // Verify io.to was called for broadcast
      assert.ok(deps.io.to.mock.calls.length > 0);
    });

    test('uses existing crew name/maxMembers if not in body', async () => {
      const crew = {
        id: 'c1', festivalId: 'f1', name: 'ExistingName', maxMembers: 15,
        createdBy: 'user-1', inviteCode: 'ABC123',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const members = [{ userId: 'user-1', username: 'testuser', role: 'owner', joinedAt: new Date().toISOString() }];
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => crew),
        getMember: mock.fn(async () => ({ role: 'owner', userId: 'user-1' })),
        getMembers: mock.fn(async () => members),
        update: mock.fn(async () => {}),
      };
      const { app } = buildCrewApp({
        sanitizeString: (s) => s,
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).put('/crews/c1').send({});
      assert.equal(res.status, 200);
    });
  });

  // ── DELETE /:crewId — Delete crew ───────────────────────────────
  describe('DELETE /crews/:crewId — delete', () => {
    test('returns 400 for invalid crew ID', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: () => '' });
      const res = await request(app).delete('/crews/bad');
      assert.equal(res.status, 400);
    });

    test('returns 404 when crew not found', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: (s) => s });
      const res = await request(app).delete('/crews/c1');
      assert.equal(res.status, 404);
    });

    test('returns 403 when user is not owner', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', name: 'Crew', festivalId: 'f1' })),
        getMember: mock.fn(async () => ({ role: 'member' })),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).delete('/crews/c1');
      assert.equal(res.status, 403);
    });

    test('deletes crew and broadcasts via io', async () => {
      const crew = { id: 'c1', festivalId: 'f1', name: 'Crew' };
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => crew),
        getMember: mock.fn(async () => ({ role: 'owner', userId: 'user-1' })),
        delete: mock.fn(async () => {}),
      };
      const { app, deps } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).delete('/crews/c1');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(deps.io.to.mock.calls.length > 0);
    });
  });

  // ── POST /join — Join crew via invite code ──────────────────────
  describe('POST /crews/join', () => {
    test('returns 404 for invalid invite code (no crew)', async () => {
      const { app } = buildCrewApp();
      const res = await request(app)
        .post('/crews/join')
        .send({ inviteCode: 'BADCODE' });
      assert.equal(res.status, 404);
    });

    test('returns 410 for expired invite code', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getByInviteCode: mock.fn(async () => null),
        getExpiredByInviteCode: mock.fn(async () => ({ id: 'c1', name: 'Crew' })),
      };
      const { app } = buildCrewApp({
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app)
        .post('/crews/join')
        .send({ inviteCode: 'EXPIRED' });
      assert.equal(res.status, 410);
    });

    test('returns 403 when user has no festival profile', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getByInviteCode: mock.fn(async () => ({ id: 'c1', festivalId: 'f1', maxMembers: 30 })),
      };
      const { app } = buildCrewApp({
        stores: {
          ...makeCrewDeps().stores,
          crews: crewStore,
          profiles: { readByUserAndFestival: mock.fn(async () => null) },
        },
      });
      const res = await request(app)
        .post('/crews/join')
        .send({ inviteCode: 'ABCDEF' });
      assert.equal(res.status, 403);
    });

    test('returns 400 when already a member', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getByInviteCode: mock.fn(async () => ({ id: 'c1', festivalId: 'f1', maxMembers: 30 })),
        getMember: mock.fn(async () => ({ role: 'member' })),
      };
      const { app } = buildCrewApp({
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app)
        .post('/crews/join')
        .send({ inviteCode: 'ABCDEF' });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'ALREADY_EXISTS');
    });

    test('returns 400 when max crews per festival reached', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getByInviteCode: mock.fn(async () => ({ id: 'c1', festivalId: 'f1', maxMembers: 30 })),
        getMember: mock.fn(async () => null),
        listByUserAndFestival: mock.fn(async () => [{}, {}, {}]),
      };
      const { app } = buildCrewApp({
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app)
        .post('/crews/join')
        .send({ inviteCode: 'ABCDEF' });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MAX_LIMIT_REACHED');
    });

    test('returns 400 when crew is full', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getByInviteCode: mock.fn(async () => ({ id: 'c1', festivalId: 'f1', maxMembers: 2 })),
        getMember: mock.fn(async () => null),
        listByUserAndFestival: mock.fn(async () => []),
        getMemberCount: mock.fn(async () => 2),
      };
      const { app } = buildCrewApp({
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app)
        .post('/crews/join')
        .send({ inviteCode: 'ABCDEF' });
      assert.equal(res.status, 400);
    });

    test('joins crew successfully and broadcasts', async () => {
      const crew = {
        id: 'c1', festivalId: 'f1', name: 'Crew', maxMembers: 30,
        createdBy: 'user-2', inviteCode: 'ABCDEF',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const members = [
        { userId: 'user-2', username: 'owner', role: 'owner', joinedAt: new Date().toISOString() },
        { userId: 'user-1', username: 'testuser', role: 'member', joinedAt: new Date().toISOString() },
      ];
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getByInviteCode: mock.fn(async () => crew),
        getMember: mock.fn(async () => null),
        listByUserAndFestival: mock.fn(async () => []),
        getMemberCount: mock.fn(async () => 1),
        addMember: mock.fn(async () => {}),
        getMembers: mock.fn(async () => members),
      };
      const { app, deps } = buildCrewApp({
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app)
        .post('/crews/join')
        .send({ inviteCode: 'ABCDEF' });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(deps.io.to.mock.calls.length > 0);
    });
  });

  // ── DELETE /:crewId/leave ───────────────────────────────────────
  describe('DELETE /crews/:crewId/leave', () => {
    test('returns 400 for invalid crew ID', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: () => '' });
      const res = await request(app).delete('/crews/bad/leave');
      assert.equal(res.status, 400);
    });

    test('returns 404 when crew not found', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: (s) => s });
      const res = await request(app).delete('/crews/c1/leave');
      assert.equal(res.status, 404);
    });

    test('returns 400 when not a member', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1' })),
        getMember: mock.fn(async () => null),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).delete('/crews/c1/leave');
      assert.equal(res.status, 400);
    });

    test('returns 400 when owner tries to leave', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1' })),
        getMember: mock.fn(async () => ({ role: 'owner' })),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).delete('/crews/c1/leave');
      assert.equal(res.status, 400);
    });

    test('leaves crew successfully', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1' })),
        getMember: mock.fn(async () => ({ role: 'member' })),
        removeMember: mock.fn(async () => {}),
      };
      const { app, deps } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).delete('/crews/c1/leave');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });
  });

  // ── DELETE /:crewId/members/:userId — Kick ──────────────────────
  describe('DELETE /crews/:crewId/members/:userId — kick', () => {
    test('returns 400 for invalid IDs', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: () => '' });
      const res = await request(app).delete('/crews/bad/members/bad');
      assert.equal(res.status, 400);
    });

    test('returns 404 when crew not found', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: (s) => s });
      const res = await request(app).delete('/crews/c1/members/user-2');
      assert.equal(res.status, 404);
    });

    test('returns 400 when trying to kick yourself', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1' })),
        getMember: mock.fn(async () => ({ role: 'owner', userId: 'user-1' })),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).delete('/crews/c1/members/user-1');
      assert.equal(res.status, 400);
    });

    test('returns 404 when target member not found', async () => {
      const callCount = { n: 0 };
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1' })),
        getMember: mock.fn(async (_crewId, userId) => {
          if (userId === 'user-1') return { role: 'owner', userId: 'user-1' };
          return null;
        }),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).delete('/crews/c1/members/user-2');
      assert.equal(res.status, 404);
    });

    test('kicks member successfully', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1' })),
        getMember: mock.fn(async (_crewId, userId) => {
          if (userId === 'user-1') return { role: 'owner', userId: 'user-1' };
          return { role: 'member', userId: 'user-2' };
        }),
        removeMember: mock.fn(async () => {}),
      };
      const { app, deps } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).delete('/crews/c1/members/user-2');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });
  });

  // ── PUT /:crewId/transfer — Transfer ownership ─────────────────
  describe('PUT /crews/:crewId/transfer', () => {
    test('returns 400 for invalid crew ID', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: () => '' });
      const res = await request(app).put('/crews/bad/transfer').send({ userId: 'user-2' });
      assert.equal(res.status, 400);
    });

    test('returns 400 when target user ID is empty', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', name: 'Crew' })),
        getMember: mock.fn(async () => ({ role: 'owner', userId: 'user-1' })),
      };
      // Return empty string for the userId in body but valid for crewId
      let callCount = 0;
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => {
          callCount++;
          // First call is crewId, second call is userId from body
          return callCount <= 1 ? s : '';
        },
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).put('/crews/c1/transfer').send({ userId: '' });
      assert.equal(res.status, 400);
    });

    test('returns 400 when transferring to yourself', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', name: 'Crew' })),
        getMember: mock.fn(async () => ({ role: 'owner', userId: 'user-1' })),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).put('/crews/c1/transfer').send({ userId: 'user-1' });
      assert.equal(res.status, 400);
    });

    test('returns 404 when target is not a crew member', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', name: 'Crew' })),
        getMember: mock.fn(async (_crewId, userId) => {
          if (userId === 'user-1') return { role: 'owner', userId: 'user-1' };
          return null;
        }),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).put('/crews/c1/transfer').send({ userId: 'user-2' });
      assert.equal(res.status, 404);
    });

    test('transfers ownership successfully', async () => {
      const crew = {
        id: 'c1', festivalId: 'f1', name: 'Crew', maxMembers: 30,
        createdBy: 'user-1', inviteCode: 'ABC123',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const members = [
        { userId: 'user-1', username: 'testuser', role: 'member', joinedAt: new Date().toISOString() },
        { userId: 'user-2', username: 'newowner', role: 'owner', joinedAt: new Date().toISOString() },
      ];
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => crew),
        getMember: mock.fn(async (_crewId, userId) => {
          if (userId === 'user-1') return { role: 'owner', userId: 'user-1' };
          return { role: 'member', userId: 'user-2' };
        }),
        updateMemberRole: mock.fn(async () => {}),
        getMembers: mock.fn(async () => members),
      };
      const { app, deps } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).put('/crews/c1/transfer').send({ userId: 'user-2' });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });
  });

  // ── POST /:crewId/invite — Regenerate invite code ──────────────
  describe('POST /crews/:crewId/invite', () => {
    test('returns 400 for invalid crew ID', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: () => '' });
      const res = await request(app).post('/crews/bad/invite');
      assert.equal(res.status, 400);
    });

    test('regenerates invite code for owner', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', name: 'Crew' })),
        getMember: mock.fn(async () => ({ role: 'owner', userId: 'user-1' })),
        getByInviteCode: mock.fn(async () => null),
        regenerateInviteCode: mock.fn(async () => {}),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).post('/crews/c1/invite');
      assert.equal(res.status, 200);
      assert.ok(res.body.inviteCode);
    });
  });

  // ── GET /:crewId/overlap — Pick overlap ─────────────────────────
  describe('GET /crews/:crewId/overlap', () => {
    test('returns 400 for invalid crew ID', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: () => '' });
      const res = await request(app).get('/crews/bad/overlap');
      assert.equal(res.status, 400);
    });

    test('returns 404 when crew not found', async () => {
      const { app } = buildCrewApp({ sanitizeIdentifier: (s) => s });
      const res = await request(app).get('/crews/c1/overlap');
      assert.equal(res.status, 404);
    });

    test('returns 403 when not a member', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', festivalId: 'f1' })),
        getMember: mock.fn(async () => null),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).get('/crews/c1/overlap');
      assert.equal(res.status, 403);
    });

    test('returns overlap data with parsed picks', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', festivalId: 'f1' })),
        getMember: mock.fn(async () => ({ role: 'member' })),
        getCrewPickOverlap: mock.fn(async () => [
          { userId: 'user-1', username: 'testuser', picksJson: '{"set-a":"must","set-b":"maybe"}' },
          { userId: 'user-2', username: 'other', picksJson: '{"set-a":"want-to-see"}' },
        ]),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).get('/crews/c1/overlap');
      assert.equal(res.status, 200);
      assert.ok(res.body.overlap);
      assert.equal(res.body.overlap['set-a'].length, 2);
      assert.equal(res.body.overlap['set-b'].length, 1);
    });

    test('handles invalid JSON in picksJson gracefully', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', festivalId: 'f1' })),
        getMember: mock.fn(async () => ({ role: 'member' })),
        getCrewPickOverlap: mock.fn(async () => [
          { userId: 'user-1', username: 'testuser', picksJson: 'not-json' },
        ]),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).get('/crews/c1/overlap');
      assert.equal(res.status, 200);
      assert.deepStrictEqual(res.body.overlap, {});
    });

    test('skips __proto__ keys in picks (prototype pollution guard)', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', festivalId: 'f1' })),
        getMember: mock.fn(async () => ({ role: 'member' })),
        getCrewPickOverlap: mock.fn(async () => [
          { userId: 'user-1', username: 'testuser', picksJson: '{"__proto__":"must","set-a":"want-to-see"}' },
        ]),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).get('/crews/c1/overlap');
      assert.equal(res.status, 200);
      // __proto__ should be skipped, only set-a should appear
      assert.ok(res.body.overlap['set-a']);
      // The overlap object won't have __proto__ as an own property with array value
      const protoVal = res.body.overlap['__proto__'];
      assert.ok(!Array.isArray(protoVal) || protoVal.length === 0);
    });

    test('handles null picksJson', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', festivalId: 'f1' })),
        getMember: mock.fn(async () => ({ role: 'member' })),
        getCrewPickOverlap: mock.fn(async () => [
          { userId: 'user-1', username: 'testuser', picksJson: null },
        ]),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).get('/crews/c1/overlap');
      assert.equal(res.status, 200);
      assert.deepStrictEqual(res.body.overlap, {});
    });
  });

  // ── GET /join/:inviteCode — Public invite page (no auth) ────────
  describe('GET /crews/join/:inviteCode — public invite page', () => {
    test('returns error page for invalid invite code format', async () => {
      const { app } = buildCrewApp();
      const res = await request(app).get('/crews/join/ab'); // too short
      assert.equal(res.status, 200); // sends HTML, not a JSON error
      assert.ok(res.text.includes('Invalid or expired'));
    });

    test('returns error page for special-char invite code', async () => {
      const { app } = buildCrewApp();
      const res = await request(app).get('/crews/join/ABC$DEF!');
      assert.equal(res.status, 200);
      assert.ok(res.text.includes('Invalid or expired'));
    });

    test('returns error page when crew not found by invite code', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getByInviteCode: mock.fn(async () => null),
      };
      const { app } = buildCrewApp({
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).get('/crews/join/VALIDC');
      assert.equal(res.status, 200);
      assert.ok(res.text.includes('Invalid or expired'));
    });

    test('returns join page when crew found', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getByInviteCode: mock.fn(async () => ({ id: 'c1', name: 'Cool Crew', festivalId: 'f1' })),
      };
      const { app } = buildCrewApp({
        stores: { ...makeCrewDeps().stores, crews: crewStore },
      });
      const res = await request(app).get('/crews/join/VALIDC');
      assert.equal(res.status, 200);
      assert.ok(res.text.includes('Cool Crew'));
      assert.ok(res.text.includes('Join Crew'));
    });
  });

  // ── GET /search-users — Admin user search ───────────────────────
  describe('GET /crews/search-users', () => {
    test('returns 403 for non-admin', async () => {
      const { app } = buildCrewApp();
      const res = await request(app).get('/crews/search-users?q=test');
      assert.equal(res.status, 403);
    });

    test('returns empty array for short query', async () => {
      const { app } = buildCrewApp({
        stores: {
          ...makeCrewDeps().stores,
          roles: { hasRole: mock.fn(async () => true) },
        },
      });
      const res = await request(app).get('/crews/search-users?q=');
      assert.equal(res.status, 200);
    });

    test('returns matching users for admin', async () => {
      const { app } = buildCrewApp({
        pool: {
          query: mock.fn(async () => ({
            rows: [
              { id: 'u1', username: 'testuser' },
            ],
          })),
        },
        stores: {
          ...makeCrewDeps().stores,
          roles: { hasRole: mock.fn(async () => true) },
        },
      });
      const res = await request(app).get('/crews/search-users?q=test');
      assert.equal(res.status, 200);
    });
  });

  // ── POST /:crewId/members — Admin add member ───────────────────
  describe('POST /crews/:crewId/members — admin add', () => {
    test('returns 403 for non-admin', async () => {
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
      });
      const res = await request(app)
        .post('/crews/c1/members')
        .send({ userId: 'user-2' });
      assert.equal(res.status, 403);
    });

    test('returns 404 when crew not found', async () => {
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: {
          ...makeCrewDeps().stores,
          roles: { hasRole: mock.fn(async () => true) },
        },
      });
      const res = await request(app)
        .post('/crews/c1/members')
        .send({ userId: 'user-2' });
      assert.equal(res.status, 404);
    });

    test('returns 404 when target user not found', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', maxMembers: 30 })),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: {
          ...makeCrewDeps().stores,
          crews: crewStore,
          roles: { hasRole: mock.fn(async () => true) },
          users: { ...makeCrewDeps().stores.users, getById: mock.fn(async () => null) },
        },
      });
      const res = await request(app)
        .post('/crews/c1/members')
        .send({ userId: 'user-2' });
      assert.equal(res.status, 404);
    });

    test('returns 400 when user already a member', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', maxMembers: 30 })),
        getMember: mock.fn(async () => ({ role: 'member' })),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: {
          ...makeCrewDeps().stores,
          crews: crewStore,
          roles: { hasRole: mock.fn(async () => true) },
        },
      });
      const res = await request(app)
        .post('/crews/c1/members')
        .send({ userId: 'user-2' });
      assert.equal(res.status, 400);
    });

    test('returns 400 when crew is full', async () => {
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => ({ id: 'c1', maxMembers: 2 })),
        getMember: mock.fn(async () => null),
        getMemberCount: mock.fn(async () => 2),
      };
      const { app } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: {
          ...makeCrewDeps().stores,
          crews: crewStore,
          roles: { hasRole: mock.fn(async () => true) },
        },
      });
      const res = await request(app)
        .post('/crews/c1/members')
        .send({ userId: 'user-2' });
      assert.equal(res.status, 400);
    });

    test('adds member successfully as admin', async () => {
      const crew = {
        id: 'c1', festivalId: 'f1', name: 'Crew', maxMembers: 30,
        createdBy: 'user-1', inviteCode: 'ABC123',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const members = [
        { userId: 'user-1', username: 'testuser', role: 'owner', joinedAt: new Date().toISOString() },
        { userId: 'user-2', username: 'newmember', role: 'member', joinedAt: new Date().toISOString() },
      ];
      const crewStore = {
        ...makeCrewDeps().stores.crews,
        getById: mock.fn(async () => crew),
        getMember: mock.fn(async () => null),
        getMemberCount: mock.fn(async () => 1),
        addMember: mock.fn(async () => {}),
        getMembers: mock.fn(async () => members),
      };
      const { app, deps } = buildCrewApp({
        sanitizeIdentifier: (s) => s,
        stores: {
          ...makeCrewDeps().stores,
          crews: crewStore,
          roles: { hasRole: mock.fn(async () => true) },
        },
      });
      const res = await request(app)
        .post('/crews/c1/members')
        .send({ userId: 'user-2' });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });
  });
});


// =====================================================================
//  PROFILES ROUTE TESTS
// =====================================================================

function makeProfileDeps(overrides = {}) {
  const ioObj = makeIo();
  return {
    express,
    config: {
      NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://localhost:3000',
      MAX_PROFILES_PER_FESTIVAL: 500,
    },
    log: noopLog,
    userAuth: (req, _res, next) => { req.user = { userId: 'user-1', username: 'testuser' }; next(); },
    adminAuth: (req, _res, next) => { req.user = { userId: 'admin-1', username: 'admin' }; next(); },
    setNoStore: (_res) => {},
    sanitizeIdentifier: (s, _max) => (typeof s === 'string' ? s.trim() : ''),
    getFestivalById: mock.fn(async (id) => ({
      id, name: 'Test Fest',
      stages: [{ id: 'stg-1', name: 'Main' }],
      days: [{ label: 'Friday', sets: [{ id: 'set-a' }, { id: 'set-b' }] }],
    })),
    getUserFestivalProfile: mock.fn(async () => null),
    getProfiles: mock.fn(async () => []),
    getUserMap: mock.fn(async () => new Map()),
    getUserById: mock.fn(async (id) => ({ id, username: 'testuser', avatarKey: null })),
    normalizePickPayload: mock.fn((picks) => ({ value: picks })),
    normalizeNotePayload: mock.fn((notes) => ({ value: notes })),
    normalizeReminderPayload: mock.fn((reminders) => ({ value: reminders })),
    serializeProfileForViewer: mock.fn((profile) => profile),
    serializeOwnProfile: mock.fn((profile, user) => ({ ...profile, username: user?.username })),
    _buildAvatarUrl: () => '',
    createOpaqueId: (prefix) => `${prefix}-mock-id`,
    sendSuccess: (res, data, extra) => res.json({ ok: true, ...data, ...(extra || {}) }),
    sendError: (res, status, msg, code, extra) => res.status(status).json({ ok: false, code, message: msg, ...(extra || {}) }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT', NOT_FOUND: 'NOT_FOUND', FORBIDDEN: 'FORBIDDEN',
      MISSING_FIELD: 'MISSING_FIELD', INTERNAL_ERROR: 'INTERNAL_ERROR',
      MAX_LIMIT_REACHED: 'MAX_LIMIT_REACHED', VERSION_MISMATCH: 'VERSION_MISMATCH',
    },
    rateLimit: () => (_req, _res, next) => next(),
    validate: () => (req, _res, next) => { req.validatedBody = req.body; next(); },
    validateParams: () => (req, _res, next) => { req.validatedParams = req.params; next(); },
    validateQuery: () => (req, _res, next) => { req.validatedQuery = req.query; next(); },
    schemas: {
      festivalIdParams: {}, profileIdParams: {}, joinFestival: {}, profileUpdate: {},
      paginationQuery: {},
    },
    io: ioObj,
    emitter: {
      profileCreated: mock.fn(() => {}),
      profileUpdated: mock.fn(() => {}),
      profileDeleted: mock.fn(() => {}),
    },
    removeProfileSockets: mock.fn(() => {}),
    stores: {
      profiles: {
        getByFestival: mock.fn(async () => []),
        getById: mock.fn(async () => null),
        create: mock.fn(async (d) => ({ ...d, updatedAt: new Date().toISOString() })),
        update: mock.fn(async (id, fields) => ({ id, ...fields, updatedAt: new Date().toISOString(), userId: 'user-1', festivalId: 'f1' })),
        delete: mock.fn(async () => null),
        claimOrphan: mock.fn(async () => null),
        countByFestival: mock.fn(async () => 0),
        readByUserAndFestival: mock.fn(async () => null),
      },
      users: {
        getByIds: mock.fn(async () => new Map()),
      },
    },
    ...overrides,
  };
}

function buildProfileApp(overrides = {}) {
  const deps = makeProfileDeps(overrides);
  const createProfilesRoutes = require('../routes/profiles');
  const router = createProfilesRoutes(deps);
  const app = express();
  app.use(express.json());
  app.use('/profiles', router);
  return { app, deps };
}

describe('routes/profiles.js', () => {
  // ── Factory ─────────────────────────────────────────────────────
  test('factory returns an express router', () => {
    const { app } = buildProfileApp();
    assert.ok(app);
  });

  // ── GET /:festivalId — List profiles ────────────────────────────
  describe('GET /profiles/:festivalId', () => {
    test('returns 404 when festival not found', async () => {
      const { app } = buildProfileApp({
        getFestivalById: mock.fn(async () => null),
      });
      const res = await request(app).get('/profiles/f1');
      assert.equal(res.status, 404);
    });

    test('returns 403 when user has no profile for the festival', async () => {
      const { app } = buildProfileApp({
        getUserFestivalProfile: mock.fn(async () => null),
      });
      const res = await request(app).get('/profiles/f1');
      assert.equal(res.status, 403);
    });

    test('returns profiles successfully', async () => {
      const profiles = [
        { id: 'p1', userId: 'user-1', festivalId: 'f1' },
        { id: 'p2', userId: 'user-2', festivalId: 'f1' },
      ];
      const { app } = buildProfileApp({
        getUserFestivalProfile: mock.fn(async () => ({ id: 'p1' })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getByFestival: mock.fn(async () => profiles),
          },
          users: {
            getByIds: mock.fn(async () => new Map([
              ['user-1', { id: 'user-1', username: 'a' }],
              ['user-2', { id: 'user-2', username: 'b' }],
            ])),
          },
        },
      });
      const res = await request(app).get('/profiles/f1');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });

    test('supports paginated response with cursor param', async () => {
      const profiles = [
        { id: 'p1', userId: 'user-1', festivalId: 'f1', createdAt: '2026-01-01' },
      ];
      const { app } = buildProfileApp({
        getUserFestivalProfile: mock.fn(async () => ({ id: 'p1' })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getByFestival: mock.fn(async () => profiles),
          },
          users: { getByIds: mock.fn(async () => new Map([['user-1', { id: 'user-1', username: 'a' }]])) },
        },
      });
      const res = await request(app).get('/profiles/f1?limit=10');
      assert.equal(res.status, 200);
    });

    test('falls back to getProfiles when getByFestival missing', async () => {
      const profiles = [
        { id: 'p1', userId: 'user-1', festivalId: 'f1' },
        { id: 'p2', userId: 'user-2', festivalId: 'other' },
      ];
      const { app } = buildProfileApp({
        getUserFestivalProfile: mock.fn(async () => ({ id: 'p1' })),
        getProfiles: mock.fn(async () => profiles),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getByFestival: undefined,
          },
          users: {
            getByIds: undefined,
          },
        },
        getUserMap: mock.fn(async () => new Map([
          ['user-1', { id: 'user-1', username: 'a' }],
        ])),
      });
      const res = await request(app).get('/profiles/f1');
      assert.equal(res.status, 200);
    });
  });

  // ── POST / — Join festival ──────────────────────────────────────
  describe('POST /profiles — join festival', () => {
    test('returns 400 when festivalId is empty', async () => {
      const { app } = buildProfileApp({
        sanitizeIdentifier: () => '',
      });
      const res = await request(app)
        .post('/profiles')
        .send({ festivalId: '' });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MISSING_FIELD');
    });

    test('returns 404 when festival not found', async () => {
      const { app } = buildProfileApp({
        sanitizeIdentifier: (s) => s,
        getFestivalById: mock.fn(async () => null),
      });
      const res = await request(app)
        .post('/profiles')
        .send({ festivalId: 'nonexistent' });
      assert.equal(res.status, 404);
    });

    test('returns existing profile if user already joined', async () => {
      const existingProfile = { id: 'p1', userId: 'user-1', festivalId: 'f1' };
      const { app } = buildProfileApp({
        sanitizeIdentifier: (s) => s,
        getUserFestivalProfile: mock.fn(async () => existingProfile),
      });
      const res = await request(app)
        .post('/profiles')
        .send({ festivalId: 'f1' });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });

    test('returns 404 when user not found after existing profile', async () => {
      const existingProfile = { id: 'p1', userId: 'user-1', festivalId: 'f1' };
      const { app } = buildProfileApp({
        sanitizeIdentifier: (s) => s,
        getUserFestivalProfile: mock.fn(async () => existingProfile),
        getUserById: mock.fn(async () => null),
      });
      const res = await request(app)
        .post('/profiles')
        .send({ festivalId: 'f1' });
      assert.equal(res.status, 404);
    });

    test('claims orphan profile if available', async () => {
      const orphan = { id: 'p-orphan', userId: 'user-1', festivalId: 'f1' };
      const { app } = buildProfileApp({
        sanitizeIdentifier: (s) => s,
        getUserFestivalProfile: mock.fn(async () => null),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            claimOrphan: mock.fn(async () => orphan),
          },
        },
      });
      const res = await request(app)
        .post('/profiles')
        .send({ festivalId: 'f1' });
      assert.equal(res.status, 200);
    });

    test('returns 400 when max profiles reached', async () => {
      const { app } = buildProfileApp({
        sanitizeIdentifier: (s) => s,
        getUserFestivalProfile: mock.fn(async () => null),
        config: { NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://localhost:3000', MAX_PROFILES_PER_FESTIVAL: 1 },
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            countByFestival: mock.fn(async () => 1),
          },
        },
      });
      const res = await request(app)
        .post('/profiles')
        .send({ festivalId: 'f1' });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MAX_LIMIT_REACHED');
    });

    test('creates new profile successfully', async () => {
      const { app, deps } = buildProfileApp({
        sanitizeIdentifier: (s) => s,
        getUserFestivalProfile: mock.fn(async () => null),
      });
      const res = await request(app)
        .post('/profiles')
        .send({ festivalId: 'f1' });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(deps.emitter.profileCreated.mock.calls.length > 0);
    });

    test('returns 500 on creation error', async () => {
      const { app } = buildProfileApp({
        sanitizeIdentifier: (s) => s,
        getUserFestivalProfile: mock.fn(async () => null),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            create: mock.fn(async () => { throw new Error('db fail'); }),
          },
        },
      });
      const res = await request(app)
        .post('/profiles')
        .send({ festivalId: 'f1' });
      assert.equal(res.status, 500);
    });
  });

  // ── PUT /:id — Update profile ───────────────────────────────────
  describe('PUT /profiles/:id — update', () => {
    test('returns 404 when profile not found', async () => {
      const { app } = buildProfileApp();
      const res = await request(app)
        .put('/profiles/p1')
        .send({ picks: {} });
      assert.equal(res.status, 404);
    });

    test('returns 403 when profile belongs to another user', async () => {
      const { app } = buildProfileApp({
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'other-user', festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ picks: {} });
      assert.equal(res.status, 403);
    });

    test('returns 400 when normalizePickPayload returns error', async () => {
      const { app } = buildProfileApp({
        normalizePickPayload: mock.fn(() => ({ error: 'Bad pick format' })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ picks: 'invalid' });
      assert.equal(res.status, 400);
    });

    test('returns 400 when normalizeNotePayload returns error', async () => {
      const { app } = buildProfileApp({
        normalizeNotePayload: mock.fn(() => ({ error: 'Bad notes' })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ notes: 'bad' });
      assert.equal(res.status, 400);
    });

    test('returns 400 when normalizeReminderPayload returns error', async () => {
      const { app } = buildProfileApp({
        normalizeReminderPayload: mock.fn(() => ({ error: 'Bad reminders' })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ reminders: 'bad' });
      assert.equal(res.status, 400);
    });

    test('returns 400 when picks reference unknown set', async () => {
      const { app } = buildProfileApp({
        normalizePickPayload: mock.fn((p) => ({ value: p })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ picks: { 'unknown-set': 'must' } });
      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes('unknown set'));
    });

    test('returns 400 when notes reference unknown set', async () => {
      const { app } = buildProfileApp({
        normalizeNotePayload: mock.fn((n) => ({ value: n })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ notes: { 'unknown-set': 'note text' } });
      assert.equal(res.status, 400);
    });

    test('returns 400 when reminders reference unknown set', async () => {
      const { app } = buildProfileApp({
        normalizeReminderPayload: mock.fn((r) => ({ value: r })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ reminders: { 'unknown-set': 5 } });
      assert.equal(res.status, 400);
    });

    test('returns 409 on version mismatch (If-Match)', async () => {
      const { app } = buildProfileApp({
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({
              id: 'p1', userId: 'user-1', festivalId: 'f1',
              updatedAt: '2026-01-01T00:00:00Z',
            })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .set('If-Match', '"2025-12-31T00:00:00Z"')
        .send({ picks: {} });
      assert.equal(res.status, 409);
    });

    test('updates profile successfully with picks', async () => {
      const { app, deps } = buildProfileApp({
        normalizePickPayload: mock.fn((p) => ({ value: p })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
            update: mock.fn(async (id, fields) => ({
              id, ...fields, userId: 'user-1', festivalId: 'f1',
              updatedAt: '2026-01-02T00:00:00Z',
            })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ picks: { 'set-a': 'must' } });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      // Check ETag is set
      assert.ok(res.headers.etag);
      assert.ok(deps.emitter.profileUpdated.mock.calls.length > 0);
    });

    test('returns 500 when update returns null', async () => {
      const { app } = buildProfileApp({
        normalizePickPayload: mock.fn((p) => ({ value: p })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
            update: mock.fn(async () => null),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ picks: { 'set-a': 'must' } });
      assert.equal(res.status, 500);
    });

    test('returns 400 when notes exceed 200 count', async () => {
      const bigNotes = {};
      for (let i = 0; i <= 200; i++) bigNotes[`set-${i}`] = 'note';
      const { app } = buildProfileApp({
        normalizeNotePayload: mock.fn(() => ({ value: bigNotes })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ notes: bigNotes });
      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes('200'));
    });

    test('returns 400 when a note exceeds 1000 chars', async () => {
      const longNote = { 'set-a': 'x'.repeat(1001) };
      const { app } = buildProfileApp({
        normalizeNotePayload: mock.fn(() => ({ value: longNote })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ notes: longNote });
      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes('1000'));
    });

    test('returns 400 when reminders exceed 200 count', async () => {
      const bigReminders = {};
      for (let i = 0; i <= 200; i++) bigReminders[`set-${i}`] = 5;
      const { app } = buildProfileApp({
        normalizeReminderPayload: mock.fn(() => ({ value: bigReminders })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ reminders: bigReminders });
      assert.equal(res.status, 400);
    });

    test('returns 400 when reminder value is not a positive integer', async () => {
      const { app } = buildProfileApp({
        normalizeReminderPayload: mock.fn(() => ({ value: { 'set-a': -1 } })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app)
        .put('/profiles/p1')
        .send({ reminders: { 'set-a': -1 } });
      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes('positive integer'));
    });
  });

  // ── PATCH /:id — Same handler as PUT ────────────────────────────
  describe('PATCH /profiles/:id — update (same handler)', () => {
    test('PATCH updates profile same as PUT', async () => {
      const { app } = buildProfileApp({
        normalizePickPayload: mock.fn((p) => ({ value: p })),
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'user-1', festivalId: 'f1' })),
            update: mock.fn(async (id, fields) => ({
              id, ...fields, userId: 'user-1', festivalId: 'f1',
              updatedAt: '2026-01-02T00:00:00Z',
            })),
          },
        },
      });
      const res = await request(app)
        .patch('/profiles/p1')
        .send({ picks: { 'set-a': 'must' } });
      assert.equal(res.status, 200);
    });
  });

  // ── DELETE /:id — Admin delete ──────────────────────────────────
  describe('DELETE /profiles/:id — admin delete', () => {
    test('returns 404 when profile not found', async () => {
      const { app } = buildProfileApp();
      const res = await request(app).delete('/profiles/p1');
      assert.equal(res.status, 404);
    });

    test('deletes profile and broadcasts', async () => {
      const deletedProfile = { id: 'p1', userId: 'user-1', festivalId: 'f1' };
      const { app, deps } = buildProfileApp({
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            delete: mock.fn(async () => deletedProfile),
          },
        },
      });
      const res = await request(app).delete('/profiles/p1');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(deps.removeProfileSockets.mock.calls.length > 0);
      assert.ok(deps.emitter.profileDeleted.mock.calls.length > 0);
    });

    test('returns 500 on store error', async () => {
      const { app } = buildProfileApp({
        stores: {
          ...makeProfileDeps().stores,
          profiles: {
            ...makeProfileDeps().stores.profiles,
            delete: mock.fn(async () => { throw new Error('db fail'); }),
          },
        },
      });
      const res = await request(app).delete('/profiles/p1');
      assert.equal(res.status, 500);
    });
  });
});


// =====================================================================
//  SHARE ROUTE TESTS
// =====================================================================

function makeShareDeps(overrides = {}) {
  return {
    express,
    config: { NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://localhost:3000' },
    log: noopLog,
    stores: {
      users: {
        readAll: mock.fn(async () => []),
        getByUsername: mock.fn(async () => null),
      },
      profiles: {
        readAll: mock.fn(async () => []),
        getById: mock.fn(async () => null),
      },
      pool: { query: mock.fn(async () => ({ rows: [] })) },
    },
    getFestivalById: mock.fn(async (id) => ({
      id, name: 'Test Fest', location: 'Somewhere',
      stages: [{ id: 'stg-1', name: 'Main', color: '#ff3366' }],
      days: [{
        label: 'Friday', date: '2026-06-05',
        sets: [{ id: 'set-a', artist: 'Alpha', stageId: 'stg-1', startTime: '10:00', endTime: '11:00' }],
      }],
    })),
    getUserById: mock.fn(async (id) => ({ id, username: 'testuser' })),
    buildAvatarUrl: mock.fn(() => ''),
    rateLimit: () => (_req, _res, next) => next(),
    sendSuccess: (res, data) => res.json({ ok: true, ...data }),
    sendError: (res, status, msg, code) => res.status(status).json({ ok: false, code, message: msg }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT', NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    ...overrides,
  };
}

function buildShareApp(overrides = {}) {
  const deps = makeShareDeps(overrides);
  const createShareRoutes = require('../routes/share');
  const router = createShareRoutes(deps);
  const app = express();
  app.use(express.json());
  app.use('/s', router);
  return { app, deps };
}

describe('routes/share.js', () => {
  // ── Factory ─────────────────────────────────────────────────────
  test('factory returns an express router', () => {
    const { app } = buildShareApp();
    assert.ok(app);
  });

  // ── GET /u/:username — Vanity URL ──────────────────────────────
  describe('GET /s/u/:username — vanity URL', () => {
    test('returns error for invalid username format', async () => {
      const { app } = buildShareApp();
      const res = await request(app).get('/s/u/INVALID!!!');
      assert.equal(res.status, 400);
      assert.ok(res.text.includes('Invalid Link'));
    });

    test('returns error for too-long username', async () => {
      const { app } = buildShareApp();
      const res = await request(app).get('/s/u/' + 'a'.repeat(31));
      assert.equal(res.status, 400);
    });

    test('returns 404 for unknown username', async () => {
      const { app } = buildShareApp({
        stores: {
          ...makeShareDeps().stores,
          users: { getByUsername: mock.fn(async () => null) },
        },
      });
      const res = await request(app).get('/s/u/unknown');
      assert.equal(res.status, 404);
      assert.ok(res.text.includes('User Not Found'));
    });

    test('returns 404 when user has no profiles', async () => {
      const { app } = buildShareApp({
        stores: {
          ...makeShareDeps().stores,
          users: { getByUsername: mock.fn(async () => ({ id: 'u1', username: 'testuser' })) },
          pool: { query: mock.fn(async () => ({ rows: [] })) },
        },
      });
      const res = await request(app).get('/s/u/testuser');
      assert.equal(res.status, 404);
      assert.ok(res.text.includes('No Schedule Yet'));
    });

    test('redirects to most recent profile', async () => {
      const { app } = buildShareApp({
        stores: {
          ...makeShareDeps().stores,
          users: { getByUsername: mock.fn(async () => ({ id: 'u1', username: 'testuser' })) },
          pool: { query: mock.fn(async () => ({ rows: [{ id: 'p-new' }] })) },
        },
      });
      const res = await request(app).get('/s/u/testuser');
      assert.equal(res.status, 302);
      assert.ok(res.headers.location.includes('/s/p-new'));
    });

    test('returns 500 on internal error', async () => {
      const { app } = buildShareApp({
        stores: {
          ...makeShareDeps().stores,
          users: { getByUsername: mock.fn(async () => { throw new Error('db fail'); }) },
        },
      });
      const res = await request(app).get('/s/u/testuser');
      assert.equal(res.status, 500);
    });
  });

  // ── GET /:profileId — Share page ────────────────────────────────
  describe('GET /s/:profileId — share page', () => {
    test('returns error for invalid profileId format', async () => {
      const { app } = buildShareApp();
      const res = await request(app).get('/s/bad$id!');
      assert.equal(res.status, 400);
      assert.ok(res.text.includes('Invalid Link'));
    });

    test('returns error for too-long profileId', async () => {
      const { app } = buildShareApp();
      const res = await request(app).get('/s/' + 'a'.repeat(101));
      assert.equal(res.status, 400);
    });

    test('returns 404 when profile not found', async () => {
      const { app } = buildShareApp();
      const res = await request(app).get('/s/unknown123');
      assert.equal(res.status, 404);
      assert.ok(res.text.includes('Schedule Not Found'));
    });

    test('returns 404 when profile has no userId', async () => {
      const { app } = buildShareApp({
        stores: {
          ...makeShareDeps().stores,
          profiles: {
            ...makeShareDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: null, festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app).get('/s/p1');
      assert.equal(res.status, 404);
    });

    test('returns 404 when festival not found', async () => {
      const { app } = buildShareApp({
        stores: {
          ...makeShareDeps().stores,
          profiles: {
            ...makeShareDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'u1', festivalId: 'f1', picks: {} })),
          },
        },
        getFestivalById: mock.fn(async () => null),
      });
      const res = await request(app).get('/s/p1');
      assert.equal(res.status, 404);
      assert.ok(res.text.includes('Festival Not Found'));
    });

    test('renders share page with picks grouped by day', async () => {
      const { app } = buildShareApp({
        stores: {
          ...makeShareDeps().stores,
          profiles: {
            ...makeShareDeps().stores.profiles,
            getById: mock.fn(async () => ({
              id: 'p1', userId: 'u1', festivalId: 'f1',
              picks: { 'set-a': 'must' },
            })),
          },
        },
      });
      const res = await request(app).get('/s/p1');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.ok(res.text.includes('testuser'));
      assert.ok(res.text.includes('Test Fest'));
      assert.ok(res.text.includes('Alpha')); // artist name
      assert.ok(res.text.includes('Must See'));
    });

    test('renders share page with no picks', async () => {
      const { app } = buildShareApp({
        stores: {
          ...makeShareDeps().stores,
          profiles: {
            ...makeShareDeps().stores.profiles,
            getById: mock.fn(async () => ({
              id: 'p1', userId: 'u1', festivalId: 'f1',
              picks: {},
            })),
          },
        },
      });
      const res = await request(app).get('/s/p1');
      assert.equal(res.status, 200);
      assert.ok(res.text.includes('No picks saved yet'));
    });

    test('uses profile.name as fallback when user not found', async () => {
      const { app } = buildShareApp({
        getUserById: mock.fn(async () => null),
        stores: {
          ...makeShareDeps().stores,
          profiles: {
            ...makeShareDeps().stores.profiles,
            getById: mock.fn(async () => ({
              id: 'p1', userId: 'u1', festivalId: 'f1',
              picks: {}, name: 'ProfileName',
            })),
          },
        },
      });
      const res = await request(app).get('/s/p1');
      assert.equal(res.status, 200);
      assert.ok(res.text.includes('ProfileName'));
    });

    test('renders all priority types correctly', async () => {
      const { app } = buildShareApp({
        getFestivalById: mock.fn(async () => ({
          id: 'f1', name: 'Fest', location: 'Loc',
          stages: [{ id: 's1', name: 'Main', color: '#ff3366' }],
          days: [{
            label: 'Friday', date: '2026-06-05',
            sets: [
              { id: 'set-1', artist: 'A', stageId: 's1', startTime: '10:00', endTime: '11:00' },
              { id: 'set-2', artist: 'B', stageId: 's1', startTime: '12:00', endTime: '13:00' },
              { id: 'set-3', artist: 'C', stageId: 's1', startTime: '14:00', endTime: '15:00' },
            ],
          }],
        })),
        stores: {
          ...makeShareDeps().stores,
          profiles: {
            ...makeShareDeps().stores.profiles,
            getById: mock.fn(async () => ({
              id: 'p1', userId: 'u1', festivalId: 'f1',
              picks: { 'set-1': 'must', 'set-2': 'want-to-see', 'set-3': 'maybe' },
            })),
          },
        },
      });
      const res = await request(app).get('/s/p1');
      assert.equal(res.status, 200);
      assert.ok(res.text.includes('Must See'));
      assert.ok(res.text.includes('Want to See'));
      assert.ok(res.text.includes('Maybe'));
    });

    test('returns 500 on internal error', async () => {
      const { app } = buildShareApp({
        stores: {
          ...makeShareDeps().stores,
          profiles: {
            ...makeShareDeps().stores.profiles,
            getById: mock.fn(async () => { throw new Error('db fail'); }),
          },
        },
      });
      const res = await request(app).get('/s/p1');
      assert.equal(res.status, 500);
    });
  });

  // ── GET /:profileId/json — JSON mirror ─────────────────────────
  describe('GET /s/:profileId/json — JSON API', () => {
    test('returns 400 for invalid profileId', async () => {
      const { app } = buildShareApp();
      const res = await request(app).get('/s/bad$id!/json');
      assert.equal(res.status, 400);
    });

    test('returns 404 when profile not found', async () => {
      const { app } = buildShareApp();
      const res = await request(app).get('/s/unknown123/json');
      assert.equal(res.status, 404);
    });

    test('returns 404 when profile has no userId', async () => {
      const { app } = buildShareApp({
        stores: {
          ...makeShareDeps().stores,
          profiles: {
            ...makeShareDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: null, festivalId: 'f1' })),
          },
        },
      });
      const res = await request(app).get('/s/p1/json');
      assert.equal(res.status, 404);
    });

    test('returns 404 when festival not found', async () => {
      const { app } = buildShareApp({
        getFestivalById: mock.fn(async () => null),
        stores: {
          ...makeShareDeps().stores,
          profiles: {
            ...makeShareDeps().stores.profiles,
            getById: mock.fn(async () => ({ id: 'p1', userId: 'u1', festivalId: 'f1', picks: {} })),
          },
        },
      });
      const res = await request(app).get('/s/p1/json');
      assert.equal(res.status, 404);
    });

    test('returns JSON share data successfully', async () => {
      const { app } = buildShareApp({
        stores: {
          ...makeShareDeps().stores,
          profiles: {
            ...makeShareDeps().stores.profiles,
            getById: mock.fn(async () => ({
              id: 'p1', userId: 'u1', festivalId: 'f1',
              picks: { 'set-a': 'must' },
            })),
          },
        },
      });
      const res = await request(app).get('/s/p1/json');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.username, 'testuser');
      assert.equal(res.body.festivalName, 'Test Fest');
      assert.deepStrictEqual(res.body.picks, { 'set-a': 'must' });
      assert.ok(res.body.festival);
      assert.ok(res.body.festival.stages);
      assert.ok(res.body.festival.days);
    });

    test('uses Anonymous when user not found', async () => {
      const { app } = buildShareApp({
        getUserById: mock.fn(async () => null),
        stores: {
          ...makeShareDeps().stores,
          profiles: {
            ...makeShareDeps().stores.profiles,
            getById: mock.fn(async () => ({
              id: 'p1', userId: 'u1', festivalId: 'f1', picks: {},
            })),
          },
        },
      });
      const res = await request(app).get('/s/p1/json');
      assert.equal(res.status, 200);
      assert.equal(res.body.username, 'Anonymous');
    });

    test('returns 500 on internal error', async () => {
      const { app } = buildShareApp({
        stores: {
          ...makeShareDeps().stores,
          profiles: {
            ...makeShareDeps().stores.profiles,
            getById: mock.fn(async () => { throw new Error('db fail'); }),
          },
        },
      });
      const res = await request(app).get('/s/p1/json');
      assert.equal(res.status, 500);
    });
  });
});
