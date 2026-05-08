'use strict';
/**
 * Mock-based route tests for routes/crew-invites.js
 *
 * Covers: POST /join, POST /:crewId/invite, GET /join/:inviteCode
 * Mounts the route factory on a minimal Express app with fully stubbed deps.
 * No database required — all stores are mock.fn() stubs.
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

const DEFAULT_CREW = {
  id: 'crew-1',
  festivalId: 'fest-1',
  name: 'Test Crew',
  createdBy: 'owner-1',
  maxMembers: 10,
  inviteCode: 'ABC123',
  inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const DEFAULT_MEMBERS = [
  { userId: 'owner-1', username: 'crewowner', role: 'owner', joinedAt: '2026-01-01' },
];

/**
 * Build a deps object tailored for crew-invites.js.
 * The route is mounted as a sub-router of crews.js so it needs _crewHelpers.
 */
function makeInviteDeps(overrides = {}) {
  const ioObj = makeIo();
  const storesBase = {
    crews: {
      getById: mock.fn(async () => null),
      getByInviteCode: mock.fn(async () => null),
      getExpiredByInviteCode: mock.fn(async () => null),
      listByUserAndFestival: mock.fn(async () => []),
      getMembers: mock.fn(async () => [...DEFAULT_MEMBERS]),
      getMember: mock.fn(async () => null),
      getMemberCount: mock.fn(async () => 1),
      addMember: mock.fn(async () => {}),
      regenerateInviteCode: mock.fn(async () => {}),
    },
    profiles: {
      readByUserAndFestival: mock.fn(async () => ({ id: 'prof-1', userId: 'user-1' })),
    },
  };

  // Deep-merge stores
  const stores = { ...storesBase };
  if (overrides.stores) {
    stores.crews = { ...storesBase.crews, ...overrides.stores.crews };
    stores.profiles = { ...storesBase.profiles, ...overrides.stores.profiles };
  }

  // resolveCrewOwnership mock — returns { crew, membership } by default
  const resolveCrewOwnership = overrides.resolveCrewOwnership || mock.fn(async (_res, crewId) => {
    const crew = await stores.crews.getById(crewId);
    if (!crew) return null;
    return { crew, membership: { role: 'owner' } };
  });

  const serializeCrewWithMembers = overrides.serializeCrewWithMembers || ((crew, members, requestingUserId) => {
    const membership = members.find((m) => m.userId === requestingUserId);
    return {
      id: crew.id,
      festivalId: crew.festivalId,
      name: crew.name,
      createdBy: crew.createdBy,
      maxMembers: crew.maxMembers,
      role: membership?.role || 'member',
      members: members.map((m) => ({
        userId: m.userId,
        username: m.username,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      memberCount: members.length,
    };
  });

  const deps = {
    express,
    config: { NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://localhost:3000' },
    log: noopLog,
    userAuth: overrides.userAuth || ((req, _res, next) => {
      req.user = { userId: 'user-1', username: 'testuser' };
      next();
    }),
    sanitizeIdentifier: overrides.sanitizeIdentifier || ((s, _max) => (typeof s === 'string' ? s.trim() : '')),
    getFestivalById: overrides.getFestivalById || mock.fn(async (id) => ({ id, name: 'Test Festival' })),
    sendSuccess: (res, data) => res.json({ ok: true, ...data }),
    sendError: (res, status, msg, code) => res.status(status).json({ ok: false, code, message: msg }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      ALREADY_EXISTS: 'ALREADY_EXISTS',
      MAX_LIMIT_REACHED: 'MAX_LIMIT_REACHED',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    rateLimit: overrides.rateLimit || (() => (_req, _res, next) => next()),
    validate: overrides.validate || (() => (req, _res, next) => { req.validatedBody = req.body; next(); }),
    validateParams: overrides.validateParams || (() => (req, _res, next) => { req.validatedParams = req.params; next(); }),
    schemas: { crewJoin: {}, crewIdParams: {} },
    io: overrides.io !== undefined ? overrides.io : ioObj,
    stores,
    _crewHelpers: {
      resolveCrewOwnership,
      serializeCrewWithMembers,
      MAX_CREWS_PER_USER_PER_FESTIVAL: overrides.maxCrewsPerUser || 3,
    },
  };

  return deps;
}

function buildInviteApp(overrides = {}) {
  const deps = makeInviteDeps(overrides);
  const createCrewInviteRoutes = require('../routes/crew-invites');
  const router = createCrewInviteRoutes(deps);
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return { app, deps };
}

// =====================================================================
//  POST /join — Join a crew via invite code
// =====================================================================
describe('routes/crew-invites.js — POST /join', () => {

  test('factory returns an Express router', () => {
    const { app } = buildInviteApp();
    assert.ok(app);
  });

  // ── Happy path ────────────────────────────────────────────────────
  test('joins crew successfully with valid invite code', async () => {
    const addMember = mock.fn(async () => {});
    const newMembers = [
      ...DEFAULT_MEMBERS,
      { userId: 'user-1', username: 'testuser', role: 'member', joinedAt: '2026-05-08' },
    ];
    const { app, deps } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => []),
          getMemberCount: mock.fn(async () => 1),
          addMember,
          getMembers: mock.fn(async () => newMembers),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.id, 'crew-1');
    assert.equal(res.body.memberCount, 2);
    assert.equal(addMember.mock.calls.length, 1);
    assert.equal(addMember.mock.calls[0].arguments[0].crewId, 'crew-1');
    assert.equal(addMember.mock.calls[0].arguments[0].userId, 'user-1');
    assert.equal(addMember.mock.calls[0].arguments[0].role, 'member');
  });

  test('normalizes invite code to uppercase and trims whitespace', async () => {
    const getByInviteCode = mock.fn(async (code) => {
      if (code === 'ABC123') return { ...DEFAULT_CREW };
      return null;
    });
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode,
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => []),
          getMemberCount: mock.fn(async () => 1),
          addMember: mock.fn(async () => {}),
          getMembers: mock.fn(async () => DEFAULT_MEMBERS),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: '  abc123  ' });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(getByInviteCode.mock.calls[0].arguments[0], 'ABC123');
  });

  test('emits crew:member-joined via Socket.IO on success', async () => {
    const ioObj = makeIo();
    const { app } = buildInviteApp({
      io: ioObj,
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => []),
          getMemberCount: mock.fn(async () => 1),
          addMember: mock.fn(async () => {}),
          getMembers: mock.fn(async () => DEFAULT_MEMBERS),
        },
      },
    });

    await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(ioObj.to.mock.calls.length, 1);
    assert.equal(ioObj.to.mock.calls[0].arguments[0], 'crew:crew-1');
    assert.equal(ioObj._emit.mock.calls.length, 1);
    assert.equal(ioObj._emit.mock.calls[0].arguments[0], 'crew:member-joined');
    assert.deepEqual(ioObj._emit.mock.calls[0].arguments[1], {
      crewId: 'crew-1',
      userId: 'user-1',
      username: 'testuser',
    });
  });

  // ── Invalid / expired invite codes ────────────────────────────────
  test('returns 404 for non-existent invite code', async () => {
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => null),
          getExpiredByInviteCode: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'BADCODE' });

    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'NOT_FOUND');
    assert.match(res.body.message, /Invalid invite code/i);
  });

  test('returns 410 for expired invite code', async () => {
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => null),
          getExpiredByInviteCode: mock.fn(async () => ({
            ...DEFAULT_CREW,
            inviteExpiresAt: '2025-01-01T00:00:00.000Z',
          })),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'EXPRD1' });

    assert.equal(res.status, 410);
    assert.equal(res.body.code, 'NOT_FOUND');
    assert.match(res.body.message, /expired/i);
  });

  // ── Edge case: user has no festival profile ───────────────────────
  test('returns 403 when user has not joined the festival', async () => {
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
        },
        profiles: {
          readByUserAndFestival: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
    assert.match(res.body.message, /Join the festival first/i);
  });

  // ── Edge case: already a member ───────────────────────────────────
  test('returns 400 when user is already a member of the crew', async () => {
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'ALREADY_EXISTS');
    assert.match(res.body.message, /Already a member/i);
  });

  // ── Edge case: max crews per festival ─────────────────────────────
  test('returns 400 when user has reached max crews per festival', async () => {
    const { app } = buildInviteApp({
      maxCrewsPerUser: 3,
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => [
            { id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' },
          ]),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'MAX_LIMIT_REACHED');
    assert.match(res.body.message, /Maximum 3 crews/i);
  });

  // ── Edge case: crew is full ───────────────────────────────────────
  test('returns 400 when crew is full', async () => {
    const fullCrew = { ...DEFAULT_CREW, maxMembers: 5 };
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => fullCrew),
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => []),
          getMemberCount: mock.fn(async () => 5),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'MAX_LIMIT_REACHED');
    assert.match(res.body.message, /full/i);
  });

  // ── Edge case: io is null (no Socket.IO) ──────────────────────────
  test('succeeds when io is null (Socket.IO disabled)', async () => {
    const { app } = buildInviteApp({
      io: null,
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => []),
          getMemberCount: mock.fn(async () => 1),
          addMember: mock.fn(async () => {}),
          getMembers: mock.fn(async () => DEFAULT_MEMBERS),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 500);
    assert.equal(res.body.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  POST /:crewId/invite — Regenerate invite code (owner only)
// =====================================================================
describe('routes/crew-invites.js — POST /:crewId/invite', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('regenerates invite code for crew owner', async () => {
    const regenerateInviteCode = mock.fn(async () => {});
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          getByInviteCode: mock.fn(async () => null),
          regenerateInviteCode,
        },
      },
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
    });

    const res = await request(app)
      .post('/crew-1/invite');

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.inviteCode);
    assert.ok(res.body.inviteExpiresAt);
    assert.equal(regenerateInviteCode.mock.calls.length, 1);
  });

  // ── Invalid crew ID ───────────────────────────────────────────────
  test('returns 400 for empty/invalid crew ID', async () => {
    const { app } = buildInviteApp({
      sanitizeIdentifier: () => '',
    });

    const res = await request(app)
      .post('/%20/invite');

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_INPUT');
  });

  // ── Not the owner ─────────────────────────────────────────────────
  test('returns error when user is not the crew owner', async () => {
    const { app } = buildInviteApp({
      resolveCrewOwnership: mock.fn(async (res) => {
        // resolveCrewOwnership sends the error and returns null
        res.status(403).json({ ok: false, code: 'FORBIDDEN', message: 'Only the crew owner can regenerate invite codes' });
        return null;
      }),
    });

    const res = await request(app)
      .post('/crew-1/invite');

    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
  });

  // ── Crew not found ────────────────────────────────────────────────
  test('returns error when crew does not exist', async () => {
    const { app } = buildInviteApp({
      resolveCrewOwnership: mock.fn(async (res) => {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Crew not found' });
        return null;
      }),
    });

    const res = await request(app)
      .post('/crew-nonexistent/invite');

    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'NOT_FOUND');
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error during regeneration', async () => {
    const { app } = buildInviteApp({
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/invite');

    assert.equal(res.status, 500);
    assert.equal(res.body.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  GET /join/:inviteCode — Public invite page (no auth required)
// =====================================================================
describe('routes/crew-invites.js — GET /join/:inviteCode', () => {

  // ── Happy path: valid invite code renders join page ────────────────
  test('renders crew invite join page for valid code', async () => {
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
        },
      },
      getFestivalById: mock.fn(async () => ({ id: 'fest-1', name: 'Summer Fest' })),
    });

    const res = await request(app)
      .get('/join/ABC123');

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /Test Crew/);
    assert.match(res.text, /Summer Fest/);
    assert.match(res.text, /joinCrew=ABC123/);
    assert.equal(res.headers['cache-control'], 'public, max-age=300');
    assert.match(res.headers['content-security-policy'], /default-src 'none'/);
  });

  // ── Code too short ────────────────────────────────────────────────
  test('renders error page when invite code is too short', async () => {
    const { app } = buildInviteApp();

    const res = await request(app)
      .get('/join/AB');

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /Invalid or expired/i);
    assert.equal(res.headers['cache-control'], 'public, max-age=60');
  });

  // ── Code too long ─────────────────────────────────────────────────
  test('renders error page when invite code is too long', async () => {
    const { app } = buildInviteApp();

    const res = await request(app)
      .get('/join/ABCDEFGHIJKLM');

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /Invalid or expired/i);
  });

  // ── Code with invalid characters ──────────────────────────────────
  test('renders error page when invite code has non-alphanumeric chars', async () => {
    const { app } = buildInviteApp();

    const res = await request(app)
      .get('/join/AB-C!23');

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /Invalid or expired/i);
  });

  // ── Code not found in DB ──────────────────────────────────────────
  test('renders error page when invite code not found in database', async () => {
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .get('/join/XXXXXX');

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /Invalid or expired/i);
    assert.equal(res.headers['cache-control'], 'public, max-age=60');
  });

  // ── Festival not found uses fallback name ─────────────────────────
  test('uses fallback festival name when festival not found', async () => {
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
        },
      },
      getFestivalById: mock.fn(async () => null),
    });

    const res = await request(app)
      .get('/join/ABC123');

    assert.equal(res.status, 200);
    assert.match(res.text, /Festival/);
  });

  // ── Internal error renders error page ─────────────────────────────
  test('renders error page on internal error', async () => {
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .get('/join/VALID1');

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /Failed to load invite/i);
  });

  // ── CSP headers always set ────────────────────────────────────────
  test('sets Content-Security-Policy header on all responses', async () => {
    const { app } = buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .get('/join/XXXXXX');

    assert.ok(res.headers['content-security-policy']);
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  });
});

