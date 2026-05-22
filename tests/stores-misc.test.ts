import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock pool factory
// ---------------------------------------------------------------------------
function mockPool(queryResults: any[] = []): any {
  let callIndex = 0;
  const queries: any[] = [];
  return {
    queries,
    query: async (sql: any, params: any) => {
      queries.push({ sql, params });
      const result = queryResults[callIndex] || { rows: [], rowCount: 0 };
      callIndex++;
      return result;
    },
    connect: async () => {
      const client = {
        query: async (sql: any, params: any) => {
          queries.push({ sql, params });
          const result = queryResults[callIndex] || { rows: [], rowCount: 0 };
          callIndex++;
          return result;
        },
        release: () => {},
      };
      return client;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
import { parseJsonObject } from '../lib/db/connection.js';

function mapProfileRow(row: any) {
  function toISOString(value: any) {
    if (!value) return value;
    return value instanceof Date ? value.toISOString() : String(value);
  }
  return {
    id: row.id,
    festivalId: row.festivalId,
    userId: row.userId,
    name: row.name,
    picks: parseJsonObject(row.picksJson, {}),
    notes: parseJsonObject(row.notesJson, {}),
    reminders: parseJsonObject(row.remindersJson, {}),
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
  };
}

const mockUtils = { mapProfileRow };

// ===========================================================================
// 1. Activity Store
// ===========================================================================
import { createActivityStore } from '../lib/db/stores/activity.js';

describe('ActivityStore', () => {
  describe('log()', () => {
    it('inserts a crew activity row with detail', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const store = createActivityStore(pool);
      await store.log({ crewId: 'c1', userId: 'u1', type: 'join', detail: 'joined crew' });

      assert.equal(pool.queries.length, 1);
      assert.ok(pool.queries[0].sql.includes('INSERT INTO crew_activity'));
      assert.equal(pool.queries[0].params[1], 'c1');
      assert.equal(pool.queries[0].params[2], 'u1');
      assert.equal(pool.queries[0].params[3], 'join');
      assert.equal(pool.queries[0].params[4], 'joined crew');
    });

    it('inserts null detail when not provided', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const store = createActivityStore(pool);
      await store.log({ crewId: 'c1', userId: 'u1', type: 'leave' });

      assert.equal(pool.queries[0].params[4], null);
    });

    it('generates a unique id for each entry', async () => {
      const pool = mockPool([
        { rows: [], rowCount: 1 },
        { rows: [], rowCount: 1 },
      ]);
      const store = createActivityStore(pool);
      await store.log({ crewId: 'c1', userId: 'u1', type: 'a' });
      await store.log({ crewId: 'c1', userId: 'u1', type: 'b' });

      const id1 = pool.queries[0].params[0];
      const id2 = pool.queries[1].params[0];
      assert.notEqual(id1, id2);
    });
  });

  describe('getByCrew()', () => {
    it('returns items without cursor', async () => {
      const rows = [
        { id: 'a1', crew_id: 'c1', username: 'alice' },
        { id: 'a2', crew_id: 'c1', username: 'bob' },
      ];
      const pool = mockPool([{ rows }]);
      const store = createActivityStore(pool);
      const result = await store.getByCrew('c1');

      assert.equal(result.items.length, 2);
      assert.equal(result.nextCursor, null);
      assert.equal(pool.queries[0].params[0], 'c1');
      assert.equal(pool.queries[0].params[1], 51); // limit + 1
    });

    it('supports cursor-based pagination', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createActivityStore(pool);
      await store.getByCrew('c1', { cursor: 'cur123', limit: 10 });

      assert.ok(pool.queries[0].sql.includes('AND a.id < $3'));
      assert.equal(pool.queries[0].params[2], 'cur123');
      assert.equal(pool.queries[0].params[1], 11); // limit + 1
    });

    it('pops extra row and returns nextCursor when hasMore', async () => {
      const rows = Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, crew_id: 'c1', username: 'u' }));
      const pool = mockPool([{ rows }]);
      const store = createActivityStore(pool);
      const result = await store.getByCrew('c1', { limit: 3 });

      assert.equal(result.items.length, 3);
      assert.equal(result.nextCursor, 'a2'); // last item after pop
    });
  });
});

// ===========================================================================
// 2. Audit Store
// ===========================================================================
import createAuditStore from '../lib/db/stores/audit.js';

