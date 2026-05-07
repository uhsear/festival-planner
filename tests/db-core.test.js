'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { withTransaction, parseJsonObject, serializeJson, openPlannerDatabase } = require('../lib/db/connection');
const createUtils = require('../lib/db/utils');
const { createStores, createDbLatencyTracker } = require('../lib/db/index');

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockPool(queryResults = []) {
  let callIndex = 0;
  const queries = [];
  const released = [];
  return {
    queries,
    released,
    query: async (sql, params) => {
      queries.push({ sql, params });
      const result = queryResults[callIndex] || { rows: [], rowCount: 0 };
      callIndex++;
      return result;
    },
    connect: async () => {
      const clientQueries = [];
      const client = {
        queries: clientQueries,
        query: async (sql, params) => {
          queries.push({ sql, params });
          clientQueries.push({ sql, params });
          const result = queryResults[callIndex] || { rows: [], rowCount: 0 };
          callIndex++;
          return result;
        },
        release: () => { released.push(true); },
      };
      return client;
    },
  };
}

function mockPoolThatFailsOnQuery(failOn) {
  const queries = [];
  const released = [];
  return {
    queries,
    released,
    connect: async () => {
      const client = {
        query: async (sql, params) => {
          queries.push({ sql, params });
          if (typeof failOn === 'function' && failOn(sql)) {
            throw new Error(`Query failed: ${sql}`);
          }
          return { rows: [], rowCount: 0 };
        },
        release: () => { released.push(true); },
      };
      return client;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// connection.js — withTransaction
// ═══════════════════════════════════════════════════════════════════════════

describe('withTransaction', () => {
  it('runs BEGIN, callback, COMMIT on success', async () => {
    const pool = mockPool();
    const result = await withTransaction(pool, async (client) => {
      await client.query('SELECT 1');
      return 'ok';
    });

    assert.equal(result, 'ok');
    assert.equal(pool.queries[0].sql, 'BEGIN');
    assert.equal(pool.queries[1].sql, 'SELECT 1');
    assert.equal(pool.queries[2].sql, 'COMMIT');
  });

  it('runs BEGIN, callback, ROLLBACK on error', async () => {
    const pool = mockPool();
    await assert.rejects(
      () => withTransaction(pool, async () => { throw new Error('boom'); }),
      { message: 'boom' },
    );

    assert.equal(pool.queries[0].sql, 'BEGIN');
    assert.equal(pool.queries[1].sql, 'ROLLBACK');
  });

  it('always releases the client on success', async () => {
    const pool = mockPool();
    await withTransaction(pool, async () => 'done');
    assert.equal(pool.released.length, 1);
  });

  it('always releases the client on error', async () => {
    const pool = mockPool();
    await assert.rejects(
      () => withTransaction(pool, async () => { throw new Error('fail'); }),
    );
    assert.equal(pool.released.length, 1);
  });

  it('returns the callback result', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 }, // BEGIN
      { rows: [{ id: 42 }], rowCount: 1 }, // callback query
      { rows: [], rowCount: 0 }, // COMMIT
    ]);

    const result = await withTransaction(pool, async (client) => {
      const res = await client.query('SELECT * FROM users WHERE id = $1', [42]);
      return res.rows[0];
    });

    assert.deepEqual(result, { id: 42 });
  });

  it('passes the client to the callback', async () => {
    const pool = mockPool();
    let receivedClient = null;
    await withTransaction(pool, async (client) => {
      receivedClient = client;
    });
    assert.ok(receivedClient);
    assert.equal(typeof receivedClient.query, 'function');
    assert.equal(typeof receivedClient.release, 'function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// connection.js — parseJsonObject
// ═══════════════════════════════════════════════════════════════════════════

describe('parseJsonObject', () => {
  it('returns fallback for null', () => {
    assert.deepEqual(parseJsonObject(null), {});
  });

  it('returns fallback for undefined', () => {
    assert.deepEqual(parseJsonObject(undefined), {});
  });

  it('returns fallback for empty string', () => {
    assert.deepEqual(parseJsonObject(''), {});
  });

  it('returns custom fallback when value is falsy', () => {
    assert.deepEqual(parseJsonObject(null, { default: true }), { default: true });
  });

  it('returns objects directly (JSONB behavior)', () => {
    const obj = { foo: 'bar' };
    assert.equal(parseJsonObject(obj), obj);
  });

  it('returns arrays directly (JSONB behavior)', () => {
    const arr = [1, 2, 3];
    assert.equal(parseJsonObject(arr), arr);
  });

  it('parses valid JSON strings into objects', () => {
    const result = parseJsonObject('{"a":1}');
    assert.deepEqual(result, { a: 1 });
  });

  it('parses valid JSON array strings', () => {
    const result = parseJsonObject('[1,2,3]');
    assert.deepEqual(result, [1, 2, 3]);
  });

  it('returns fallback for invalid JSON strings', () => {
    assert.deepEqual(parseJsonObject('not-json'), {});
  });

  it('returns fallback when JSON parses to a non-object (number)', () => {
    assert.deepEqual(parseJsonObject('42'), {});
  });

  it('returns fallback when JSON parses to a non-object (string)', () => {
    assert.deepEqual(parseJsonObject('"hello"'), {});
  });

  it('returns fallback when JSON parses to a boolean', () => {
    assert.deepEqual(parseJsonObject('true'), {});
  });

  it('caches parsed results for repeated string lookups', () => {
    const json = '{"cached":"yes_test_unique"}';
    const first = parseJsonObject(json);
    const second = parseJsonObject(json);
    assert.deepEqual(first, second);
    // Both should be the exact same reference from cache
    assert.equal(first, second);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// connection.js — serializeJson
// ═══════════════════════════════════════════════════════════════════════════

describe('serializeJson', () => {
  it('serializes an object to JSON', () => {
    assert.equal(serializeJson({ a: 1 }), '{"a":1}');
  });

  it('serializes an array to JSON', () => {
    assert.equal(serializeJson([1, 2]), '[1,2]');
  });

  it('uses fallback for null', () => {
    assert.equal(serializeJson(null), '{}');
  });

  it('uses fallback for undefined', () => {
    assert.equal(serializeJson(undefined), '{}');
  });

  it('uses custom fallback for null', () => {
    assert.equal(serializeJson(null, []), '[]');
  });

  it('serializes zero and false (they are not nullish)', () => {
    assert.equal(serializeJson(0), '0');
    assert.equal(serializeJson(false), 'false');
  });

  it('serializes empty string (not nullish)', () => {
    assert.equal(serializeJson(''), '""');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// utils.js — createUtils: toISOString
// ═══════════════════════════════════════════════════════════════════════════

describe('createUtils — toISOString', () => {
  const pool = mockPool();
  const utils = createUtils(pool);

  it('converts Date to ISO string', () => {
    const d = new Date('2026-01-15T12:00:00Z');
    assert.equal(utils.toISOString(d), '2026-01-15T12:00:00.000Z');
  });

  it('converts non-Date values to String', () => {
    assert.equal(utils.toISOString(12345), '12345');
    assert.equal(utils.toISOString('already-a-string'), 'already-a-string');
  });

  it('returns null for null', () => {
    assert.equal(utils.toISOString(null), null);
  });

  it('returns undefined for undefined', () => {
    assert.equal(utils.toISOString(undefined), undefined);
  });

  it('returns falsy value unchanged for empty string', () => {
    assert.equal(utils.toISOString(''), '');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// utils.js — createUtils: mapProfileRow
// ═══════════════════════════════════════════════════════════════════════════

describe('createUtils — mapProfileRow', () => {
  const pool = mockPool();
  const utils = createUtils(pool);

  it('maps a full profile row with Date objects', () => {
    const row = {
      id: 'p1',
      festivalId: 'f1',
      userId: 'u1',
      name: 'TestUser',
      picksJson: { s1: 'want' },
      notesJson: { s1: 'great set' },
      remindersJson: { s1: true },
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    const result = utils.mapProfileRow(row);

    assert.equal(result.id, 'p1');
    assert.equal(result.festivalId, 'f1');
    assert.equal(result.userId, 'u1');
    assert.equal(result.name, 'TestUser');
    assert.deepEqual(result.picks, { s1: 'want' });
    assert.deepEqual(result.notes, { s1: 'great set' });
    assert.deepEqual(result.reminders, { s1: true });
    assert.equal(result.createdAt, '2026-01-01T00:00:00.000Z');
    assert.equal(result.updatedAt, '2026-01-02T00:00:00.000Z');
  });

  it('defaults picks/notes/reminders to empty objects when null', () => {
    const row = {
      id: 'p2',
      festivalId: 'f2',
      userId: 'u2',
      name: 'Empty',
      picksJson: null,
      notesJson: null,
      remindersJson: null,
      createdAt: null,
      updatedAt: null,
    };
    const result = utils.mapProfileRow(row);
    assert.deepEqual(result.picks, {});
    assert.deepEqual(result.notes, {});
    assert.deepEqual(result.reminders, {});
  });

  it('handles JSON string values in picks/notes/reminders', () => {
    const row = {
      id: 'p3',
      festivalId: 'f3',
      userId: 'u3',
      name: 'Stringy',
      picksJson: '{"s1":"want_map_unique"}',
      notesJson: '{"s1":"note_map_unique"}',
      remindersJson: '{"s1":true}',
      createdAt: '2026-03-01',
      updatedAt: '2026-03-02',
    };
    const result = utils.mapProfileRow(row);
    assert.deepEqual(result.picks, { s1: 'want_map_unique' });
    assert.deepEqual(result.notes, { s1: 'note_map_unique' });
    assert.deepEqual(result.reminders, { s1: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// utils.js — createUtils: parseMessageRow
// ═══════════════════════════════════════════════════════════════════════════

describe('createUtils — parseMessageRow', () => {
  const pool = mockPool();
  const utils = createUtils(pool);

  it('maps a basic message row', () => {
    const row = {
      id: 'm1',
      festivalId: 'f1',
      userId: 'u1',
      username: 'alice',
      text: 'hello',
      timestamp: '2026-01-01T00:00:00Z',
    };
    const result = utils.parseMessageRow(row);
    assert.equal(result.id, 'm1');
    assert.equal(result.festivalId, 'f1');
    assert.equal(result.userId, 'u1');
    assert.equal(result.username, 'alice');
    assert.equal(result.text, 'hello');
    assert.equal(result.timestamp, '2026-01-01T00:00:00Z');
    assert.equal(result.reactions, undefined);
    assert.equal(result.sequence, undefined);
  });

  it('includes sequence when present', () => {
    const row = {
      id: 'm2',
      festivalId: 'f1',
      userId: 'u1',
      username: 'alice',
      text: 'hi',
      timestamp: '2026-01-01T00:00:00Z',
      sequence: 5,
    };
    const result = utils.parseMessageRow(row);
    assert.equal(result.sequence, 5);
  });

  it('includes sequence when zero', () => {
    const row = {
      id: 'm3',
      festivalId: 'f1',
      userId: 'u1',
      username: 'bob',
      text: 'first',
      timestamp: '2026-01-01T00:00:00Z',
      sequence: 0,
    };
    const result = utils.parseMessageRow(row);
    assert.equal(result.sequence, 0);
  });

  it('omits sequence when null', () => {
    const row = {
      id: 'm4',
      festivalId: 'f1',
      userId: null,
      username: 'system',
      text: 'joined',
      timestamp: '2026-01-01T00:00:00Z',
      sequence: null,
    };
    const result = utils.parseMessageRow(row);
    assert.equal('sequence' in result, false);
    assert.equal(result.userId, null);
  });

  it('parses reactions JSON and includes when non-empty', () => {
    const reactions = { '👍': ['u1', 'u2'] };
    const row = {
      id: 'm5',
      festivalId: 'f1',
      userId: 'u1',
      username: 'alice',
      text: 'cool',
      timestamp: '2026-01-01T00:00:00Z',
      reactionsJson: JSON.stringify(reactions),
    };
    const result = utils.parseMessageRow(row);
    assert.deepEqual(result.reactions, reactions);
  });

  it('omits reactions when reactionsJson is null', () => {
    const row = {
      id: 'm6',
      festivalId: 'f1',
      userId: 'u1',
      username: 'alice',
      text: 'test',
      timestamp: '2026-01-01T00:00:00Z',
      reactionsJson: null,
    };
    const result = utils.parseMessageRow(row);
    assert.equal(result.reactions, undefined);
  });

  it('omits reactions when reactionsJson is empty object', () => {
    const row = {
      id: 'm7',
      festivalId: 'f1',
      userId: 'u1',
      username: 'alice',
      text: 'test',
      timestamp: '2026-01-01T00:00:00Z',
      reactionsJson: '{}',
    };
    const result = utils.parseMessageRow(row);
    assert.equal(result.reactions, undefined);
  });

  it('handles invalid reactions JSON gracefully', () => {
    const row = {
      id: 'm8',
      festivalId: 'f1',
      userId: 'u1',
      username: 'alice',
      text: 'test',
      timestamp: '2026-01-01T00:00:00Z',
      reactionsJson: 'not-json',
    };
    const result = utils.parseMessageRow(row);
    // reactions should be null (parse failed), and since null is falsy, omitted
    assert.equal(result.reactions, undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// utils.js — createUtils: buildFestivalRecords
// ═══════════════════════════════════════════════════════════════════════════

describe('createUtils — buildFestivalRecords', () => {
  it('returns rows from the query', async () => {
    const fakeRows = [
      { id: 'f1', name: 'Coachella', stages: [], days: [] },
      { id: 'f2', name: 'Bonnaroo', stages: [], days: [] },
    ];
    const pool = mockPool([{ rows: fakeRows, rowCount: 2 }]);
    const utils = createUtils(pool);

    const result = await utils.buildFestivalRecords();
    assert.deepEqual(result, fakeRows);
    assert.equal(pool.queries.length, 1);
    assert.ok(pool.queries[0].sql.includes('FROM festivals f'));
  });

  it('returns empty array when no festivals exist', async () => {
    const pool = mockPool([{ rows: [], rowCount: 0 }]);
    const utils = createUtils(pool);

    const result = await utils.buildFestivalRecords();
    assert.deepEqual(result, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// index.js — createStores shape
// ═══════════════════════════════════════════════════════════════════════════

describe('createStores', () => {
  it('returns all expected store keys', () => {
    const pool = mockPool();
    const stores = createStores(pool);

    const expectedKeys = [
      'pool',
      'users',
      'festivals',
      'profiles',
      'picks',
      'sessions',
      'deviceTokens',
      'notificationPrefs',
      'notificationLog',
      'notificationCounts',
      'topicSubscriptions',
      'crews',
      'auditLog',
      'roles',
      'polls',
      'ratings',
      'expenses',
      'activity',
      'calendarTokens',
      'refreshTokens',
      'loginFailures',
      'metricsRollups',
      'counts',
      'createCleanupTimer',
    ];

    for (const key of expectedKeys) {
      assert.ok(key in stores, `missing store key: ${key}`);
    }
  });

  it('exposes the pool reference directly', () => {
    const pool = mockPool();
    const stores = createStores(pool);
    assert.equal(stores.pool, pool);
  });

  it('counts returns festival and session counts', async () => {
    const pool = mockPool([
      // First query: festival count
      { rows: [{ count: '3' }], rowCount: 1 },
      // Second query: session count (called by sessions.counts())
      { rows: [{ count: '7' }], rowCount: 1 },
    ]);
    const stores = createStores(pool);
    const result = await stores.counts();

    assert.equal(result.festivals, 3);
    assert.equal(typeof result.userSessions, 'number');
  });

  it('createCleanupTimer returns an async function', () => {
    const pool = mockPool();
    const stores = createStores(pool);
    const cleanup = stores.createCleanupTimer();
    assert.equal(typeof cleanup, 'function');
  });

  it('createCleanupTimer runs without error when leader', async () => {
    const pool = mockPool();
    const stores = createStores(pool);
    const cleanup = stores.createCleanupTimer();
    // Cleanup calls deleteExpired, deleteExpiredUserSessions, etc.
    // These will call pool.query which returns empty results — should not throw
    await assert.doesNotReject(() => cleanup());
  });

  it('createCleanupTimer returns no-op when not leader', async () => {
    const saved = process.env.NODE_APP_INSTANCE;
    process.env.NODE_APP_INSTANCE = '2';
    try {
      const pool = mockPool();
      const stores = createStores(pool);
      const cleanup = stores.createCleanupTimer();
      // Should be a no-op — no queries executed
      const queriesBefore = pool.queries.length;
      await cleanup();
      assert.equal(pool.queries.length, queriesBefore);
    } finally {
      if (saved !== undefined) process.env.NODE_APP_INSTANCE = saved;
      else delete process.env.NODE_APP_INSTANCE;
    }
  });

  it('stores have object-typed values for all data stores', () => {
    const pool = mockPool();
    const stores = createStores(pool);

    const objectStores = [
      'users', 'festivals', 'profiles', 'picks',
      'sessions', 'crews', 'auditLog', 'roles', 'polls',
      'ratings', 'expenses', 'activity', 'calendarTokens',
      'deviceTokens', 'notificationPrefs', 'notificationLog',
      'notificationCounts', 'topicSubscriptions',
      'refreshTokens', 'loginFailures', 'metricsRollups',
    ];

    for (const key of objectStores) {
      assert.equal(typeof stores[key], 'object', `${key} should be an object`);
      assert.notEqual(stores[key], null, `${key} should not be null`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// index.js — isCleanupLeader via createCleanupTimer behavior
// ═══════════════════════════════════════════════════════════════════════════

describe('isCleanupLeader (via createCleanupTimer)', () => {
  it('treats unset NODE_APP_INSTANCE as leader', async () => {
    const saved = process.env.NODE_APP_INSTANCE;
    delete process.env.NODE_APP_INSTANCE;
    try {
      const pool = mockPool();
      const stores = createStores(pool);
      const cleanup = stores.createCleanupTimer();
      // Leader path runs real cleanup (queries the db)
      await cleanup();
      assert.ok(pool.queries.length > 0, 'leader should issue queries');
    } finally {
      if (saved !== undefined) process.env.NODE_APP_INSTANCE = saved;
      else delete process.env.NODE_APP_INSTANCE;
    }
  });

  it('treats instance 0 as leader', async () => {
    const saved = process.env.NODE_APP_INSTANCE;
    process.env.NODE_APP_INSTANCE = '0';
    try {
      const pool = mockPool();
      const stores = createStores(pool);
      const cleanup = stores.createCleanupTimer();
      await cleanup();
      assert.ok(pool.queries.length > 0, 'instance 0 should issue queries');
    } finally {
      if (saved !== undefined) process.env.NODE_APP_INSTANCE = saved;
      else delete process.env.NODE_APP_INSTANCE;
    }
  });

  it('treats instance 1 as follower (no-op)', async () => {
    const saved = process.env.NODE_APP_INSTANCE;
    process.env.NODE_APP_INSTANCE = '1';
    try {
      const pool = mockPool();
      const stores = createStores(pool);
      const queriesBefore = pool.queries.length;
      const cleanup = stores.createCleanupTimer();
      await cleanup();
      assert.equal(pool.queries.length, queriesBefore, 'follower should not issue queries');
    } finally {
      if (saved !== undefined) process.env.NODE_APP_INSTANCE = saved;
      else delete process.env.NODE_APP_INSTANCE;
    }
  });

  it('treats empty string NODE_APP_INSTANCE as leader', async () => {
    const saved = process.env.NODE_APP_INSTANCE;
    process.env.NODE_APP_INSTANCE = '';
    try {
      const pool = mockPool();
      const stores = createStores(pool);
      const cleanup = stores.createCleanupTimer();
      await cleanup();
      assert.ok(pool.queries.length > 0, 'empty string should be treated as leader');
    } finally {
      if (saved !== undefined) process.env.NODE_APP_INSTANCE = saved;
      else delete process.env.NODE_APP_INSTANCE;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// index.js — re-exports
// ═══════════════════════════════════════════════════════════════════════════

describe('db/index re-exports', () => {
  it('re-exports parseJsonObject from connection', () => {
    const indexExports = require('../lib/db/index');
    assert.equal(typeof indexExports.parseJsonObject, 'function');
    assert.equal(indexExports.parseJsonObject, parseJsonObject);
  });

  it('re-exports serializeJson from connection', () => {
    const indexExports = require('../lib/db/index');
    assert.equal(typeof indexExports.serializeJson, 'function');
    assert.equal(indexExports.serializeJson, serializeJson);
  });

  it('re-exports withTransaction from connection', () => {
    const indexExports = require('../lib/db/index');
    assert.equal(typeof indexExports.withTransaction, 'function');
    assert.equal(indexExports.withTransaction, withTransaction);
  });

  it('re-exports openPlannerDatabase from connection', () => {
    const indexExports = require('../lib/db/index');
    assert.equal(typeof indexExports.openPlannerDatabase, 'function');
  });

  it('re-exports createDbLatencyTracker from latency', () => {
    const indexExports = require('../lib/db/index');
    assert.equal(typeof indexExports.createDbLatencyTracker, 'function');
    assert.equal(indexExports.createDbLatencyTracker, createDbLatencyTracker);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// latency.js — createDbLatencyTracker
// ═══════════════════════════════════════════════════════════════════════════

describe('createDbLatencyTracker', () => {
  it('returns stats object and wrapStore function', () => {
    const tracker = createDbLatencyTracker();
    assert.equal(typeof tracker.stats, 'object');
    assert.equal(typeof tracker.wrapStore, 'function');
  });

  it('wraps store functions to track latency', async () => {
    const tracker = createDbLatencyTracker();
    const store = {
      findById: async (id) => ({ id, name: 'test' }),
      name: 'users',
    };
    const wrapped = tracker.wrapStore('users', store);

    const result = await wrapped.findById(42);
    assert.deepEqual(result, { id: 42, name: 'test' });
    assert.ok(tracker.stats['users.findById']);
    assert.equal(tracker.stats['users.findById'].count, 1);
    assert.ok(tracker.stats['users.findById'].totalMs >= 0);
  });

  it('preserves non-function properties on wrapped stores', () => {
    const tracker = createDbLatencyTracker();
    const store = {
      findById: async () => null,
      tableName: 'users',
      version: 2,
    };
    const wrapped = tracker.wrapStore('test', store);
    assert.equal(wrapped.tableName, 'users');
    assert.equal(wrapped.version, 2);
  });

  it('tracks max duration across multiple calls', async () => {
    const tracker = createDbLatencyTracker();
    const store = { op: async () => 'ok' };
    const wrapped = tracker.wrapStore('s', store);

    await wrapped.op();
    await wrapped.op();
    await wrapped.op();

    assert.equal(tracker.stats['s.op'].count, 3);
    assert.ok(tracker.stats['s.op'].maxMs >= 0);
  });
});
