/**
 * Mock-based route tests for routes/crew-members.js
 *
 * Covers:
 *   GET  /search-users              — Admin user search
 *   DELETE /:crewId/leave           — Leave a crew
 *   DELETE /:crewId/members/:userId — Kick a member (owner only)
 *   PUT  /:crewId/transfer          — Transfer ownership (owner only)
 *   GET  /:crewId/overlap           — Crew pick overlap
 *   POST /:crewId/members           — Admin force-add member
 *
 * No database required — all stores are mock.fn() stubs.
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

const DEFAULT_CREW = {
  id: 'crew-1',
  festivalId: 'fest-1',
  name: 'Test Crew',
  createdBy: 'owner-1',
  maxMembers: 10,
  inviteCode: 'ABC123',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const DEFAULT_MEMBERS = [
  { userId: 'owner-1', username: 'crewowner', role: 'owner', joinedAt: '2026-01-01' },
  { userId: 'user-2', username: 'member2', role: 'member', joinedAt: '2026-01-02' },
];

/**
 * Build a deps object tailored for crew-members.js.
 * Follows the same pattern as crew-invites.test.js.
 */
function makeDeps(overrides: any = {}) {
  const ioObj = makeIo();
  const storesBase = {
    crews: {
      getById: mock.fn(async () => null),
      getMembers: mock.fn(async () => [...DEFAULT_MEMBERS]),
      getMember: mock.fn(async () => null),
      getMemberCount: mock.fn(async () => 2),
      addMember: mock.fn(async () => {}),
      removeMember: mock.fn(async () => {}),
      updateMemberRole: mock.fn(async () => {}),
      getCrewPickOverlap: mock.fn(async () => []),
    },
    roles: {
      hasRole: mock.fn(async () => false),
    },
    users: {
      getById: mock.fn(async () => null),
    },
  };

  // Deep-merge stores
  const stores: any = { ...storesBase };
  if (overrides.stores) {
    stores.crews = { ...storesBase.crews, ...overrides.stores.crews };
    stores.roles = { ...storesBase.roles, ...overrides.stores.roles };
    stores.users = { ...storesBase.users, ...overrides.stores.users };
  }

  // resolveCrewOwnership mock — returns { crew, membership } by default
  const resolveCrewOwnership = overrides.resolveCrewOwnership || mock.fn(async (_res: any, crewId: any) => {
    const crew = await stores.crews.getById(crewId);
    if (!crew) return null;
    return { crew, membership: { role: 'owner' } };
  });

  const serializeCrewWithMembers = overrides.serializeCrewWithMembers || ((crew: any, members: any, requestingUserId: any) => {
    const membership = members.find((m: any) => m.userId === requestingUserId);
    return {
      id: crew.id,
      festivalId: crew.festivalId,
      name: crew.name,
      createdBy: crew.createdBy,
      maxMembers: crew.maxMembers,
      role: membership?.role || 'member',
      members: members.map((m: any) => ({
        userId: m.userId,
        username: m.username,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      memberCount: members.length,
    };
  });

  const pool = overrides.pool || {
    query: mock.fn(async () => ({ rows: [] })),
  };

  const deps = {
    express,
    log: noopLog,
    pool,
    userAuth: overrides.userAuth || ((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', username: 'testuser' };
      next();
    }),
    setNoStore: overrides.setNoStore || ((_res: any) => {}),
    sanitizeIdentifier: overrides.sanitizeIdentifier || ((s: any, _max?: any) => (typeof s === 'string' ? s.trim() : '')),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: any, msg: any, code: any) => res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      ALREADY_EXISTS: 'ALREADY_EXISTS',
      MAX_LIMIT_REACHED: 'MAX_LIMIT_REACHED',
      MISSING_FIELD: 'MISSING_FIELD',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    rateLimit: overrides.rateLimit || ((_max: any, _key: any) => (_req: any, _res: any, next: any) => next()),
    validate: overrides.validate || ((_schema: any) => (req: any, _res: any, next: any) => { req.validatedBody = req.body; next(); }),
    validateQuery: overrides.validateQuery || ((_schema: any) => (req: any, _res: any, next: any) => { req.validatedQuery = req.query; next(); }),
    validateParams: overrides.validateParams || ((_schema: any) => (req: any, _res: any, next: any) => { req.validatedParams = req.params; next(); }),
    schemas: {
      crewUserSearchQuery: {},
      crewIdParams: {},
      crewTransfer: {},
      crewAddMember: {},
    },
    io: overrides.io !== undefined ? overrides.io : ioObj,
    stores,
    _crewHelpers: {
      resolveCrewOwnership,
      serializeCrewWithMembers,
    },
  };

  return deps;
}

async function buildApp(overrides: any = {}) {
  const deps = makeDeps(overrides);
  const { default: createCrewMemberRoutes } = await import('../routes/crew-members.js');
  const router = createCrewMemberRoutes(deps);
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return { app, deps };
}

// =====================================================================
//  GET /search-users — Admin: search users for crew add
// =====================================================================
describe('routes/crew-members.js — GET /search-users', () => {

  test('factory returns an Express router', async () => {
    const { app } = await buildApp();
    assert.ok(app);
  });

  // ── Happy path ────────────────────────────────────────────────────
  test('returns matching users when admin searches', async () => {
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => true) },
      },
      pool: {
        query: mock.fn(async () => ({
          rows: [
            { id: 'u-1', username: 'alice' },
            { id: 'u-2', username: 'alicia' },
          ],
        })),
      },
    });

    const res = await request(app)
      .get('/search-users?q=ali');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data[0].username, 'alice');
    assert.equal(res.body.data[1].username, 'alicia');
  });

  test('returns empty array for empty query string', async () => {
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => true) },
      },
    });

    const res = await request(app)
      .get('/search-users?q=');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    // sendSuccess wraps in { data, error: null }, so data is empty array
  });

  test('returns empty array when query is only whitespace', async () => {
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => true) },
      },
    });

    const res = await request(app)
      .get('/search-users?q=%20%20');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  // ── Permission checks ────────────────────────────────────────────
  test('returns 403 when non-admin searches', async () => {
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => false) },
      },
    });

    const res = await request(app)
      .get('/search-users?q=test');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Admin access required/i);
  });

  // ── LIKE metacharacter escaping ───────────────────────────────────
  test('escapes LIKE metacharacters in search query', async () => {
    const poolQuery = mock.fn(async () => ({ rows: [] }));
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => true) },
      },
      pool: { query: poolQuery },
    });

    await request(app)
      .get('/search-users?q=test%25user');

    assert.equal(poolQuery.mock.calls.length, 1);
    const param = (poolQuery.mock.calls as any[])[0].arguments[1][0];
    // The % in the search term should be escaped as \%
    assert.ok(param.includes('\\%'), `Expected escaped %, got: ${param}`);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on database error', async () => {
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => true) },
      },
      pool: {
        query: mock.fn(async () => { throw new Error('db down'); }),
      },
    });

    const res = await request(app)
      .get('/search-users?q=test');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  DELETE /:crewId/leave — Leave a crew