describe('AuditStore', () => {
  describe('insert()', () => {
    it('inserts an audit entry with all fields', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const store = createAuditStore(pool, mockUtils);
      const id = await store.insert({
        action: 'login',
        actor_type: 'user',
        actor_id: 'u1',
        target_type: 'session',
        target_id: 's1',
        details_json: { browser: 'chrome' },
        ip: '1.2.3.4',
        user_agent: 'Mozilla/5.0',
        request_id: 'req1',
        status: 'success',
      });

      assert.ok(id);
      assert.equal(pool.queries.length, 1);
      assert.ok(pool.queries[0].sql.includes('INSERT INTO audit_log'));
      assert.equal(pool.queries[0].params[1], 'user');
      assert.equal(pool.queries[0].params[2], 'u1');
      assert.equal(pool.queries[0].params[3], 'login');
      assert.equal(pool.queries[0].params[7], '1.2.3.4');
    });

    it('uses camelCase fallbacks for entry fields', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const store = createAuditStore(pool, mockUtils);
      await store.insert({
        action: 'signup',
        actorType: 'user',
        actorId: 'u2',
        targetType: 'account',
        targetId: 'a1',
        detailsJson: { plan: 'free' },
        userAgent: 'Safari',
        requestId: 'req2',
      });

      assert.equal(pool.queries[0].params[1], 'user');
      assert.equal(pool.queries[0].params[2], 'u2');
      assert.equal(pool.queries[0].params[4], 'account');
      assert.equal(pool.queries[0].params[5], 'a1');
    });

    it('defaults actorType and targetType to unknown', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const store = createAuditStore(pool, mockUtils);
      await store.insert({ action: 'test' });

      assert.equal(pool.queries[0].params[1], 'unknown'); // actorType
      assert.equal(pool.queries[0].params[4], 'unknown'); // targetType
      assert.equal(pool.queries[0].params[10], 'success'); // default status
    });

    it('handles string details_json', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const store = createAuditStore(pool, mockUtils);
      await store.insert({ action: 'test', details_json: '{"a":1}' });

      assert.equal(pool.queries[0].params[6], '{"a":1}');
    });

    it('uses provided id if present', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const store = createAuditStore(pool, mockUtils);
      const id = await store.insert({ id: 'custom-id', action: 'test' });

      assert.equal(id, 'custom-id');
      assert.equal(pool.queries[0].params[0], 'custom-id');
    });
  });

  describe('query()', () => {
    it('returns rows with parsed object detailsJson', async () => {
      const pool = mockPool([{
        rows: [{ id: 'r1', action: 'login', detailsJson: { browser: 'chrome' } }],
      }]);
      const store = createAuditStore(pool, mockUtils);
      const result = await store.query({ actorId: 'u1' });

      assert.equal(result.rows.length, 1);
      assert.deepEqual(result.rows[0].details, { browser: 'chrome' });
    });

    it('parses string detailsJson', async () => {
      const pool = mockPool([{
        rows: [{ id: 'r1', action: 'login', detailsJson: '{"k":"v"}' }],
      }]);
      const store = createAuditStore(pool, mockUtils);
      const result = await store.query();

      assert.deepEqual(result.rows[0].details, { k: 'v' });
    });

    it('returns null details for invalid JSON string', async () => {
      const pool = mockPool([{
        rows: [{ id: 'r1', action: 'x', detailsJson: 'not-json' }],
      }]);
      const store = createAuditStore(pool, mockUtils);
      const result = await store.query();

      assert.equal(result.rows[0].details, null);
    });

    it('returns null details when detailsJson is falsy', async () => {
      const pool = mockPool([{
        rows: [{ id: 'r1', action: 'x', detailsJson: null }],
      }]);
      const store = createAuditStore(pool, mockUtils);
      const result = await store.query();

      assert.equal(result.rows[0].details, null);
    });

    it('clamps limit to max 200', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createAuditStore(pool, mockUtils);
      await store.query({ limit: 500 });

      assert.equal(pool.queries[0].params[6], 200);
    });

    it('clamps limit to min 1', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createAuditStore(pool, mockUtils);
      await store.query({ limit: -5 });

      assert.equal(pool.queries[0].params[6], 1);
    });

    it('returns nextCursor when rows fill the limit', async () => {
      const rows = [{ id: 'r1', action: 'a', detailsJson: null }, { id: 'r2', action: 'b', detailsJson: null }];
      const pool = mockPool([{ rows }]);
      const store = createAuditStore(pool, mockUtils);
      const result = await store.query({ limit: 2 });

      assert.equal(result.nextCursor, 'r2');
    });

    it('returns null nextCursor when rows < limit', async () => {
      const pool = mockPool([{ rows: [{ id: 'r1', action: 'a', detailsJson: null }] }]);
      const store = createAuditStore(pool, mockUtils);
      const result = await store.query({ limit: 50 });

      assert.equal(result.nextCursor, null);
    });
  });

  describe('count()', () => {
    it('returns integer count', async () => {
      const pool = mockPool([{ rows: [{ total: '12' }] }]);
      const store = createAuditStore(pool, mockUtils);
      const count = await store.count({ actorId: 'u1' });

      assert.equal(count, 12);
      assert.equal(typeof count, 'number');
    });

    it('returns 0 when total is missing', async () => {
      const pool = mockPool([{ rows: [{}] }]);
      const store = createAuditStore(pool, mockUtils);
      const count = await store.count();

      assert.equal(count, 0);
    });
  });

  describe('cleanup()', () => {
    it('deletes old audit entries with default retention', async () => {
      const pool = mockPool([{ rows: [], rowCount: 5 }]);
      const store = createAuditStore(pool, mockUtils);
      const deleted = await store.cleanup();

      assert.equal(deleted, 5);
      assert.equal(pool.queries[0].params[0], 90);
    });

    it('clamps retention to min 1 day', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const store = createAuditStore(pool, mockUtils);
      await store.cleanup(-10);

      assert.equal(pool.queries[0].params[0], 1);
    });

    it('falls back to 90 when given 0 (falsy)', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const store = createAuditStore(pool, mockUtils);
      await store.cleanup(0);

      // 0 is falsy so parseInt(0,10)||90 = 90
      assert.equal(pool.queries[0].params[0], 90);
    });

    it('clamps retention to max 3650 days', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const store = createAuditStore(pool, mockUtils);
      await store.cleanup(99999);

      assert.equal(pool.queries[0].params[0], 3650);
    });
  });
});

