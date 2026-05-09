'use strict';
/**
 * Mock-based route tests for routes/crew-polls.js
 *
 * Covers: GET /:crewId/polls, POST /:crewId/polls,
 *         POST /:crewId/polls/:pollId/vote, DELETE /:crewId/polls/:pollId
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

const DEFAULT_POLL = {
  id: 'poll-1',
  crew_id: 'crew-1',
  created_by: 'user-1',
  question: 'Where should we camp?',
  options: ['North field', 'South field', 'East lot'],
  closed_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

/**
 * Build a deps object tailored for crew-polls.js.
 */
function makePollDeps(overrides = {}) {
  const ioObj = makeIo();
  const storesBase = {
    crews: {
      getMember: mock.fn(async () => null),
    },
    polls: {
      listByCrew: mock.fn(async () => []),
      countActiveByCrew: mock.fn(async () => 0),
      create: mock.fn(async (data) => ({
        id: 'poll-new',
        crew_id: data.crewId,
        created_by: data.createdBy,
        question: data.question,
        options: data.options,
        closed_at: null,
        created_at: new Date().toISOString(),
      })),
      getById: mock.fn(async () => null),
      vote: mock.fn(async () => {}),
      close: mock.fn(async () => ({ ...DEFAULT_POLL, closed_at: new Date().toISOString() })),
    },
    activity: {
      log: mock.fn(async () => {}),
    },
  };

  // Deep-merge stores
  const stores = { ...storesBase };
  if (overrides.stores) {
    stores.crews = { ...storesBase.crews, ...overrides.stores.crews };
    stores.polls = { ...storesBase.polls, ...overrides.stores.polls };
    stores.activity = { ...storesBase.activity, ...overrides.stores.activity };
  }

  const deps = {
    express,
    log: noopLog,
    userAuth: overrides.userAuth || ((req, _res, next) => {
      req.user = { userId: 'user-1', username: 'testuser' };
      next();
    }),
    sanitizeIdentifier: overrides.sanitizeIdentifier || ((s) => (typeof s === 'string' ? s.trim() : '')),
    sendSuccess: (res, data) => res.json({ data, error: null }),
    sendError: (res, status, msg, code) => res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      CONFLICT: 'CONFLICT',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    rateLimit: overrides.rateLimit || (() => (_req, _res, next) => next()),
    schemas: {
      crewIdParams: {},
      crewIdPollIdParams: {},
      pollCreate: {},
      pollVote: {},
    },
    validate: overrides.validate || (() => (req, _res, next) => { req.validatedBody = req.body; next(); }),
    validateParams: overrides.validateParams || (() => (req, _res, next) => { req.validatedParams = req.params; next(); }),
    io: overrides.io !== undefined ? overrides.io : ioObj,
    stores,
  };

  return deps;
}

function buildPollApp(overrides = {}) {
  const deps = makePollDeps(overrides);
  const createCrewPollRoutes = require('../routes/crew-polls');
  const router = createCrewPollRoutes(deps);
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return { app, deps };
}

// =====================================================================
//  GET /:crewId/polls — List polls for a crew
// =====================================================================
describe('routes/crew-polls.js — GET /:crewId/polls', () => {

  test('factory returns an Express router', () => {
    const { app } = buildPollApp();
    assert.ok(app);
  });

  // ── Happy path ────────────────────────────────────────────────────
  test('returns polls list for a crew member', async () => {
    const polls = [
      { ...DEFAULT_POLL },
      { ...DEFAULT_POLL, id: 'poll-2', question: 'What time to meet?', closed_at: '2026-01-02T00:00:00.000Z' },
    ];
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          listByCrew: mock.fn(async () => polls),
        },
      },
    });

    const res = await request(app).get('/crew-1/polls');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.polls.length, 2);
    assert.equal(res.body.data.polls[0].id, 'poll-1');
    assert.equal(res.body.data.polls[1].id, 'poll-2');
  });

  test('returns empty array when crew has no polls', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          listByCrew: mock.fn(async () => []),
        },
      },
    });

    const res = await request(app).get('/crew-1/polls');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.deepEqual(res.body.data.polls, []);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).get('/crew-1/polls');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Not a crew member/i);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app).get('/crew-1/polls');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  POST /:crewId/polls — Create a poll