// =====================================================================
//  Rate limiting
// =====================================================================
describe('routes/crew-invites.js — rate limiting', () => {

  test('applies rate limit middleware to POST /join', async () => {
    const rateLimitCalls = [];
    const { app } = buildInviteApp({
      rateLimit: (max, key) => {
        rateLimitCalls.push({ max, key });
        return (_req, _res, next) => next();
      },
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => null),
          getExpiredByInviteCode: mock.fn(async () => null),
        },
      },
    });

    await request(app)
      .post('/join')
      .send({ inviteCode: 'TEST12' });

    const joinLimit = rateLimitCalls.find((c) => c.key === 'crew-join');
    assert.ok(joinLimit, 'crew-join rate limit should be applied');
    assert.equal(joinLimit.max, 10);
  });

  test('applies rate limit middleware to POST /:crewId/invite', async () => {
    const rateLimitCalls = [];
    const { app } = buildInviteApp({
      rateLimit: (max, key) => {
        rateLimitCalls.push({ max, key });
        return (_req, _res, next) => next();
      },
      resolveCrewOwnership: mock.fn(async (res) => {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Crew not found' });
        return null;
      }),
    });

    await request(app)
      .post('/crew-1/invite');

    const inviteLimit = rateLimitCalls.find((c) => c.key === 'crew-invite');
    assert.ok(inviteLimit, 'crew-invite rate limit should be applied');
    assert.equal(inviteLimit.max, 5);
  });

  test('applies rate limit middleware to GET /join/:inviteCode', async () => {
    const rateLimitCalls = [];
    const { app } = buildInviteApp({
      rateLimit: (max, key) => {
        rateLimitCalls.push({ max, key });
        return (_req, _res, next) => next();
      },
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => null),
        },
      },
    });

    await request(app)
      .get('/join/ABCDEF');

    const pageLimit = rateLimitCalls.find((c) => c.key === 'crew-invite-page');
    assert.ok(pageLimit, 'crew-invite-page rate limit should be applied');
    assert.equal(pageLimit.max, 30);
  });
});