// ===========================================================================
// 3. Expenses Store
// ===========================================================================
import { createExpensesStore } from '../lib/db/stores/expenses.js';

describe('ExpensesStore', () => {
  describe('create()', () => {
    it('inserts an expense and returns the row', async () => {
      const row = { id: 'e1', crew_id: 'c1', amount: 50, description: 'food' };
      const pool = mockPool([{ rows: [row] }]);
      const store = createExpensesStore(pool);
      const result = await store.create({
        crewId: 'c1', paidBy: 'u1', description: 'food', amount: 50, splitWith: ['u1', 'u2'],
      });

      assert.equal(result.id, 'e1');
      assert.ok(pool.queries[0].sql.includes('INSERT INTO crew_expenses'));
      assert.equal(pool.queries[0].params[1], 'c1');
      assert.equal(pool.queries[0].params[2], 'u1');
      assert.equal(pool.queries[0].params[5], JSON.stringify(['u1', 'u2']));
    });

    it('defaults category to other and splitWith to empty', async () => {
      const pool = mockPool([{ rows: [{ id: 'e2' }] }]);
      const store = createExpensesStore(pool);
      await store.create({ crewId: 'c1', paidBy: 'u1', description: 'd', amount: 10 });

      assert.equal(pool.queries[0].params[5], '[]');    // splitWith
      assert.equal(pool.queries[0].params[6], 'other'); // category
    });

    it('uses provided category', async () => {
      const pool = mockPool([{ rows: [{ id: 'e3' }] }]);
      const store = createExpensesStore(pool);
      await store.create({ crewId: 'c1', paidBy: 'u1', description: 'd', amount: 10, category: 'transport' });

      assert.equal(pool.queries[0].params[6], 'transport');
    });
  });

  describe('getByCrew()', () => {
    it('returns rows with parsed split_with (string)', async () => {
      const rows = [
        { id: 'e1', split_with: '["u1","u2"]', paid_by_name: 'alice' },
      ];
      const pool = mockPool([{ rows }]);
      const store = createExpensesStore(pool);
      const result = await store.getByCrew('c1');

      assert.deepEqual(result[0].split_with, ['u1', 'u2']);
    });

    it('handles already-parsed array split_with', async () => {
      const rows = [{ id: 'e1', split_with: ['u1'], paid_by_name: 'bob' }];
      const pool = mockPool([{ rows }]);
      const store = createExpensesStore(pool);
      const result = await store.getByCrew('c1');

      assert.deepEqual(result[0].split_with, ['u1']);
    });

    it('handles invalid JSON in split_with gracefully', async () => {
      const rows = [{ id: 'e1', split_with: 'not-json', paid_by_name: 'x' }];
      const pool = mockPool([{ rows }]);
      const store = createExpensesStore(pool);
      const result = await store.getByCrew('c1');

      assert.deepEqual(result[0].split_with, []);
    });

    it('handles null split_with', async () => {
      const rows = [{ id: 'e1', split_with: null, paid_by_name: 'x' }];
      const pool = mockPool([{ rows }]);
      const store = createExpensesStore(pool);
      const result = await store.getByCrew('c1');

      assert.deepEqual(result[0].split_with, []);
    });
  });

  describe('getById()', () => {
    it('returns the expense when found', async () => {
      const pool = mockPool([{ rows: [{ id: 'e1', amount: 25 }] }]);
      const store = createExpensesStore(pool);
      const result = await store.getById('e1');

      assert.equal(result.id, 'e1');
    });

    it('returns null when not found', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createExpensesStore(pool);
      const result = await store.getById('missing');

      assert.equal(result, null);
    });
  });

  describe('delete()', () => {
    it('runs DELETE query with correct id', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const store = createExpensesStore(pool);
      await store.delete('e1');

      assert.ok(pool.queries[0].sql.includes('DELETE FROM crew_expenses'));
      assert.deepEqual(pool.queries[0].params, ['e1']);
    });
  });

  describe('getBalances()', () => {
    it('calculates balances splitting among all members when splitWith is empty', async () => {
      const expenses = [
        { id: 'e1', paid_by: 'u1', amount: 90, split_with: '[]' },
      ];
      const members = [
        { user_id: 'u1', username: 'alice' },
        { user_id: 'u2', username: 'bob' },
        { user_id: 'u3', username: 'charlie' },
      ];
      const pool = mockPool([{ rows: expenses }, { rows: members }]);
      const store = createExpensesStore(pool);
      const result = await store.getBalances('c1');

      // u1 paid 90, split among 3 = 30 each. u1 balance: 90 - 30 = 60
      const u1 = result.find((r: any) => r.userId === 'u1');
      assert.equal(u1!.balance, 60);
      const u2 = result.find((r: any) => r.userId === 'u2');
      assert.equal(u2!.balance, -30);
    });

    it('calculates balances with specific splitWith', async () => {
      const expenses = [
        { id: 'e1', paid_by: 'u1', amount: 100, split_with: ['u1', 'u2'] },
      ];
      const members = [
        { user_id: 'u1', username: 'alice' },
        { user_id: 'u2', username: 'bob' },
        { user_id: 'u3', username: 'charlie' },
      ];
      const pool = mockPool([{ rows: expenses }, { rows: members }]);
      const store = createExpensesStore(pool);
      const result = await store.getBalances('c1');

      // u1 paid 100, split between u1+u2 = 50 each. u1: 100-50 = 50, u2: -50, u3: 0
      assert.equal(result.find((r: any) => r.userId === 'u1')!.balance, 50);
      assert.equal(result.find((r: any) => r.userId === 'u2')!.balance, -50);
      assert.equal(result.find((r: any) => r.userId === 'u3')!.balance, 0);
    });

    it('handles invalid JSON split_with string gracefully', async () => {
      const expenses = [
        { id: 'e1', paid_by: 'u1', amount: 60, split_with: 'bad-json' },
      ];
      const members = [
        { user_id: 'u1', username: 'alice' },
        { user_id: 'u2', username: 'bob' },
      ];
      const pool = mockPool([{ rows: expenses }, { rows: members }]);
      const store = createExpensesStore(pool);
      const result = await store.getBalances('c1');

      // Bad JSON => splitWith = [] => split among all members
      assert.equal(result.find((r: any) => r.userId === 'u1')!.balance, 30);
      assert.equal(result.find((r: any) => r.userId === 'u2')!.balance, -30);
    });

    it('returns zero balances when no expenses exist', async () => {
      const pool = mockPool([{ rows: [] }, { rows: [{ user_id: 'u1', username: 'a' }] }]);
      const store = createExpensesStore(pool);
      const result = await store.getBalances('c1');

      assert.equal(result.length, 1);
      assert.equal(result[0]!.balance, 0);
    });
  });
});