// =====================================================================
describe('routes/crew-polls.js — POST /:crewId/polls', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('creates a poll successfully', async () => {
    const createFn = mock.fn(async (data) => ({
      id: 'poll-new',
      crew_id: data.crewId,
      created_by: data.createdBy,
      question: data.question,
      options: data.options,
      closed_at: null,
    }));
    const { app, deps } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 0),
          create: createFn,
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Where to camp?', options: ['North', 'South'] });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.poll.id, 'poll-new');
    assert.equal(res.body.data.poll.question, 'Where to camp?');
    assert.equal(createFn.mock.calls.length, 1);
    assert.equal(createFn.mock.calls[0].arguments[0].crewId, 'crew-1');
    assert.equal(createFn.mock.calls[0].arguments[0].createdBy, 'user-1');
  });

  test('creates a poll with closesAt timestamp', async () => {
    const createFn = mock.fn(async (data) => ({
      id: 'poll-new',
      crew_id: data.crewId,
      created_by: data.createdBy,
      question: data.question,
      options: data.options,
      closes_at: data.closesAt,
    }));
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 0),
          create: createFn,
        },
      },
    });

    const closesAt = '2026-06-01T12:00:00.000Z';
    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Meeting time?', options: ['10am', '2pm'], closesAt });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    // closesAt should be passed as a Date to the store
    const passedClosesAt = createFn.mock.calls[0].arguments[0].closesAt;
    assert.ok(passedClosesAt instanceof Date);
    assert.equal(passedClosesAt.toISOString(), closesAt);
  });

  test('creates a poll with null closesAt when not provided', async () => {
    const createFn = mock.fn(async (data) => ({
      id: 'poll-new',
      crew_id: data.crewId,
      created_by: data.createdBy,
      question: data.question,
      options: data.options,
      closes_at: data.closesAt,
    }));
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 0),
          create: createFn,
        },
      },
    });

    await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Favorite band?', options: ['A', 'B'] });

    assert.equal(createFn.mock.calls[0].arguments[0].closesAt, null);
  });

  // ── Socket.IO broadcast ───────────────────────────────────────────
  test('broadcasts crew:poll-created via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = buildPollApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data) => ({
            id: 'poll-new',
            question: data.question,
            options: data.options,
          })),
        },
      },
    });

    await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Where?', options: ['A', 'B'] });

    assert.equal(ioObj.to.mock.calls.length, 1);
    assert.equal(ioObj.to.mock.calls[0].arguments[0], 'crew:crew-1');
    assert.equal(ioObj._emit.mock.calls[0].arguments[0], 'crew:poll-created');
    const payload = ioObj._emit.mock.calls[0].arguments[1];
    assert.equal(payload.pollId, 'poll-new');
    assert.equal(payload.question, 'Where?');
    assert.deepEqual(payload.options, ['A', 'B']);
    assert.equal(payload.createdBy, 'user-1');
  });

  // ── Activity logging ──────────────────────────────────────────────
  test('logs poll-created activity', async () => {
    const activityLog = mock.fn(async () => {});
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data) => ({
            id: 'poll-new',
            question: data.question,
            options: data.options,
          })),
        },
        activity: {
          log: activityLog,
        },
      },
    });

    await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Where?', options: ['A', 'B'] });

    assert.equal(activityLog.mock.calls.length, 1);
    const logArgs = activityLog.mock.calls[0].arguments[0];
    assert.equal(logArgs.crewId, 'crew-1');
    assert.equal(logArgs.userId, 'user-1');
    assert.equal(logArgs.type, 'poll-created');
    assert.equal(logArgs.detail, 'Where?');
  });

  // ── Max active polls limit ────────────────────────────────────────
  test('returns 409 when crew already has 3 active polls', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 3),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Too many?', options: ['Yes', 'No'] });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
    assert.match(res.body.error.message, /Max 3 active polls/i);
  });

  test('allows creating a poll when crew has fewer than 3 active polls', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 2),
          create: mock.fn(async (data) => ({
            id: 'poll-new',
            question: data.question,
            options: data.options,
          })),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Almost full?', options: ['Yes', 'No'] });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Where?', options: ['A', 'B'] });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Activity log failure does not break response ──────────────────
  test('succeeds even when activity logging fails', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data) => ({
            id: 'poll-new',
            question: data.question,
            options: data.options,
          })),
        },
        activity: {
          log: mock.fn(async () => { throw new Error('activity store down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Still works?', options: ['Yes', 'No'] });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Crash?', options: ['Yes', 'No'] });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  POST /:crewId/polls/:pollId/vote — Vote on a poll
// =====================================================================
describe('routes/crew-polls.js — POST /:crewId/polls/:pollId/vote', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('casts a vote successfully', async () => {
    const voteFn = mock.fn(async () => {});
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })),
          vote: voteFn,
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 1 });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.voted, true);
    assert.equal(voteFn.mock.calls.length, 1);
    assert.equal(voteFn.mock.calls[0].arguments[0], 'poll-1');
    assert.equal(voteFn.mock.calls[0].arguments[1], 'user-1');
    assert.equal(voteFn.mock.calls[0].arguments[2], 1);
  });

  // ── Socket.IO broadcast ───────────────────────────────────────────
  test('broadcasts crew:poll-voted via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = buildPollApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })),
          vote: mock.fn(async () => {}),
        },
      },
    });

    await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 });

    assert.equal(ioObj.to.mock.calls[0].arguments[0], 'crew:crew-1');
    assert.equal(ioObj._emit.mock.calls[0].arguments[0], 'crew:poll-voted');
    assert.deepEqual(ioObj._emit.mock.calls[0].arguments[1], {
      pollId: 'poll-1',
      userId: 'user-1',
      optionIndex: 0,
    });
  });

  // ── Activity logging ──────────────────────────────────────────────
  test('logs poll-voted activity with option text', async () => {
    const activityLog = mock.fn(async () => {});
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })),
          vote: mock.fn(async () => {}),
        },
        activity: {
          log: activityLog,
        },
      },
    });

    await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 2 });

    assert.equal(activityLog.mock.calls.length, 1);
    const logArgs = activityLog.mock.calls[0].arguments[0];
    assert.equal(logArgs.type, 'poll-voted');
    assert.equal(logArgs.detail, 'East lot'); // options[2]
  });

  // ── Option index out of bounds ────────────────────────────────────
  test('returns 400 when optionIndex is out of bounds', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })), // 3 options: indices 0-2
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 3 });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.match(res.body.error.message, /Invalid option index/i);
  });

  test('returns 400 when optionIndex equals options length', async () => {
    const pollWith2Options = { ...DEFAULT_POLL, options: ['A', 'B'] };
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => pollWith2Options),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 2 });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  // ── Poll not found ────────────────────────────────────────────────
  test('returns 404 when poll does not exist', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-missing/vote')
      .send({ optionIndex: 0 });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Poll belongs to different crew ────────────────────────────────
  test('returns 404 when poll belongs to a different crew', async () => {
    const otherCrewPoll = { ...DEFAULT_POLL, crew_id: 'crew-other' };
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => otherCrewPoll),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Duplicate vote (store throws) ─────────────────────────────────
  test('returns 500 when store.vote throws (e.g. duplicate vote)', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })),
          vote: mock.fn(async () => { throw new Error('duplicate key violation'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  DELETE /:crewId/polls/:pollId — Close a poll
// =====================================================================
describe('routes/crew-polls.js — DELETE /:crewId/polls/:pollId', () => {

  // ── Happy path: creator closes poll ───────────────────────────────
  test('creator can close their own poll', async () => {
    const closeFn = mock.fn(async () => ({ ...DEFAULT_POLL, closed_at: new Date().toISOString() }));
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL, created_by: 'user-1' })),
          close: closeFn,
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.ok(res.body.data.closed);
    assert.equal(closeFn.mock.calls.length, 1);
    assert.equal(closeFn.mock.calls[0].arguments[0], 'poll-1');
  });

  // ── Happy path: owner closes any poll ─────────────────────────────
  test('crew owner can close any poll regardless of creator', async () => {
    const closeFn = mock.fn(async () => ({ ...DEFAULT_POLL, closed_at: new Date().toISOString() }));
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL, created_by: 'other-user' })),
          close: closeFn,
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(closeFn.mock.calls.length, 1);
  });

  // ── Socket.IO broadcast ───────────────────────────────────────────
  test('broadcasts crew:poll-closed via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = buildPollApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })),
          close: mock.fn(async () => ({ ...DEFAULT_POLL, closed_at: new Date().toISOString() })),
        },
      },
    });

    await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(ioObj.to.mock.calls[0].arguments[0], 'crew:crew-1');
    assert.equal(ioObj._emit.mock.calls[0].arguments[0], 'crew:poll-closed');
    assert.deepEqual(ioObj._emit.mock.calls[0].arguments[1], { pollId: 'poll-1' });
  });

  // ── Permission: regular member cannot close another's poll ────────
  test('returns 403 when non-owner member tries to close another users poll', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL, created_by: 'other-user' })),
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Only creator or owner/i);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Poll not found ────────────────────────────────────────────────
  test('returns 404 when poll does not exist', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        polls: {
          getById: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-missing');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Poll belongs to different crew ────────────────────────────────
  test('returns 404 when poll belongs to a different crew', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL, crew_id: 'crew-other' })),
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })),
          close: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  Rate limiting