// =====================================================================
//  Exported helper: generateUniqueInviteCode
// =====================================================================
describe('crew-invites.js — generateUniqueInviteCode export', () => {

  test('module exports generateUniqueInviteCode function', () => {
    const mod = require('../routes/crew-invites');
    assert.equal(typeof mod.generateUniqueInviteCode, 'function');
  });

  test('generateUniqueInviteCode returns a 6-char code', async () => {
    const { generateUniqueInviteCode } = require('../routes/crew-invites');
    const mockStores = {
      crews: {
        getByInviteCode: mock.fn(async () => null),
      },
    };

    const code = await generateUniqueInviteCode(mockStores);

    assert.equal(typeof code, 'string');
    assert.equal(code.length, 6);
    // Characters should only be from the allowed set (no I, O, 0, 1)
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  test('generateUniqueInviteCode retries on collision', async () => {
    const { generateUniqueInviteCode } = require('../routes/crew-invites');
    let callCount = 0;
    const mockStores = {
      crews: {
        getByInviteCode: mock.fn(async () => {
          callCount++;
          // First 3 codes "collide", then succeed
          if (callCount <= 3) return { id: 'existing-crew' };
          return null;
        }),
      },
    };

    const code = await generateUniqueInviteCode(mockStores);

    assert.equal(typeof code, 'string');
    assert.equal(code.length, 6);
    assert.ok(callCount >= 4, 'should have retried at least 3 times before succeeding');
  });

  test('generateUniqueInviteCode throws after 10 failed attempts', async () => {
    const { generateUniqueInviteCode } = require('../routes/crew-invites');
    const mockStores = {
      crews: {
        getByInviteCode: mock.fn(async () => ({ id: 'always-collides' })),
      },
    };

    await assert.rejects(
      () => generateUniqueInviteCode(mockStores),
      { message: 'Failed to generate unique invite code' },
    );

    assert.equal(mockStores.crews.getByInviteCode.mock.calls.length, 10);
  });
});