// ===========================================================================
// 4. Polls Store
// ===========================================================================
import createPollsStore from '../lib/db/stores/polls.js';

describe('PollsStore', () => {
  describe('create()', () => {
    it('inserts a poll and returns the row', async () => {
      const row = { id: 'poll-123', question: 'Where to eat?', options: ['A', 'B'] };
      const pool = mockPool([{ rows: [row] }]);
      const store = createPollsStore(pool, mockUtils);
      const result = await store.create({
        crewId: 'c1', createdBy: 'u1', question: 'Where to eat?', options: ['A', 'B'], closesAt: null,
      });

      assert.equal(result.id, 'poll-123');
      assert.ok(pool.queries[0].sql.includes('INSERT INTO crew_polls'));
      assert.ok(pool.queries[0].params[0].startsWith('poll-'));
      assert.equal(pool.queries[0].params[3], 'Where to eat?');
      assert.equal(pool.queries[0].params[4], JSON.stringify(['A', 'B']));
    });

    it('passes closesAt to the query', async () => {
      const pool = mockPool([{ rows: [{ id: 'p1' }] }]);
      const store = createPollsStore(pool, mockUtils);
      const closesAt = '2026-12-31T23:59:59Z';
      await store.create({ crewId: 'c1', createdBy: 'u1', question: 'Q', options: ['X'], closesAt });

      assert.equal(pool.queries[0].params[5], closesAt);
    });
  });

  describe('listByCrew()', () => {
    it('returns rows with parsed options and votes (already arrays)', async () => {
      const rows = [{
        id: 'p1', question: 'Q', options: ['A', 'B'],
        votes: [{ option: 0, user_id: 'u1' }], vote_count: '1',
      }];
      const pool = mockPool([{ rows }]);
      const store = createPollsStore(pool, mockUtils);
      const result = await store.listByCrew('c1');

      assert.equal(result.length, 1);
      assert.deepEqual(result[0].options, ['A', 'B']);
      assert.deepEqual(result[0].votes, [{ option: 0, user_id: 'u1' }]);
    });

    it('parses string options and votes via safeParseJson', async () => {
      const rows = [{
        id: 'p1', question: 'Q', options: '["A","B"]', votes: '[{"option":0}]', vote_count: '1',
      }];
      const pool = mockPool([{ rows }]);
      const store = createPollsStore(pool, mockUtils);
      const result = await store.listByCrew('c1');

      assert.deepEqual(result[0].options, ['A', 'B']);
      assert.deepEqual(result[0].votes, [{ option: 0 }]);
    });

    it('falls back to empty arrays for invalid JSON', async () => {
      const rows = [{ id: 'p1', question: 'Q', options: 'bad', votes: 'bad' }];
      const pool = mockPool([{ rows }]);
      const store = createPollsStore(pool, mockUtils);
      const result = await store.listByCrew('c1');

      assert.deepEqual(result[0].options, []);
      assert.deepEqual(result[0].votes, []);
    });
  });

  describe('vote()', () => {
    it('upserts a vote and returns the row', async () => {
      const row = { poll_id: 'p1', user_id: 'u1', option_index: 2 };
      const pool = mockPool([{ rows: [row] }]);
      const store = createPollsStore(pool, mockUtils);
      const result = await store.vote('p1', 'u1', 2);

      assert.equal(result.option_index, 2);
      assert.ok(pool.queries[0].sql.includes('ON CONFLICT'));
      assert.deepEqual(pool.queries[0].params, ['p1', 'u1', 2]);
    });

    it('passes correct params for different option index', async () => {
      const pool = mockPool([{ rows: [{ poll_id: 'p1', user_id: 'u2', option_index: 0 }] }]);
      const store = createPollsStore(pool, mockUtils);
      await store.vote('p1', 'u2', 0);

      assert.deepEqual(pool.queries[0].params, ['p1', 'u2', 0]);
    });
  });

  describe('getResults()', () => {
    it('returns poll with parsed votes', async () => {
      const rows = [{
        id: 'p1', question: 'Q', options: ['A'], closed: false,
        votes: [{ option_index: 0, user_id: 'u1', username: 'alice' }],
      }];
      const pool = mockPool([{ rows }]);
      const store = createPollsStore(pool, mockUtils);
      const result = await store.getResults('p1');

      assert.equal(result.id, 'p1');
      assert.deepEqual(result.options, ['A']);
      assert.equal(result.votes.length, 1);
    });

    it('returns null when poll not found', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createPollsStore(pool, mockUtils);
      const result = await store.getResults('missing');

      assert.equal(result, null);
    });

    it('handles string options/votes from DB', async () => {
      const rows = [{ id: 'p1', question: 'Q', options: '["X"]', votes: '[]' }];
      const pool = mockPool([{ rows }]);
      const store = createPollsStore(pool, mockUtils);
      const result = await store.getResults('p1');

      assert.deepEqual(result.options, ['X']);
      assert.deepEqual(result.votes, []);
    });
  });

  describe('close()', () => {
    it('sets closed=TRUE and returns the row', async () => {
      const pool = mockPool([{ rows: [{ id: 'p1', closed: true }] }]);
      const store = createPollsStore(pool, mockUtils);
      const result = await store.close('p1');

      assert.equal(result.closed, true);
      assert.ok(pool.queries[0].sql.includes('SET closed = TRUE'));
      assert.deepEqual(pool.queries[0].params, ['p1']);
    });
  });

  describe('countActiveByCrew()', () => {
    it('returns the count of active polls', async () => {
      const pool = mockPool([{ rows: [{ count: '3' }] }]);
      const store = createPollsStore(pool, mockUtils);
      const count = await store.countActiveByCrew('c1');

      assert.equal(count, '3');
      assert.deepEqual(pool.queries[0].params, ['c1']);
    });
  });

  describe('getById()', () => {
    it('returns the poll with parsed options', async () => {
      const rows = [{ id: 'p1', question: 'Q', options: '["A","B"]', closed: false }];
      const pool = mockPool([{ rows }]);
      const store = createPollsStore(pool, mockUtils);
      const result = await store.getById('p1');

      assert.equal(result.id, 'p1');
      assert.deepEqual(result.options, ['A', 'B']);
    });

    it('returns null when not found', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createPollsStore(pool, mockUtils);
      const result = await store.getById('nope');

      assert.equal(result, null);
    });

    it('returns array options as-is when already parsed', async () => {
      const rows = [{ id: 'p1', question: 'Q', options: ['X', 'Y'], closed: false }];
      const pool = mockPool([{ rows }]);
      const store = createPollsStore(pool, mockUtils);
      const result = await store.getById('p1');

      assert.deepEqual(result.options, ['X', 'Y']);
    });
  });
});