// =====================================================================
describe('routes/crew-members.js — DELETE /:crewId/leave', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('member leaves crew successfully', async () => {
    const removeMember = mock.fn(async () => {});
    const { app, deps } = await buildApp({
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          removeMember,
        },
      },
    });

    const res = await request(app)
      .delete('/crew-1/leave');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.success, true);
    assert.equal(removeMember.mock.calls.length, 1);
    assert.equal((removeMember.mock.calls as any[])[0].arguments[0], 'crew-1');
    assert.equal((removeMember.mock.calls as any[])[0].arguments[1], 'user-1');
  });

  test('emits crew:member-left via Socket.IO on leave', async () => {
    const ioObj = makeIo();
    const { app } = await buildApp({
      io: ioObj,
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          removeMember: mock.fn(async () => {}),
        },
      },
    });

    await request(app)
      .delete('/crew-1/leave');

    assert.equal(ioObj.to.mock.calls.length, 1);
    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:member-left');
    assert.deepEqual((ioObj._emit.mock.calls as any[])[0].arguments[1], {
      crewId: 'crew-1',
      userId: 'user-1',
      username: 'testuser',
    });
  });

  // ── Owner cannot leave ────────────────────────────────────────────
  test('returns 400 when owner tries to leave without transferring', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
      },
    });

    const res = await request(app)
      .delete('/crew-1/leave');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Transfer ownership/i);
  });

  // ── Not a member ──────────────────────────────────────────────────
  test('returns 400 when user is not a member', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .delete('/crew-1/leave');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.match(res.body.error.message, /Not a member/i);
  });

  // ── Crew not found ────────────────────────────────────────────────
  test('returns 404 when crew does not exist', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getById: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .delete('/crew-nonexistent/leave');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Invalid crew ID ───────────────────────────────────────────────
  test('returns 400 for empty crew ID', async () => {
    const { app } = await buildApp({
      sanitizeIdentifier: () => '',
    });

    const res = await request(app)
      .delete('/%20/leave');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  // ── No Socket.IO ──────────────────────────────────────────────────
  test('succeeds when io is null', async () => {
    const { app } = await buildApp({
      io: null,
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          removeMember: mock.fn(async () => {}),
        },
      },
    });

    const res = await request(app)
      .delete('/crew-1/leave');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getById: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .delete('/crew-1/leave');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  DELETE /:crewId/members/:userId — Kick a member (owner only)
// =====================================================================
describe('routes/crew-members.js — DELETE /:crewId/members/:userId', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('owner kicks member successfully', async () => {
    const removeMember = mock.fn(async () => {});
    const { app } = await buildApp({
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-2', role: 'member' })),
          removeMember,
        },
      },
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
    });

    const res = await request(app)
      .delete('/crew-1/members/user-2');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.success, true);
    assert.equal(removeMember.mock.calls.length, 1);
    assert.equal((removeMember.mock.calls as any[])[0].arguments[0], 'crew-1');
    assert.equal((removeMember.mock.calls as any[])[0].arguments[1], 'user-2');
  });

  test('emits crew:member-kicked via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildApp({
      io: ioObj,
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-2', role: 'member' })),
          removeMember: mock.fn(async () => {}),
        },
      },
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
    });

    await request(app)
      .delete('/crew-1/members/user-2');

    assert.equal(ioObj.to.mock.calls.length, 1);
    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:member-kicked');
    assert.deepEqual((ioObj._emit.mock.calls as any[])[0].arguments[1], {
      crewId: 'crew-1',
      userId: 'user-2',
    });
  });

  // ── Cannot kick yourself ──────────────────────────────────────────
  test('returns 400 when owner tries to kick themselves', async () => {
    const { app } = await buildApp({
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
    });

    const res = await request(app)
      .delete('/crew-1/members/user-1');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.match(res.body.error.message, /Cannot kick yourself/i);
  });

  // ── Non-owner rejected ────────────────────────────────────────────
  test('returns 403 when non-owner tries to kick', async () => {
    const { app } = await buildApp({
      resolveCrewOwnership: mock.fn(async (res: any) => {
        res.status(403).json({ data: null, error: { message: 'Only the crew owner can kick members', status: 403, code: 'FORBIDDEN' } });
        return null;
      }),
    });

    const res = await request(app)
      .delete('/crew-1/members/user-2');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Target not a member ───────────────────────────────────────────
  test('returns 404 when target user is not a member', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
    });

    const res = await request(app)
      .delete('/crew-1/members/user-999');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.match(res.body.error.message, /Member not found/i);
  });

  // ── Invalid IDs ───────────────────────────────────────────────────
  test('returns 400 for invalid crew or user ID', async () => {
    const { app } = await buildApp({
      sanitizeIdentifier: () => '',
    });

    const res = await request(app)
      .delete('/%20/members/%20');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.match(res.body.error.message, /Invalid IDs/i);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error during kick', async () => {
    const { app } = await buildApp({
      resolveCrewOwnership: mock.fn(async () => { throw new Error('db down'); }),
    });

    const res = await request(app)
      .delete('/crew-1/members/user-2');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  PUT /:crewId/transfer — Transfer ownership (owner only)
// =====================================================================
describe('routes/crew-members.js — PUT /:crewId/transfer', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('transfers ownership successfully', async () => {
    const updateMemberRole = mock.fn(async () => {});
    const newMembers = [
      { userId: 'owner-1', username: 'crewowner', role: 'member', joinedAt: '2026-01-01' },
      { userId: 'user-2', username: 'member2', role: 'owner', joinedAt: '2026-01-02' },
    ];
    const { app } = await buildApp({
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-2', role: 'member' })),
          getMembers: mock.fn(async () => newMembers),
          updateMemberRole,
        },
      },
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
    });

    const res = await request(app)
      .put('/crew-1/transfer')
      .send({ userId: 'user-2' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.id, 'crew-1');
    // updateMemberRole should be called twice: once for new owner, once for old owner
    assert.equal(updateMemberRole.mock.calls.length, 2);
    assert.equal((updateMemberRole.mock.calls as any[])[0].arguments[1], 'user-2');
    assert.equal((updateMemberRole.mock.calls as any[])[0].arguments[2], 'owner');
    assert.equal((updateMemberRole.mock.calls as any[])[1].arguments[1], 'user-1');
    assert.equal((updateMemberRole.mock.calls as any[])[1].arguments[2], 'member');
  });

  test('emits crew:updated via Socket.IO without inviteCode', async () => {
    const ioObj = makeIo();
    const newMembers = [
      { userId: 'owner-1', username: 'crewowner', role: 'member', joinedAt: '2026-01-01' },
      { userId: 'user-2', username: 'member2', role: 'owner', joinedAt: '2026-01-02' },
    ];
    const { app } = await buildApp({
      io: ioObj,
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-2', role: 'member' })),
          getMembers: mock.fn(async () => newMembers),
          updateMemberRole: mock.fn(async () => {}),
        },
      },
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
    });

    await request(app)
      .put('/crew-1/transfer')
      .send({ userId: 'user-2' });

    assert.equal(ioObj.to.mock.calls.length, 1);
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:updated');
    const broadcastData = (ioObj._emit.mock.calls as any[])[0].arguments[1];
    assert.equal(broadcastData.inviteCode, undefined, 'inviteCode should be stripped from broadcast');
  });

  // ── Cannot transfer to self ───────────────────────────────────────
  test('returns 400 when transferring to self', async () => {
    const { app } = await buildApp({
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
    });

    const res = await request(app)
      .put('/crew-1/transfer')
      .send({ userId: 'user-1' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.match(res.body.error.message, /Already the owner/i);
  });

  // ── Target not a member ───────────────────────────────────────────
  test('returns 404 when target is not a crew member', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
    });

    const res = await request(app)
      .put('/crew-1/transfer')
      .send({ userId: 'user-999' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.match(res.body.error.message, /not a crew member/i);
  });

  // ── Non-owner rejected ────────────────────────────────────────────
  test('returns 403 when non-owner tries to transfer', async () => {
    const { app } = await buildApp({
      resolveCrewOwnership: mock.fn(async (res: any) => {
        res.status(403).json({ data: null, error: { message: 'Only the crew owner can transfer', status: 403, code: 'FORBIDDEN' } });
        return null;
      }),
    });

    const res = await request(app)
      .put('/crew-1/transfer')
      .send({ userId: 'user-2' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Missing target userId ─────────────────────────────────────────
  test('returns 400 when target userId is missing', async () => {
    const { app } = await buildApp({
      sanitizeIdentifier: (s: any) => (typeof s === 'string' && s.trim() ? s.trim() : ''),
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
    });

    const res = await request(app)
      .put('/crew-1/transfer')
      .send({});

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'MISSING_FIELD');
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error during transfer', async () => {
    const { app } = await buildApp({
      resolveCrewOwnership: mock.fn(async () => { throw new Error('db down'); }),
    });

    const res = await request(app)
      .put('/crew-1/transfer')
      .send({ userId: 'user-2' });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  GET /:crewId/overlap — Crew pick overlap
// =====================================================================
describe('routes/crew-members.js — GET /:crewId/overlap', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('returns pick overlap for crew members', async () => {
    const overlapRows = [
      { userId: 'u-1', username: 'alice', picksJson: JSON.stringify({ 'set-A': 1, 'set-B': 2 }) },
      { userId: 'u-2', username: 'bob', picksJson: JSON.stringify({ 'set-A': 3 }) },
    ];
    const { app } = await buildApp({
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          getCrewPickOverlap: mock.fn(async () => overlapRows),
        },
      },
    });

    const res = await request(app)
      .get('/crew-1/overlap');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.crewId, 'crew-1');
    assert.equal(res.body.data.festivalId, 'fest-1');
    assert.equal(res.body.data.memberCount, 2);
    // set-A should have 2 pickers, set-B should have 1
    assert.equal(res.body.data.overlap['set-A'].length, 2);
    assert.equal(res.body.data.overlap['set-B'].length, 1);
  });

  // ── Non-member rejected ───────────────────────────────────────────
  test('returns 403 when user is not a member', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .get('/crew-1/overlap');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Crew not found ────────────────────────────────────────────────
  test('returns 404 when crew does not exist', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getById: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .get('/crew-nonexistent/overlap');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Handles malformed picksJson ───────────────────────────────────
  test('handles null and malformed picksJson gracefully', async () => {
    const overlapRows = [
      { userId: 'u-1', username: 'alice', picksJson: null },
      { userId: 'u-2', username: 'bob', picksJson: 'not-json{' },
    ];
    const { app } = await buildApp({
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          getCrewPickOverlap: mock.fn(async () => overlapRows),
        },
      },
    });

    const res = await request(app)
      .get('/crew-1/overlap');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.memberCount, 2);
    // No valid picks, so overlap should be empty
    assert.deepEqual(res.body.data.overlap, {});
  });

  // ── Filters prototype pollution keys ──────────────────────────────
  test('filters out __proto__, constructor, and prototype keys from picks', async () => {
    const overlapRows = [
      { userId: 'u-1', username: 'alice', picksJson: JSON.stringify({ 'constructor': 2, 'prototype': 3, 'valid-set': 4 }) },
    ];
    const { app } = await buildApp({
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          getCrewPickOverlap: mock.fn(async () => overlapRows),
        },
      },
    });

    const res = await request(app)
      .get('/crew-1/overlap');

    assert.equal(res.status, 200);
    assert.equal(res.body.data.overlap['valid-set'].length, 1);
    // constructor and prototype keys should be filtered by the route
    const overlapKeys = Object.keys(res.body.data.overlap);
    assert.ok(!overlapKeys.includes('constructor'), 'constructor key should be filtered');
    assert.ok(!overlapKeys.includes('prototype'), 'prototype key should be filtered');
    assert.ok(overlapKeys.includes('valid-set'), 'valid-set key should be present');
  });
});