// =====================================================================
describe('routes/crew-polls.js — rate limiting', () => {

  test('applies rate limit to GET /:crewId/polls', async () => {
    const rateLimitCalls = [];
    const { app } = buildPollApp({
      rateLimit: (max, key) => {
        rateLimitCalls.push({ max, key });
        return (_req, _res, next) => next();
      },
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    await request(app).get('/crew-1/polls');

    const limit = rateLimitCalls.find((c) => c.key === 'crew-poll-list');
    assert.ok(limit, 'crew-poll-list rate limit should be applied');
    assert.equal(limit.max, 120);
  });

  test('applies rate limit to POST /:crewId/polls', async () => {
    const rateLimitCalls = [];
    const { app } = buildPollApp({
      rateLimit: (max, key) => {
        rateLimitCalls.push({ max, key });
        return (_req, _res, next) => next();
      },
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Test?', options: ['A', 'B'] });

    const limit = rateLimitCalls.find((c) => c.key === 'crew-poll-create');
    assert.ok(limit, 'crew-poll-create rate limit should be applied');
    assert.equal(limit.max, 10);
  });

  test('applies rate limit to POST /:crewId/polls/:pollId/vote', async () => {
    const rateLimitCalls = [];
    const { app } = buildPollApp({
      rateLimit: (max, key) => {
        rateLimitCalls.push({ max, key });
        return (_req, _res, next) => next();
      },
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 });

    const limit = rateLimitCalls.find((c) => c.key === 'crew-poll-vote');
    assert.ok(limit, 'crew-poll-vote rate limit should be applied');
    assert.equal(limit.max, 60);
  });

  test('applies rate limit to DELETE /:crewId/polls/:pollId', async () => {
    const rateLimitCalls = [];
    const { app } = buildPollApp({
      rateLimit: (max, key) => {
        rateLimitCalls.push({ max, key });
        return (_req, _res, next) => next();
      },
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    await request(app).delete('/crew-1/polls/poll-1');

    const limit = rateLimitCalls.find((c) => c.key === 'crew-poll-delete');
    assert.ok(limit, 'crew-poll-delete rate limit should be applied');
    assert.equal(limit.max, 10);
  });
});