// ===========================================================================
// 5. Calendar Tokens Store
// ===========================================================================
import { createCalendarTokensStore } from '../lib/db/stores/calendar-tokens.js';

describe('CalendarTokensStore', () => {
  describe('getOrCreate()', () => {
    it('upserts a calendar token and returns the row', async () => {
      const row = { id: 'tok1', user_id: 'u1', festival_id: 'f1', profile_id: 'p1' };
      const pool = mockPool([{ rows: [row] }]);
      const store = createCalendarTokensStore(pool);
      const result = await store.getOrCreate({ userId: 'u1', festivalId: 'f1', profileId: 'p1' });

      assert.equal(result.id, 'tok1');
      assert.ok(pool.queries[0].sql.includes('ON CONFLICT'));
      assert.equal(pool.queries[0].params[1], 'u1');
      assert.equal(pool.queries[0].params[2], 'f1');
      assert.equal(pool.queries[0].params[3], 'p1');
    });

    it('generates a UUID for the id', async () => {
      const pool = mockPool([{ rows: [{ id: 'generated' }] }]);
      const store = createCalendarTokensStore(pool);
      await store.getOrCreate({ userId: 'u1', festivalId: 'f1', profileId: 'p1' });

      // First param is the generated UUID
      assert.ok(typeof pool.queries[0].params[0] === 'string');
      assert.ok(pool.queries[0].params[0].length > 0);
    });
  });

  describe('getByToken()', () => {
    it('returns the token row when found', async () => {
      const row = { id: 'tok1', user_id: 'u1', festival_id: 'f1' };
      const pool = mockPool([{ rows: [row] }]);
      const store = createCalendarTokensStore(pool);
      const result = await store.getByToken('tok1');

      assert.equal(result.id, 'tok1');
      assert.deepEqual(pool.queries[0].params, ['tok1']);
    });

    it('returns null when token not found', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createCalendarTokensStore(pool);
      const result = await store.getByToken('missing');

      assert.equal(result, null);
    });
  });

  describe('deleteByUser()', () => {
    it('deletes tokens for user and festival', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const store = createCalendarTokensStore(pool);
      await store.deleteByUser('u1', 'f1');

      assert.ok(pool.queries[0].sql.includes('DELETE FROM calendar_tokens'));
      assert.deepEqual(pool.queries[0].params, ['u1', 'f1']);
    });
  });
});

