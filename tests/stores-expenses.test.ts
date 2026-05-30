import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createExpensesStore } from '../lib/db/stores/expenses.js';

// ---------------------------------------------------------------------------
// Helper: mock pool factory
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

function makeErrorPool(error: any) {
  return {
    query: mock.fn(async () => { throw error; }),
  };
}

// Normalize SQL whitespace so substring assertions are robust to the
// multi-line formatting of the store queries.
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// 1. create()
// ---------------------------------------------------------------------------
describe('expenses store — create()', () => {
  it('inserts an expense and returns the created row', async () => {
    const createdRow = {
      id: 'exp-1',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Pizza',
      amount: 25.50,
      split_with: '["user-1","user-2"]',
      category: 'food',
      created_at: '2026-05-01T12:00:00Z',
    };
    const pool = makePool([{ rows: [createdRow] }]);
    const store = createExpensesStore(pool as any);

    const result = await store.create({
      crewId: 'crew-1',
      paidBy: 'user-1',
      description: 'Pizza',
      amount: 25.50,
      splitWith: ['user-1', 'user-2'],
      category: 'food',
    });

    assert.deepStrictEqual(result, createdRow);
    assert.strictEqual(pool.query.mock.calls.length, 1);

    const [sql, params] = pool.query.mock.calls[0]!.arguments as any[];
    assert.ok(sql.includes('INSERT INTO crew_expenses'));
    assert.ok(sql.includes('RETURNING'));
    // params: [id, crewId, paidBy, description, amount, splitJson, category]
    assert.strictEqual(params[1], 'crew-1');
    assert.strictEqual(params[2], 'user-1');
    assert.strictEqual(params[3], 'Pizza');
    assert.strictEqual(params[4], 25.50);
    assert.strictEqual(params[5], '["user-1","user-2"]');
    assert.strictEqual(params[6], 'food');
  });

  it('defaults category to "other" when not provided', async () => {
    const pool = makePool([{ rows: [{ id: 'exp-2' }] }]);
    const store = createExpensesStore(pool as any);

    await store.create({
      crewId: 'crew-1',
      paidBy: 'user-1',
      description: 'Misc',
      amount: 10,
      splitWith: [],
    });

    const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
    assert.strictEqual(params[6], 'other');
  });

  it('serializes null splitWith as empty array JSON', async () => {
    const pool = makePool([{ rows: [{ id: 'exp-3' }] }]);
    const store = createExpensesStore(pool as any);

    await store.create({
      crewId: 'crew-1',
      paidBy: 'user-1',
      description: 'Solo',
      amount: 5,
      splitWith: null,
    });

    const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
    assert.strictEqual(params[5], '[]');
  });

  it('generates a UUID for the expense id', async () => {
    const pool = makePool([{ rows: [{ id: 'will-be-overridden' }] }]);
    const store = createExpensesStore(pool as any);

    await store.create({
      crewId: 'crew-1',
      paidBy: 'user-1',
      description: 'Test',
      amount: 1,
      splitWith: [],
    });

    const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
    // UUID v4 format: 8-4-4-4-12 hex characters
    assert.match(params[0], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('propagates database errors', async () => {
    const pool = makeErrorPool(new Error('connection refused'));
    const store = createExpensesStore(pool as any);

    await assert.rejects(
      () => store.create({
        crewId: 'crew-1',
        paidBy: 'user-1',
        description: 'Fail',
        amount: 10,
        splitWith: [],
      }),
      { message: 'connection refused' },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. getByCrew()
// ---------------------------------------------------------------------------
describe('expenses store — getByCrew()', () => {
  it('returns expenses ordered by created_at DESC with paid_by_name', async () => {
    const rows = [
      {
        id: 'exp-2',
        crew_id: 'crew-1',
        paid_by: 'user-1',
        description: 'Drinks',
        amount: 30,
        split_with: '["user-1","user-2"]',
        category: 'food',
        created_at: '2026-05-02T00:00:00Z',
        paid_by_name: 'alice',
      },
      {
        id: 'exp-1',
        crew_id: 'crew-1',
        paid_by: 'user-2',
        description: 'Gas',
        amount: 50,
        split_with: '["user-1","user-2","user-3"]',
        category: 'transport',
        created_at: '2026-05-01T00:00:00Z',
        paid_by_name: 'bob',
      },
    ];
    const pool = makePool([{ rows }]);
    const store = createExpensesStore(pool as any);

    const result = await store.getByCrew('crew-1');

    assert.strictEqual(result.length, 2);
    // split_with should be parsed from JSON string to array
    assert.deepStrictEqual(result[0].split_with, ['user-1', 'user-2']);
    assert.deepStrictEqual(result[1].split_with, ['user-1', 'user-2', 'user-3']);

    const sql = norm((pool.query.mock.calls[0]!.arguments as any[])[0]);
    assert.ok(sql.includes('ORDER BY e.created_at DESC'));
    assert.ok(sql.includes('JOIN users u'));
    assert.deepStrictEqual((pool.query.mock.calls[0]!.arguments as any[])[1], ['crew-1']);
  });

  it('returns empty array when crew has no expenses', async () => {
    const pool = makePool([{ rows: [] }]);
    const store = createExpensesStore(pool as any);

    const result = await store.getByCrew('crew-empty');
    assert.deepStrictEqual(result, []);
  });

  it('handles split_with that is already an array (not a string)', async () => {
    const rows = [{
      id: 'exp-arr',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Pre-parsed',
      amount: 10,
      split_with: ['user-1', 'user-2'],
      category: 'other',
      created_at: '2026-05-01T00:00:00Z',
      paid_by_name: 'alice',
    }];
    const pool = makePool([{ rows }]);
    const store = createExpensesStore(pool as any);

    const result = await store.getByCrew('crew-1');
    assert.deepStrictEqual(result[0].split_with, ['user-1', 'user-2']);
  });

  it('handles malformed JSON in split_with by falling back to empty array', async () => {
    const rows = [{
      id: 'exp-bad',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Bad JSON',
      amount: 10,
      split_with: '{not valid json[',
      category: 'other',
      created_at: '2026-05-01T00:00:00Z',
      paid_by_name: 'alice',
    }];
    const pool = makePool([{ rows }]);
    const store = createExpensesStore(pool as any);

    const result = await store.getByCrew('crew-1');
    assert.deepStrictEqual(result[0].split_with, []);
  });

  it('handles null split_with by defaulting to empty array', async () => {
    const rows = [{
      id: 'exp-null',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Null split',
      amount: 10,
      split_with: null,
      category: 'other',
      created_at: '2026-05-01T00:00:00Z',
      paid_by_name: 'alice',
    }];
    const pool = makePool([{ rows }]);
    const store = createExpensesStore(pool as any);

    const result = await store.getByCrew('crew-1');
    assert.deepStrictEqual(result[0].split_with, []);
  });

  it('propagates database errors', async () => {
    const pool = makeErrorPool(new Error('timeout'));
    const store = createExpensesStore(pool as any);

    await assert.rejects(
      () => store.getByCrew('crew-1'),
      { message: 'timeout' },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. getById()
// ---------------------------------------------------------------------------
describe('expenses store — getById()', () => {
  it('returns the expense when found', async () => {
    const row = {
      id: 'exp-1',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Tickets',
      amount: 100,
      split_with: '[]',
      category: 'tickets',
      created_at: '2026-05-01T00:00:00Z',
    };
    const pool = makePool([{ rows: [row] }]);
    const store = createExpensesStore(pool as any);

    const result = await store.getById('exp-1');
    assert.deepStrictEqual(result, row);
    assert.deepStrictEqual((pool.query.mock.calls[0]!.arguments as any[])[1], ['exp-1']);
  });

  it('returns null when expense not found', async () => {
    const pool = makePool([{ rows: [] }]);
    const store = createExpensesStore(pool as any);

    const result = await store.getById('nonexistent');
    assert.strictEqual(result, null);
  });

  it('propagates database errors', async () => {
    const pool = makeErrorPool(new Error('relation does not exist'));
    const store = createExpensesStore(pool as any);

    await assert.rejects(
      () => store.getById('exp-1'),
      { message: 'relation does not exist' },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. delete()
// ---------------------------------------------------------------------------
describe('expenses store — delete()', () => {
  it('executes DELETE with the correct expense id', async () => {
    const pool = makePool([{ rows: [] }]);
    const store = createExpensesStore(pool as any);

    await store.delete('exp-to-delete');

    assert.strictEqual(pool.query.mock.calls.length, 1);
    const [sql, params] = pool.query.mock.calls[0]!.arguments as any[];
    assert.ok(sql.includes('DELETE FROM crew_expenses'));
    assert.ok(sql.includes('WHERE id = $1'));
    assert.deepStrictEqual(params, ['exp-to-delete']);
  });

  it('does not throw when expense does not exist (no-op)', async () => {
    const pool = makePool([{ rows: [] }]);
    const store = createExpensesStore(pool as any);

    await assert.doesNotReject(() => store.delete('nonexistent'));
  });

  it('returns undefined (no return value)', async () => {
    const pool = makePool([{ rows: [] }]);
    const store = createExpensesStore(pool as any);

    const result = await store.delete('exp-1');
    assert.strictEqual(result, undefined);
  });

  it('propagates database errors', async () => {
    const pool = makeErrorPool(new Error('permission denied'));
    const store = createExpensesStore(pool as any);

    await assert.rejects(
      () => store.delete('exp-1'),
      { message: 'permission denied' },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. getBalances() — settlement calculations
// ---------------------------------------------------------------------------
describe('expenses store — getBalances()', () => {
  it('calculates balances for a simple two-person split', async () => {
    // user-1 paid $100, split between user-1 and user-2
    const expenses = [{
      id: 'exp-1',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Dinner',
      amount: '100.00', // pg returns NUMERIC as a string — must not string-concat
      split_with: '["user-1","user-2"]',
      category: 'food',
      created_at: '2026-05-01T00:00:00Z',
    }];
    const members = [
      { user_id: 'user-1', username: 'alice' },
      { user_id: 'user-2', username: 'bob' },
    ];
    const pool = makePool([
      { rows: expenses },
      { rows: members },
    ]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-1');

    assert.strictEqual(result.length, 2);
    // user-1 paid 100, owes 50 => balance = +50
    const alice = result.find((r: any) => r.userId === 'user-1');
    assert.strictEqual(alice!.balance, 50);
    assert.strictEqual(alice!.username, 'alice');
    // user-2 paid 0, owes 50 => balance = -50
    const bob = result.find((r: any) => r.userId === 'user-2');
    assert.strictEqual(bob!.balance, -50);
    assert.strictEqual(bob!.username, 'bob');
  });

  it('splits among all members when splitWith is empty', async () => {
    // user-1 paid $90, split_with is empty => split among all 3 members
    const expenses = [{
      id: 'exp-1',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Parking',
      amount: '90.00',
      split_with: '[]',
      category: 'transport',
      created_at: '2026-05-01T00:00:00Z',
    }];
    const members = [
      { user_id: 'user-1', username: 'alice' },
      { user_id: 'user-2', username: 'bob' },
      { user_id: 'user-3', username: 'charlie' },
    ];
    const pool = makePool([
      { rows: expenses },
      { rows: members },
    ]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-1');

    // user-1: paid 90, share 30 => +60
    const alice = result.find((r: any) => r.userId === 'user-1');
    assert.strictEqual(alice!.balance, 60);
    // user-2: paid 0, share 30 => -30
    const bob = result.find((r: any) => r.userId === 'user-2');
    assert.strictEqual(bob!.balance, -30);
    // user-3: paid 0, share 30 => -30
    const charlie = result.find((r: any) => r.userId === 'user-3');
    assert.strictEqual(charlie!.balance, -30);
  });

  it('handles multiple expenses from different payers', async () => {
    const expenses = [
      {
        id: 'exp-1',
        crew_id: 'crew-1',
        paid_by: 'user-1',
        description: 'Uber',
        amount: '40.00',
        split_with: '["user-1","user-2"]',
        category: 'transport',
        created_at: '2026-05-01T00:00:00Z',
      },
      {
        id: 'exp-2',
        crew_id: 'crew-1',
        paid_by: 'user-2',
        description: 'Food',
        amount: '60.00',
        split_with: '["user-1","user-2"]',
        category: 'food',
        created_at: '2026-05-02T00:00:00Z',
      },
    ];
    const members = [
      { user_id: 'user-1', username: 'alice' },
      { user_id: 'user-2', username: 'bob' },
    ];
    const pool = makePool([
      { rows: expenses },
      { rows: members },
    ]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-1');

    // user-1: paid 40, share (20 + 30) = 50 => balance = 40 - 50 = -10
    const alice = result.find((r: any) => r.userId === 'user-1');
    assert.strictEqual(alice!.balance, -10);
    // user-2: paid 60, share (20 + 30) = 50 => balance = 60 - 50 = +10
    const bob = result.find((r: any) => r.userId === 'user-2');
    assert.strictEqual(bob!.balance, 10);
  });

  it('distributes remainder pennies so an uneven split is exactly zero-sum ($10/3)', async () => {
    const expenses = [{
      id: 'exp-1',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Snacks',
      amount: '10.00',
      split_with: '["user-1","user-2","user-3"]',
      category: 'food',
      created_at: '2026-05-01T00:00:00Z',
    }];
    const members = [
      { user_id: 'user-1', username: 'alice' },
      { user_id: 'user-2', username: 'bob' },
      { user_id: 'user-3', username: 'charlie' },
    ];
    const pool = makePool([{ rows: expenses }, { rows: members }]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-1');
    // 1000c / 3 = 334 + 333 + 333. Payer: +1000 - 334 = +6.66; others -3.33.
    const total = result.reduce((s: number, r: any) => s + r.balance, 0);
    assert.ok(Math.abs(total) < 1e-9, `balances must be zero-sum, got ${total}`);
    assert.strictEqual(result.find((r: any) => r.userId === 'user-1')!.balance, 6.66);
    assert.strictEqual(result.find((r: any) => r.userId === 'user-2')!.balance, -3.33);
    assert.strictEqual(result.find((r: any) => r.userId === 'user-3')!.balance, -3.33);
  });

  it('returns all zero balances when no expenses exist', async () => {
    const members = [
      { user_id: 'user-1', username: 'alice' },
      { user_id: 'user-2', username: 'bob' },
    ];
    const pool = makePool([
      { rows: [] },
      { rows: members },
    ]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-1');

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]!.balance, 0);
    assert.strictEqual(result[1]!.balance, 0);
  });

  it('returns empty array when crew has no members', async () => {
    const pool = makePool([
      { rows: [] },
      { rows: [] },
    ]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-empty');
    assert.deepStrictEqual(result, []);
  });

  it('handles zero-amount expense without error', async () => {
    const expenses = [{
      id: 'exp-zero',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Free item',
      amount: 0,
      split_with: '["user-1","user-2"]',
      category: 'other',
      created_at: '2026-05-01T00:00:00Z',
    }];
    const members = [
      { user_id: 'user-1', username: 'alice' },
      { user_id: 'user-2', username: 'bob' },
    ];
    const pool = makePool([
      { rows: expenses },
      { rows: members },
    ]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-1');

    // Zero amount: payer gets +0, each share is 0 => all balances 0
    assert.strictEqual(result[0]!.balance, 0);
    assert.strictEqual(result[1]!.balance, 0);
  });

  it('handles single-member crew (payer is sole member)', async () => {
    const expenses = [{
      id: 'exp-solo',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Solo expense',
      amount: 50,
      split_with: '["user-1"]',
      category: 'other',
      created_at: '2026-05-01T00:00:00Z',
    }];
    const members = [
      { user_id: 'user-1', username: 'alice' },
    ];
    const pool = makePool([
      { rows: expenses },
      { rows: members },
    ]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-1');

    // user-1: paid 50, owes 50 => balance 0
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.balance, 0);
    assert.strictEqual(result[0]!.username, 'alice');
  });

  it('rounds balances to 2 decimal places and stays zero-sum on an odd split', async () => {
    // $100 split 3 ways: cent-accurate distribution keeps the ledger zero-sum
    // (the old float math left a stray penny: 66.67 - 33.33 - 33.33 = 0.01).
    const expenses = [{
      id: 'exp-round',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Odd split',
      amount: '100.00',
      split_with: '["user-1","user-2","user-3"]',
      category: 'other',
      created_at: '2026-05-01T00:00:00Z',
    }];
    const members = [
      { user_id: 'user-1', username: 'alice' },
      { user_id: 'user-2', username: 'bob' },
      { user_id: 'user-3', username: 'charlie' },
    ];
    const pool = makePool([
      { rows: expenses },
      { rows: members },
    ]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-1');

    // 10000c/3 = 3334 + 3333 + 3333. user-1: +10000 - 3334 = +66.66; others -33.33.
    const alice = result.find((r: any) => r.userId === 'user-1');
    assert.strictEqual(alice!.balance, 66.66);
    const bob = result.find((r: any) => r.userId === 'user-2');
    assert.strictEqual(bob!.balance, -33.33);
    const charlie = result.find((r: any) => r.userId === 'user-3');
    assert.strictEqual(charlie!.balance, -33.33);
    const total = result.reduce((s: number, r: any) => s + r.balance, 0);
    assert.ok(Math.abs(total) < 1e-9, `balances must be zero-sum, got ${total}`);
  });

  it('parses split_with from JSON string in expenses', async () => {
    const expenses = [{
      id: 'exp-str',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Parsed',
      amount: 80,
      split_with: '["user-1","user-2"]',
      category: 'other',
      created_at: '2026-05-01T00:00:00Z',
    }];
    const members = [
      { user_id: 'user-1', username: 'alice' },
      { user_id: 'user-2', username: 'bob' },
    ];
    const pool = makePool([
      { rows: expenses },
      { rows: members },
    ]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-1');

    // user-1: 80 - 40 = 40
    const alice = result.find((r: any) => r.userId === 'user-1');
    assert.strictEqual(alice!.balance, 40);
    // user-2: 0 - 40 = -40
    const bob = result.find((r: any) => r.userId === 'user-2');
    assert.strictEqual(bob!.balance, -40);
  });

  it('falls back to empty split when split_with is malformed JSON', async () => {
    // Malformed JSON => splitWith becomes [] => splits among all members
    const expenses = [{
      id: 'exp-bad',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Bad split',
      amount: 60,
      split_with: 'not-json!!!',
      category: 'other',
      created_at: '2026-05-01T00:00:00Z',
    }];
    const members = [
      { user_id: 'user-1', username: 'alice' },
      { user_id: 'user-2', username: 'bob' },
    ];
    const pool = makePool([
      { rows: expenses },
      { rows: members },
    ]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-1');

    // Malformed => splitWith=[] => splits among all members (2)
    // user-1: paid 60, share 30 => +30
    const alice = result.find((r: any) => r.userId === 'user-1');
    assert.strictEqual(alice!.balance, 30);
    // user-2: paid 0, share 30 => -30
    const bob = result.find((r: any) => r.userId === 'user-2');
    assert.strictEqual(bob!.balance, -30);
  });

  it('ignores payer credit if payer is not a crew member', async () => {
    // Payer user-99 is not in the members list
    const expenses = [{
      id: 'exp-ext',
      crew_id: 'crew-1',
      paid_by: 'user-99',
      description: 'External payer',
      amount: 100,
      split_with: '["user-1","user-2"]',
      category: 'other',
      created_at: '2026-05-01T00:00:00Z',
    }];
    const members = [
      { user_id: 'user-1', username: 'alice' },
      { user_id: 'user-2', username: 'bob' },
    ];
    const pool = makePool([
      { rows: expenses },
      { rows: members },
    ]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-1');

    // user-99 not in balances, so payer credit is skipped (guarded by !== undefined check)
    // user-1: 0 - 50 = -50
    const alice = result.find((r: any) => r.userId === 'user-1');
    assert.strictEqual(alice!.balance, -50);
    // user-2: 0 - 50 = -50
    const bob = result.find((r: any) => r.userId === 'user-2');
    assert.strictEqual(bob!.balance, -50);
  });

  it('redistributes shares for split members not in the crew (zero-sum)', async () => {
    // split_with includes user-99 who is not a crew member; their share must
    // not silently vanish (old behavior left the ledger +$30 non-zero-sum) —
    // it redistributes across the current members.
    const expenses = [{
      id: 'exp-ghost',
      crew_id: 'crew-1',
      paid_by: 'user-1',
      description: 'Ghost split',
      amount: '90.00',
      split_with: '["user-1","user-2","user-99"]',
      category: 'other',
      created_at: '2026-05-01T00:00:00Z',
    }];
    const members = [
      { user_id: 'user-1', username: 'alice' },
      { user_id: 'user-2', username: 'bob' },
    ];
    const pool = makePool([
      { rows: expenses },
      { rows: members },
    ]);
    const store = createExpensesStore(pool as any);

    const result = await store.getBalances('crew-1');

    // user-99 dropped; 9000c/2 = 4500 each. user-1: +9000 - 4500 = +45; user-2: -45.
    const alice = result.find((r: any) => r.userId === 'user-1');
    assert.strictEqual(alice!.balance, 45);
    const bob = result.find((r: any) => r.userId === 'user-2');
    assert.strictEqual(bob!.balance, -45);
    const total = result.reduce((s: number, r: any) => s + r.balance, 0);
    assert.ok(Math.abs(total) < 1e-9, `balances must be zero-sum, got ${total}`);
  });

  it('makes two SQL queries: expenses then members', async () => {
    const pool = makePool([
      { rows: [] },
      { rows: [] },
    ]);
    const store = createExpensesStore(pool as any);

    await store.getBalances('crew-1');

    assert.strictEqual(pool.query.mock.calls.length, 2);
    const [expSql, expParams] = pool.query.mock.calls[0]!.arguments as any[];
    assert.ok(norm(expSql).includes('FROM crew_expenses'));
    assert.deepStrictEqual(expParams, ['crew-1']);
    const [memSql, memParams] = pool.query.mock.calls[1]!.arguments as any[];
    assert.ok(norm(memSql).includes('FROM crew_members'));
    assert.deepStrictEqual(memParams, ['crew-1']);
  });

  it('propagates database errors', async () => {
    const pool = makeErrorPool(new Error('deadlock detected'));
    const store = createExpensesStore(pool as any);

    await assert.rejects(
      () => store.getBalances('crew-1'),
      { message: 'deadlock detected' },
    );
  });
});