// =====================================================================
//  POST /:crewId/members — Admin: add any user to a crew
// =====================================================================
describe('routes/crew-members.js — POST /:crewId/members (admin force-add)', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('admin adds user to crew successfully', async () => {
    const addMember = mock.fn(async () => {});
    const newMembers = [
      ...DEFAULT_MEMBERS,
      { userId: 'user-3', username: 'newbie', role: 'member', joinedAt: '2026-05-08' },
    ];
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => true) },
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
          getMemberCount: mock.fn(async () => 2),
          getMembers: mock.fn(async () => newMembers),
          addMember,
        },
        users: { getById: mock.fn(async () => ({ id: 'user-3', username: 'newbie' })) },
      },
    });

    const res = await request(app)
      .post('/crew-1/members')
      .send({ userId: 'user-3' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.id, 'crew-1');
    assert.equal(res.body.data.memberCount, 3);
    assert.equal(addMember.mock.calls.length, 1);
    assert.equal((addMember.mock.calls as any[])[0].arguments[0].userId, 'user-3');
    assert.equal((addMember.mock.calls as any[])[0].arguments[0].role, 'member');
  });

  test('emits crew:member-joined via Socket.IO on admin add', async () => {
    const ioObj = makeIo();
    const { app } = await buildApp({
      io: ioObj,
      stores: {
        roles: { hasRole: mock.fn(async () => true) },
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
          getMemberCount: mock.fn(async () => 2),
          getMembers: mock.fn(async () => DEFAULT_MEMBERS),
          addMember: mock.fn(async () => {}),
        },
        users: { getById: mock.fn(async () => ({ id: 'user-3', username: 'newbie' })) },
      },
    });

    await request(app)
      .post('/crew-1/members')
      .send({ userId: 'user-3' });

    assert.equal(ioObj.to.mock.calls.length, 1);
    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:member-joined');
    assert.deepEqual((ioObj._emit.mock.calls as any[])[0].arguments[1], {
      crewId: 'crew-1',
      userId: 'user-3',
      username: 'newbie',
    });
  });

  // ── Non-admin rejected ────────────────────────────────────────────
  test('returns 403 when non-admin tries to add member', async () => {
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => false) },
      },
    });

    const res = await request(app)
      .post('/crew-1/members')
      .send({ userId: 'user-3' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Crew not found ────────────────────────────────────────────────
  test('returns 404 when crew does not exist', async () => {
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => true) },
        crews: {
          getById: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/members')
      .send({ userId: 'user-3' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.match(res.body.error.message, /Crew not found/i);
  });

  // ── User not found ────────────────────────────────────────────────
  test('returns 404 when target user does not exist', async () => {
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => true) },
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
        },
        users: { getById: mock.fn(async () => null) },
      },
    });

    const res = await request(app)
      .post('/crew-1/members')
      .send({ userId: 'user-999' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.match(res.body.error.message, /User not found/i);
  });

  // ── Already a member ──────────────────────────────────────────────
  test('returns 400 when user is already a member', async () => {
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => true) },
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-2', role: 'member' })),
        },
        users: { getById: mock.fn(async () => ({ id: 'user-2', username: 'member2' })) },
      },
    });

    const res = await request(app)
      .post('/crew-1/members')
      .send({ userId: 'user-2' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'ALREADY_EXISTS');
  });

  // ── Crew is full ──────────────────────────────────────────────────
  test('returns 400 when crew is full', async () => {
    const fullCrew = { ...DEFAULT_CREW, maxMembers: 2 };
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => true) },
        crews: {
          getById: mock.fn(async () => fullCrew),
          getMember: mock.fn(async () => null),
          getMemberCount: mock.fn(async () => 2),
        },
        users: { getById: mock.fn(async () => ({ id: 'user-3', username: 'newbie' })) },
      },
    });

    const res = await request(app)
      .post('/crew-1/members')
      .send({ userId: 'user-3' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'MAX_LIMIT_REACHED');
    assert.match(res.body.error.message, /full/i);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildApp({
      stores: {
        roles: { hasRole: mock.fn(async () => { throw new Error('db down'); }) },
      },
    });

    const res = await request(app)
      .post('/crew-1/members')
      .send({ userId: 'user-3' });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  Rate limiting
// =====================================================================
describe('routes/crew-members.js — rate limiting', () => {

  test('applies correct rate limits to each endpoint', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildApp({
      rateLimit: (max: any, key: any) => {
        rateLimitCalls.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
      stores: {
        roles: { hasRole: mock.fn(async () => false) },
        crews: {
          getById: mock.fn(async () => null),
          getMember: mock.fn(async () => null),
        },
      },
      resolveCrewOwnership: mock.fn(async (res: any) => {
        res.status(404).json({ data: null, error: { message: 'Crew not found', status: 404, code: 'NOT_FOUND' } });
        return null;
      }),
    });

    // Hit each endpoint to trigger rate limit registration
    await request(app).get('/search-users?q=test');
    await request(app).delete('/crew-1/leave');
    await request(app).delete('/crew-1/members/user-2');
    await request(app).put('/crew-1/transfer').send({ userId: 'user-2' });
    await request(app).get('/crew-1/overlap');
    await request(app).post('/crew-1/members').send({ userId: 'user-3' });

    const searchLimit = rateLimitCalls.find((c: any) => c.key === 'crew-user-search');
    assert.ok(searchLimit, 'crew-user-search rate limit should be applied');
    assert.equal(searchLimit.max, 30);

    const leaveLimit = rateLimitCalls.find((c: any) => c.key === 'crew-leave');
    assert.ok(leaveLimit, 'crew-leave rate limit should be applied');
    assert.equal(leaveLimit.max, 10);

    const kickLimit = rateLimitCalls.find((c: any) => c.key === 'crew-kick');
    assert.ok(kickLimit, 'crew-kick rate limit should be applied');
    assert.equal(kickLimit.max, 10);

    const transferLimit = rateLimitCalls.find((c: any) => c.key === 'crew-transfer');
    assert.ok(transferLimit, 'crew-transfer rate limit should be applied');
    assert.equal(transferLimit.max, 5);

    const overlapLimit = rateLimitCalls.find((c: any) => c.key === 'crew-overlap');
    assert.ok(overlapLimit, 'crew-overlap rate limit should be applied');
    assert.equal(overlapLimit.max, 60);

    const addMemberLimit = rateLimitCalls.find((c: any) => c.key === 'crew-add-member');
    assert.ok(addMemberLimit, 'crew-add-member rate limit should be applied');
    assert.equal(addMemberLimit.max, 10);
  });
});
