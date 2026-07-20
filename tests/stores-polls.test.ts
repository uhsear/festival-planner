import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Helper: mock pool factory (same pattern as stores-festivals-lib-misc.test.js)
// ---------------------------------------------------------------------------
function makePool(queryResults: any[] = []) {
  let callIdx = 0;
  return {
    query: mock.fn(async () => {
      const result = queryResults[callIdx] || { rows: [] };
      callIdx++;
      return result;
    }),
  };
}

// ---------------------------------------------------------------------------
// lib/db/stores/polls.js — createPollsStore
// ---------------------------------------------------------------------------
describe('lib/db/stores/polls.js', () => {
  let createPollsStore: any;

  beforeEach(async () => {
    const mod = await import('../lib/db/stores/polls.js');
    createPollsStore = mod.default;
  });

  // =========================================================================
  // create()
  // =========================================================================
  describe('create', () => {
    it('inserts a poll and returns the created row', async () => {
      const createdRow = {
        id: 'poll-abc',
        crew_id: 'crew-1',
        created_by: 'user-1',
        question: 'Which stage first?',
        options: '["Main","Side"]',
        closes_at: '2026-06-01T20:00:00Z',
        closed: false,
        created_at: '2026-05-08T12:00:00Z',
      };
      const pool = makePool([{ rows: [createdRow] }]);
      const store = createPollsStore(pool);

      const result = await store.create({
        crewId: 'crew-1',
        createdBy: 'user-1',
        question: 'Which stage first?',
        options: ['Main', 'Side'],
        closesAt: '2026-06-01T20:00:00Z',
      });

      assert.deepStrictEqual(result, createdRow);
      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]!;
      assert.ok((call.arguments as any[])[0].includes('INSERT INTO crew_polls'));
      assert.ok((call.arguments as any[])[0].includes('RETURNING'));
      // Verify params: [id, crewId, createdBy, question, JSON.stringify(options), closesAt]
      const params = (call.arguments as any[])[1];
      assert.ok(params[0].startsWith('poll-'), 'id should start with poll-');
      assert.strictEqual(params[1], 'crew-1');
      assert.strictEqual(params[2], 'user-1');
      assert.strictEqual(params[3], 'Which stage first?');
      assert.strictEqual(params[4], '["Main","Side"]');
      assert.strictEqual(params[5], '2026-06-01T20:00:00Z');
    });

    it('generates a unique poll id with poll- prefix', async () => {
      const pool = makePool([{ rows: [{ id: 'poll-generated' }] }]);
      const store = createPollsStore(pool);

      await store.create({
        crewId: 'crew-1',
        createdBy: 'user-1',
        question: 'Q?',
        options: ['A', 'B'],
        closesAt: null,
      });

      const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
      assert.ok(params[0].startsWith('poll-'));
      assert.ok(params[0].length > 5, 'id should include a UUID after the prefix');
    });

    it('passes null closesAt when not provided', async () => {
      const pool = makePool([{ rows: [{ id: 'poll-1' }] }]);
      const store = createPollsStore(pool);

      await store.create({
        crewId: 'crew-1',
        createdBy: 'user-1',
        question: 'Q?',
        options: ['Yes', 'No'],
        closesAt: null,
      });

      const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
      assert.strictEqual(params[5], null);
    });

    it('returns undefined when INSERT returns no rows', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createPollsStore(pool);

      const result = await store.create({
        crewId: 'crew-1',
        createdBy: 'user-1',
        question: 'Q?',
        options: ['A'],
        closesAt: null,
      });

      assert.strictEqual(result, undefined);
    });
  });

  // =========================================================================
  // listByCrew()
  // =========================================================================
  describe('listByCrew', () => {
    it('returns polls for a crew with parsed options and votes', async () => {
      const rows = [
        {
          id: 'poll-1',
          crew_id: 'crew-1',
          question: 'Where to meet?',
          options: '["Gate A","Gate B"]',
          vote_count: '2',
          votes: [
            { option: 0, user_id: 'u1' },
            { option: 1, user_id: 'u2' },
          ],
          closed: false,
          created_at: '2026-05-08T10:00:00Z',
        },
      ];
      const pool = makePool([{ rows }]);
      const store = createPollsStore(pool);

      const result = await store.listByCrew('crew-1');

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, 'poll-1');
      // votes are already an array, should pass through
      assert.ok(Array.isArray(result[0].votes));
      assert.strictEqual(result[0].votes.length, 2);
      // options parsed from JSON string
      assert.deepStrictEqual(result[0].options, ['Gate A', 'Gate B']);

      // Verify SQL query
      const sql = (pool.query.mock.calls[0]!.arguments as any[])[0];
      assert.ok(sql.includes('crew_polls'));
      assert.ok(sql.includes('crew_poll_votes'));
      assert.ok(sql.includes('LEFT JOIN'));
      assert.deepStrictEqual((pool.query.mock.calls[0]!.arguments as any[])[1], ['crew-1']);
    });

    it('returns empty array when crew has no active polls', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createPollsStore(pool);

      const result = await store.listByCrew('crew-empty');

      assert.deepStrictEqual(result, []);
      assert.deepStrictEqual((pool.query.mock.calls[0]!.arguments as any[])[1], ['crew-empty']);
    });

    it('parses options from JSON string via safeParseJson', async () => {
      const rows = [
        {
          id: 'poll-json',
          crew_id: 'crew-1',
          question: 'Pick one',
          options: '["Alpha","Beta","Gamma"]',
          votes: '[]',
          vote_count: '0',
          closed: false,
          created_at: '2026-05-08T10:00:00Z',
        },
      ];
      const pool = makePool([{ rows }]);
      const store = createPollsStore(pool);

      const result = await store.listByCrew('crew-1');

      assert.deepStrictEqual(result[0].options, ['Alpha', 'Beta', 'Gamma']);
      assert.deepStrictEqual(result[0].votes, []);
    });

    it('falls back to empty array when options is invalid JSON', async () => {
      const rows = [
        {
          id: 'poll-bad',
          crew_id: 'crew-1',
          question: 'Bad data',
          options: 'not-json',
          votes: 'not-json-either',
          vote_count: '0',
          closed: false,
          created_at: '2026-05-08T10:00:00Z',
        },
      ];
      const pool = makePool([{ rows }]);
      const store = createPollsStore(pool);

      const result = await store.listByCrew('crew-1');

      assert.deepStrictEqual(result[0].options, []);
      assert.deepStrictEqual(result[0].votes, []);
    });

    it('passes through options and votes when already arrays', async () => {
      const rows = [
        {
          id: 'poll-arr',
          crew_id: 'crew-1',
          question: 'Array data',
          options: ['X', 'Y'],
          votes: [{ option: 0, user_id: 'u1' }],
          vote_count: '1',
          closed: false,
          created_at: '2026-05-08T10:00:00Z',
        },
      ];
      const pool = makePool([{ rows }]);
      const store = createPollsStore(pool);

      const result = await store.listByCrew('crew-1');

      assert.deepStrictEqual(result[0].options, ['X', 'Y']);
      assert.deepStrictEqual(result[0].votes, [{ option: 0, user_id: 'u1' }]);
    });

    it('returns multiple polls ordered by query results', async () => {
      const rows = [
        { id: 'poll-2', crew_id: 'crew-1', question: 'Q2', options: '["A"]', votes: '[]', vote_count: '0', closed: false, created_at: '2026-05-08T11:00:00Z' },
        { id: 'poll-1', crew_id: 'crew-1', question: 'Q1', options: '["B"]', votes: '[]', vote_count: '0', closed: false, created_at: '2026-05-08T10:00:00Z' },
      ];
      const pool = makePool([{ rows }]);
      const store = createPollsStore(pool);

      const result = await store.listByCrew('crew-1');

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, 'poll-2');
      assert.strictEqual(result[1].id, 'poll-1');
    });
  });

  // =========================================================================
  // vote()
  // =========================================================================
  describe('vote', () => {
    it('inserts a vote and returns the created row', async () => {
      const voteRow = {
        poll_id: 'poll-1',
        user_id: 'user-1',
        option_index: 0,
        voted_at: '2026-05-08T12:00:00Z',
      };
      const pool = makePool([{ rows: [voteRow] }]);
      const store = createPollsStore(pool);

      const result = await store.vote('poll-1', 'user-1', 0);

      assert.deepStrictEqual(result, voteRow);
      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]!;
      assert.ok((call.arguments as any[])[0].includes('INSERT INTO crew_poll_votes'));
      assert.deepStrictEqual((call.arguments as any[])[1], ['poll-1', 'user-1', 0]);
    });

    it('handles duplicate vote via ON CONFLICT upsert', async () => {
      const updatedVote = {
        poll_id: 'poll-1',
        user_id: 'user-1',
        option_index: 2,
        voted_at: '2026-05-08T13:00:00Z',
      };
      const pool = makePool([{ rows: [updatedVote] }]);
      const store = createPollsStore(pool);

      const result = await store.vote('poll-1', 'user-1', 2);

      assert.deepStrictEqual(result, updatedVote);
      // Verify the SQL uses ON CONFLICT ... DO UPDATE
      const sql = (pool.query.mock.calls[0]!.arguments as any[])[0];
      assert.ok(sql.includes('ON CONFLICT'));
      assert.ok(sql.includes('DO UPDATE SET'));
      assert.ok(sql.includes('option_index'));
    });

    it('passes correct parameters to the query', async () => {
      const pool = makePool([{ rows: [{ poll_id: 'p', user_id: 'u', option_index: 3 }] }]);
      const store = createPollsStore(pool);

      await store.vote('poll-99', 'user-42', 3);

      const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
      assert.strictEqual(params[0], 'poll-99');
      assert.strictEqual(params[1], 'user-42');
      assert.strictEqual(params[2], 3);
    });

    it('returns undefined when no row is returned', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createPollsStore(pool);

      const result = await store.vote('poll-x', 'user-x', 0);

      assert.strictEqual(result, undefined);
    });
  });

  // =========================================================================
  // getResults()
  // =========================================================================
  describe('getResults', () => {
    it('returns poll with aggregated votes', async () => {
      const row = {
        id: 'poll-1',
        crew_id: 'crew-1',
        question: 'Best set?',
        options: '["Set A","Set B"]',
        votes: [
          { option_index: 0, user_id: 'u1', username: 'alice' },
          { option_index: 1, user_id: 'u2', username: 'bob' },
        ],
        closed: false,
        created_at: '2026-05-08T10:00:00Z',
      };
      const pool = makePool([{ rows: [row] }]);
      const store = createPollsStore(pool);

      const result = await store.getResults('poll-1');

      assert.strictEqual(result.id, 'poll-1');
      assert.deepStrictEqual(result.options, ['Set A', 'Set B']);
      assert.ok(Array.isArray(result.votes));
      assert.strictEqual(result.votes.length, 2);
      assert.deepStrictEqual((pool.query.mock.calls[0]!.arguments as any[])[1], ['poll-1']);
    });

    it('returns null when poll is not found', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createPollsStore(pool);

      const result = await store.getResults('nonexistent');

      assert.strictEqual(result, null);
    });

    it('parses options from JSON string', async () => {
      const row = {
        id: 'poll-json',
        options: '["X","Y","Z"]',
        votes: null,
      };
      const pool = makePool([{ rows: [row] }]);
      const store = createPollsStore(pool);

      const result = await store.getResults('poll-json');

      assert.deepStrictEqual(result.options, ['X', 'Y', 'Z']);
    });

    it('falls back to empty array when options is invalid JSON', async () => {
      const row = {
        id: 'poll-bad',
        options: '{broken',
        votes: '{also-broken',
      };
      const pool = makePool([{ rows: [row] }]);
      const store = createPollsStore(pool);

      const result = await store.getResults('poll-bad');

      assert.deepStrictEqual(result.options, []);
      assert.deepStrictEqual(result.votes, []);
    });

    it('passes through options and votes when already arrays', async () => {
      const row = {
        id: 'poll-arr',
        options: ['A', 'B'],
        votes: [{ option_index: 0, user_id: 'u1', username: 'alice' }],
      };
      const pool = makePool([{ rows: [row] }]);
      const store = createPollsStore(pool);

      const result = await store.getResults('poll-arr');

      assert.deepStrictEqual(result.options, ['A', 'B']);
      assert.deepStrictEqual(result.votes, [{ option_index: 0, user_id: 'u1', username: 'alice' }]);
    });

    it('returns votes as empty array when FILTER excludes all (null from json_agg)', async () => {
      const row = {
        id: 'poll-no-votes',
        options: '["A"]',
        votes: null,
      };
      const pool = makePool([{ rows: [row] }]);
      const store = createPollsStore(pool);

      const result = await store.getResults('poll-no-votes');

      // null is not an array and not a string, safeParseJson returns it as-is
      // Actually: safeParseJson(null, []) returns [] because value == null check
      assert.deepStrictEqual(result.votes, []);
    });

    it('joins with users table for username resolution', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createPollsStore(pool);

      await store.getResults('poll-1');

      const sql = (pool.query.mock.calls[0]!.arguments as any[])[0];
      assert.ok(sql.includes('LEFT JOIN users u'));
      assert.ok(sql.includes('u.deleted_at IS NULL'));
    });
  });

  // =========================================================================
  // close()
  // =========================================================================
  describe('close', () => {
    it('marks a poll as closed and returns the updated row', async () => {
      const closedRow = {
        id: 'poll-1',
        crew_id: 'crew-1',
        created_by: 'user-1',
        question: 'Q?',
        options: '["A","B"]',
        closes_at: null,
        closed: true,
        created_at: '2026-05-08T10:00:00Z',
      };
      const pool = makePool([{ rows: [closedRow] }]);
      const store = createPollsStore(pool);

      const result = await store.close('poll-1');

      assert.deepStrictEqual(result, closedRow);
      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]!;
      assert.ok((call.arguments as any[])[0].includes('UPDATE crew_polls'));
      assert.ok((call.arguments as any[])[0].includes('closed = TRUE'));
      assert.ok((call.arguments as any[])[0].includes('RETURNING'));
      assert.deepStrictEqual((call.arguments as any[])[1], ['poll-1']);
    });

    it('returns undefined when poll does not exist', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createPollsStore(pool);

      const result = await store.close('nonexistent');

      assert.strictEqual(result, undefined);
    });
  });

  // =========================================================================
  // countActiveByCrew()
  // =========================================================================
  describe('countActiveByCrew', () => {
    it('returns the count of active polls for a crew', async () => {
      const pool = makePool([{ rows: [{ count: '3' }] }]);
      const store = createPollsStore(pool);

      const result = await store.countActiveByCrew('crew-1');

      assert.strictEqual(result, '3');
      const call = pool.query.mock.calls[0]!;
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const sql = norm((call.arguments as any[])[0]);
      assert.ok(sql.includes('SELECT COUNT(*)'));
      assert.ok(sql.includes('closed = FALSE'));
      assert.deepStrictEqual((call.arguments as any[])[1], ['crew-1']);
    });

    it('returns 0 when crew has no active polls', async () => {
      const pool = makePool([{ rows: [{ count: '0' }] }]);
      const store = createPollsStore(pool);

      const result = await store.countActiveByCrew('crew-empty');

      assert.strictEqual(result, '0');
    });

    it('excludes expired-but-unclosed polls, mirroring listByCrew (polls.ts:39)', async () => {
      const pool = makePool([{ rows: [{ count: '0' }] }]);
      const store = createPollsStore(pool);

      await store.countActiveByCrew('crew-1');

      const call = pool.query.mock.calls[0]!;
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const sql = norm((call.arguments as any[])[0]);
      assert.ok(
        /closes_at\s+IS\s+NULL\s+OR\s+closes_at\s*>\s*NOW\(\)/i.test(sql),
        'countActiveByCrew must exclude expired polls the same way listByCrew does',
      );
    });
  });

  // =========================================================================
  // getById()
  // =========================================================================
  describe('getById', () => {
    it('returns a poll by id with parsed options', async () => {
      const row = {
        id: 'poll-1',
        crew_id: 'crew-1',
        created_by: 'user-1',
        question: 'Q?',
        options: '["Option A","Option B"]',
        closes_at: null,
        closed: false,
        created_at: '2026-05-08T10:00:00Z',
      };
      const pool = makePool([{ rows: [row] }]);
      const store = createPollsStore(pool);

      const result = await store.getById('poll-1');

      assert.strictEqual(result.id, 'poll-1');
      assert.deepStrictEqual(result.options, ['Option A', 'Option B']);
      assert.deepStrictEqual((pool.query.mock.calls[0]!.arguments as any[])[1], ['poll-1']);
    });

    it('returns null when poll is not found', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createPollsStore(pool);

      const result = await store.getById('nonexistent');

      assert.strictEqual(result, null);
    });

    it('passes through options when already an array', async () => {
      const row = {
        id: 'poll-arr',
        crew_id: 'crew-1',
        created_by: 'user-1',
        question: 'Q?',
        options: ['Already', 'Parsed'],
        closes_at: null,
        closed: false,
        created_at: '2026-05-08T10:00:00Z',
      };
      const pool = makePool([{ rows: [row] }]);
      const store = createPollsStore(pool);

      const result = await store.getById('poll-arr');

      assert.deepStrictEqual(result.options, ['Already', 'Parsed']);
    });

    it('falls back to empty array when options is invalid JSON', async () => {
      const row = {
        id: 'poll-bad',
        crew_id: 'crew-1',
        created_by: 'user-1',
        question: 'Q?',
        options: '{{invalid',
        closes_at: null,
        closed: false,
        created_at: '2026-05-08T10:00:00Z',
      };
      const pool = makePool([{ rows: [row] }]);
      const store = createPollsStore(pool);

      const result = await store.getById('poll-bad');

      assert.deepStrictEqual(result.options, []);
    });
  });

  // =========================================================================
  // Edge cases: database errors
  // =========================================================================
  describe('database error handling', () => {
    it('create propagates database errors', async () => {
      const pool = {
        query: mock.fn(async () => { throw new Error('connection refused'); }),
      };
      const store = createPollsStore(pool);

      await assert.rejects(
        () => store.create({
          crewId: 'crew-1',
          createdBy: 'user-1',
          question: 'Q?',
          options: ['A'],
          closesAt: null,
        }),
        { message: 'connection refused' },
      );
    });

    it('listByCrew propagates database errors', async () => {
      const pool = {
        query: mock.fn(async () => { throw new Error('timeout'); }),
      };
      const store = createPollsStore(pool);

      await assert.rejects(
        () => store.listByCrew('crew-1'),
        { message: 'timeout' },
      );
    });

    it('vote propagates database errors', async () => {
      const pool = {
        query: mock.fn(async () => { throw new Error('deadlock detected'); }),
      };
      const store = createPollsStore(pool);

      await assert.rejects(
        () => store.vote('poll-1', 'user-1', 0),
        { message: 'deadlock detected' },
      );
    });

    it('getResults propagates database errors', async () => {
      const pool = {
        query: mock.fn(async () => { throw new Error('relation does not exist'); }),
      };
      const store = createPollsStore(pool);

      await assert.rejects(
        () => store.getResults('poll-1'),
        { message: 'relation does not exist' },
      );
    });

    it('close propagates database errors', async () => {
      const pool = {
        query: mock.fn(async () => { throw new Error('permission denied'); }),
      };
      const store = createPollsStore(pool);

      await assert.rejects(
        () => store.close('poll-1'),
        { message: 'permission denied' },
      );
    });

    it('countActiveByCrew propagates database errors', async () => {
      const pool = {
        query: mock.fn(async () => { throw new Error('disk full'); }),
      };
      const store = createPollsStore(pool);

      await assert.rejects(
        () => store.countActiveByCrew('crew-1'),
        { message: 'disk full' },
      );
    });

    it('getById propagates database errors', async () => {
      const pool = {
        query: mock.fn(async () => { throw new Error('SSL connection lost'); }),
      };
      const store = createPollsStore(pool);

      await assert.rejects(
        () => store.getById('poll-1'),
        { message: 'SSL connection lost' },
      );
    });
  });
});