// ===========================================================================
// 6. Profiles Store
// ===========================================================================
import createProfilesStore from '../lib/db/stores/profiles.js';

describe('ProfilesStore', () => {
  describe('profiles.readAll()', () => {
    it('returns mapped profile rows with default limit', async () => {
      const rows = [{
        id: 'p1', festivalId: 'f1', userId: 'u1', name: 'Alice',
        picksJson: {}, notesJson: {}, remindersJson: {},
        createdAt: '2026-01-01', updatedAt: '2026-01-02',
      }];
      const pool = mockPool([{ rows }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.readAll();

      assert.equal(result.length, 1);
      assert.equal((result[0] as any).id, 'p1');
      assert.equal((result[0] as any).name, 'Alice');
      assert.equal(pool.queries[0].params[0], 10000); // default limit
    });

    it('respects custom limit', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createProfilesStore(pool, mockUtils);
      await store.profiles.readAll({ limit: 5 });

      assert.equal(pool.queries[0].params[0], 5);
    });
  });

  describe('profiles.getByFestival()', () => {
    it('returns profiles for a festival', async () => {
      const rows = [{
        id: 'p1', festivalId: 'f1', userId: 'u1', name: 'Bob',
        picksJson: { s1: 1 }, notesJson: {}, remindersJson: {},
        createdAt: '2026-01-01', updatedAt: null,
      }];
      const pool = mockPool([{ rows }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.getByFestival('f1');

      assert.equal(result.length, 1);
      assert.equal((result[0] as any).festivalId, 'f1');
      assert.deepEqual((result[0] as any).picks, { s1: 1 });
    });

    it('returns empty array when no profiles exist', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.getByFestival('f-none');

      assert.deepEqual(result, []);
    });
  });

  describe('profiles.userIdsByFestival()', () => {
    it('returns an array of user IDs', async () => {
      const rows = [{ userId: 'u1' }, { userId: 'u2' }];
      const pool = mockPool([{ rows }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.userIdsByFestival('f1');

      assert.deepEqual(result, ['u1', 'u2']);
    });
  });

  describe('profiles.readByUserAndFestival()', () => {
    it('returns profile stub when found', async () => {
      const pool = mockPool([{ rows: [{ id: 'p1' }] }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.readByUserAndFestival('u1', 'f1');

      assert.equal(result.id, 'p1');
    });

    it('returns null when not found', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.readByUserAndFestival('u1', 'f-none');

      assert.equal(result, null);
    });
  });

  describe('profiles.getById()', () => {
    it('returns mapped profile when found', async () => {
      const rows = [{
        id: 'p1', festivalId: 'f1', userId: 'u1', name: 'Test',
        picksJson: { s1: 2 }, notesJson: { s1: 'good' }, remindersJson: {},
        createdAt: '2026-01-01', updatedAt: '2026-01-02',
      }];
      const pool = mockPool([{ rows }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.getById('p1');

      assert.equal(result.name, 'Test');
      assert.deepEqual(result.picks, { s1: 2 });
      assert.deepEqual(result.notes, { s1: 'good' });
    });

    it('returns null when profile not found', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.getById('nope');

      assert.equal(result, null);
    });
  });

  describe('profiles.create()', () => {
    it('creates a profile with picks and notes via transaction', async () => {
      // Transaction: BEGIN, INSERT profile, batch picks, batch notes, SELECT, COMMIT
      const profileRow = {
        id: 'p1', festivalId: 'f1', userId: 'u1', name: 'New',
        picksJson: { s1: 1 }, notesJson: { s1: 'hi' }, remindersJson: {},
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      const pool = mockPool([
        { rows: [] },           // BEGIN
        { rows: [] },           // INSERT profile
        { rows: [] },           // batch insert picks
        { rows: [] },           // batch insert notes
        { rows: [profileRow] }, // SELECT
        { rows: [] },           // COMMIT
      ]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.create({
        id: 'p1', festivalId: 'f1', userId: 'u1', name: 'New',
        picks: { s1: 1 }, notes: { s1: 'hi' },
      });

      assert.equal(result.id, 'p1');
      assert.equal(result.name, 'New');
      // BEGIN is first query
      assert.ok(pool.queries[0].sql.includes('BEGIN'));
    });

    it('creates a profile without picks or notes', async () => {
      const profileRow = {
        id: 'p2', festivalId: 'f1', userId: 'u1', name: 'Minimal',
        picksJson: {}, notesJson: {}, remindersJson: {},
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      const pool = mockPool([
        { rows: [] },           // BEGIN
        { rows: [] },           // INSERT profile
        { rows: [profileRow] }, // SELECT (no batch inserts since no picks/notes)
        { rows: [] },           // COMMIT
      ]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.create({
        id: 'p2', festivalId: 'f1', userId: 'u1', name: 'Minimal',
      });

      assert.equal(result.id, 'p2');
    });

    it('returns null if SELECT after insert finds nothing', async () => {
      const pool = mockPool([
        { rows: [] }, // BEGIN
        { rows: [] }, // INSERT profile
        { rows: [] }, // SELECT returns empty
        { rows: [] }, // COMMIT
      ]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.create({
        id: 'p3', festivalId: 'f1', userId: 'u1', name: 'Ghost',
      });

      assert.equal(result, null);
    });
  });

  describe('profiles.update()', () => {
    it('updates picks and notes in a transaction', async () => {
      const profileRow = {
        id: 'p1', festivalId: 'f1', userId: 'u1', name: 'Updated',
        picksJson: { s2: 3 }, notesJson: { s2: 'new' }, remindersJson: {},
        createdAt: '2026-01-01', updatedAt: '2026-01-02',
      };
      const pool = mockPool([
        { rows: [] },           // BEGIN
        { rows: [] },           // UPDATE profile
        { rows: [] },           // DELETE picks
        { rows: [] },           // batch INSERT picks
        { rows: [] },           // DELETE notes
        { rows: [] },           // batch INSERT notes
        { rows: [profileRow] }, // SELECT
        { rows: [] },           // COMMIT
      ]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.update('p1', {
        picks: { s2: 3 }, notes: { s2: 'new' },
      });

      assert.equal(result.id, 'p1');
      assert.deepEqual(result.picks, { s2: 3 });
    });

    it('updates only name without touching picks/notes tables', async () => {
      const profileRow = {
        id: 'p1', festivalId: 'f1', userId: 'u1', name: 'Renamed',
        picksJson: {}, notesJson: {}, remindersJson: {},
        createdAt: '2026-01-01', updatedAt: '2026-01-02',
      };
      const pool = mockPool([
        { rows: [] },           // BEGIN
        { rows: [] },           // UPDATE profile (name + updatedAt)
        { rows: [profileRow] }, // SELECT
        { rows: [] },           // COMMIT
      ]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.update('p1', { name: 'Renamed' });

      assert.equal(result.name, 'Renamed');
    });

    it('returns null when profile not found after update', async () => {
      const pool = mockPool([
        { rows: [] }, // BEGIN
        { rows: [] }, // UPDATE
        { rows: [] }, // SELECT returns nothing
        { rows: [] }, // COMMIT
      ]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.update('p-gone', { name: 'X' });

      assert.equal(result, null);
    });
  });

  describe('profiles.delete()', () => {
    it('soft-deletes the profile and cleans up normalized tables', async () => {
      const profileRow = {
        id: 'p1', festivalId: 'f1', userId: 'u1', name: 'Del',
        picksJson: {}, notesJson: {}, remindersJson: {},
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      const pool = mockPool([
        { rows: [profileRow] }, // getById -> pool.query (SELECT)
        { rows: [] },           // BEGIN (transaction)
        { rows: [] },           // UPDATE SET deleted_at
        { rows: [] },           // DELETE picks
        { rows: [] },           // DELETE notes
        { rows: [] },           // COMMIT
      ]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.delete('p1', { deletedBy: 'admin', reason: 'cleanup' });

      assert.equal(result.id, 'p1');
    });

    it('returns null when profile does not exist', async () => {
      const pool = mockPool([{ rows: [] }]); // getById returns nothing
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.delete('nope');

      assert.equal(result, null);
    });
  });

  describe('profiles.deleteByUserId()', () => {
    it('soft-deletes all profiles for a user', async () => {
      const rows = [
        { id: 'p1', festivalId: 'f1', userId: 'u1', name: 'A' },
        { id: 'p2', festivalId: 'f2', userId: 'u1', name: 'B' },
      ];
      const pool = mockPool([
        { rows },     // SELECT profiles by user
        { rows: [] }, // BEGIN
        { rows: [] }, // UPDATE SET deleted_at
        { rows: [] }, // DELETE picks
        { rows: [] }, // DELETE notes
        { rows: [] }, // COMMIT
      ]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.deleteByUserId('u1', { deletedBy: 'admin', reason: 'ban' });

      assert.equal(result.length, 2);
    });

    it('returns empty array when user has no profiles', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.deleteByUserId('u-none');

      assert.deepEqual(result, []);
    });
  });

  describe('profiles.claimOrphan()', () => {
    it('claims an orphan profile and returns the updated profile', async () => {
      const profileRow = {
        id: 'p1', festivalId: 'f1', userId: 'u1', name: 'Orphan',
        picksJson: {}, notesJson: {}, remindersJson: {},
        createdAt: '2026-01-01', updatedAt: '2026-01-02',
      };
      const pool = mockPool([
        { rows: [{ id: 'p1' }] }, // SELECT orphan
        { rows: [] },              // UPDATE set user_id
        { rows: [profileRow] },    // getById -> SELECT
      ]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.claimOrphan('f1', 'u1', 'Orphan');

      assert.equal(result.id, 'p1');
      assert.equal(result.userId, 'u1');
    });

    it('returns null when no orphan matches', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.profiles.claimOrphan('f1', 'u1', 'nobody');

      assert.equal(result, null);
    });
  });

  describe('profiles.countByFestival()', () => {
    it('returns the count as an integer', async () => {
      const pool = mockPool([{ rows: [{ count: '42' }] }]);
      const store = createProfilesStore(pool, mockUtils);
      const count = await store.profiles.countByFestival('f1');

      assert.equal(count, 42);
      assert.equal(typeof count, 'number');
    });

    it('returns 0 for empty festival', async () => {
      const pool = mockPool([{ rows: [{ count: '0' }] }]);
      const store = createProfilesStore(pool, mockUtils);
      const count = await store.profiles.countByFestival('f-empty');

      assert.equal(count, 0);
    });
  });

  describe('profiles.replaceAll()', () => {
    it('soft-deletes all when nextProfiles is empty', async () => {
      const pool = mockPool([
        { rows: [] }, // BEGIN
        { rows: [] }, // UPDATE SET deleted_at (soft-delete all)
        { rows: [] }, // COMMIT
      ]);
      const store = createProfilesStore(pool, mockUtils);
      await store.profiles.replaceAll([]);

      assert.ok(pool.queries[1].sql.includes('UPDATE festival_profiles SET deleted_at'));
      // No IN clause for empty array
      assert.ok(!pool.queries[1].sql.includes('NOT IN'));
    });

    it('upserts profiles and syncs normalized tables', async () => {
      const pool = mockPool([
        { rows: [] }, // BEGIN
        { rows: [] }, // UPDATE SET deleted_at (mark others deleted)
        { rows: [] }, // UPSERT profiles
        { rows: [] }, // DELETE picks
        { rows: [] }, // DELETE notes
        { rows: [] }, // batch insert picks (empty)
        { rows: [] }, // batch insert notes (empty)
        { rows: [] }, // COMMIT
      ]);
      const store = createProfilesStore(pool, mockUtils);
      await store.profiles.replaceAll([{
        id: 'p1', festivalId: 'f1', userId: 'u1', name: 'X',
        picks: {}, notes: {}, createdAt: '2026-01-01',
      }]);

      // The soft-delete query should have a NOT IN clause
      assert.ok(pool.queries[1].sql.includes('NOT IN'));
    });
  });

  describe('picks.bySetId()', () => {
    it('returns pick rows for a set', async () => {
      const rows = [
        { profileId: 'p1', userId: 'u1', profileName: 'Alice', priority: 1 },
      ];
      const pool = mockPool([{ rows }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.picks.bySetId('s1');

      assert.equal(result.length, 1);
      assert.equal(result[0].priority, 1);
      assert.deepEqual(pool.queries[0].params, ['s1']);
    });

    it('returns empty array when no picks exist', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.picks.bySetId('s-none');

      assert.deepEqual(result, []);
    });
  });

  describe('picks.byFestival()', () => {
    it('returns all picks for a festival', async () => {
      const rows = [
        { setId: 's1', priority: 1, userId: 'u1' },
        { setId: 's2', priority: 2, userId: 'u2' },
      ];
      const pool = mockPool([{ rows }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.picks.byFestival('f1');

      assert.equal(result.length, 2);
      assert.deepEqual(pool.queries[0].params, ['f1']);
    });

    it('returns empty array for a festival with no picks', async () => {
      const pool = mockPool([{ rows: [] }]);
      const store = createProfilesStore(pool, mockUtils);
      const result = await store.picks.byFestival('f-empty');

      assert.deepEqual(result, []);
    });
  });
});
