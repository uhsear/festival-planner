import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Helper: mock pool factory (same pattern as stores-crew-packing.test.ts)
// ---------------------------------------------------------------------------
function makePool(queryResults: any[] = []) {
  let callIdx = 0;
  const query = mock.fn(async () => {
    const result = queryResults[callIdx] || { rows: [] };
    callIdx++;
    return result;
  });
  return { query };
}

// ---------------------------------------------------------------------------
// lib/db/stores/crews.ts — createCrewsStore().crewStatus (M5)
// ---------------------------------------------------------------------------
describe('lib/db/stores/crews.ts — crewStatus sub-store', () => {
  let createCrewsStore: any;

  beforeEach(async () => {
    const mod = await import('../lib/db/stores/crews.js');
    createCrewsStore = mod.default;
  });

  function makeStore(queryResults: any[] = []) {
    const pool = makePool(queryResults);
    const store = createCrewsStore(pool, {}).crewStatus;
    return { store, pool };
  }

  // =========================================================================
  // upsert()
  // =========================================================================
  describe('upsert', () => {
    it('upserts a member status and returns the row', async () => {
      const row = {
        crew_id: 'crew-1',
        user_id: 'user-1',
        status: 'on-my-way',
        target_meeting_point_id: 'mp-1',
        eta_minutes: 12,
        note: null,
        updated_at: '2026-06-03T12:00:00Z',
      };
      // upsert() issues INSERT ... ON CONFLICT then a SELECT for the row.
      const { store, pool } = makeStore([{ rows: [] }, { rows: [row] }]);

      const result = await store.upsert({
        crewId: 'crew-1',
        userId: 'user-1',
        status: 'on-my-way',
        targetMeetingPointId: 'mp-1',
        etaMinutes: 12,
      });

      assert.deepStrictEqual(result, row);
      assert.strictEqual(pool.query.mock.calls.length, 2);
      const insert = pool.query.mock.calls[0]!;
      const sql = (insert.arguments as any[])[0];
      assert.ok(sql.includes('INSERT INTO'));
      assert.ok(sql.includes('crew_member_status'));
      assert.ok(sql.includes('ON CONFLICT'));
      // Params: [crewId, userId, status, targetMeetingPointId, etaMinutes, note]
      const params = (insert.arguments as any[])[1];
      assert.strictEqual(params[0], 'crew-1');
      assert.strictEqual(params[1], 'user-1');
      assert.strictEqual(params[2], 'on-my-way');
      assert.strictEqual(params[3], 'mp-1');
      assert.strictEqual(params[4], 12);
      assert.strictEqual(params[5], null);
    });

    it('coerces missing fields to null (a status-only / clear update)', async () => {
      const { store, pool } = makeStore([{ rows: [] }, { rows: [{ crew_id: 'crew-1', user_id: 'user-1' }] }]);
      await store.upsert({ crewId: 'crew-1', userId: 'user-1' });
      const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
      assert.strictEqual(params[2], null); // status
      assert.strictEqual(params[3], null); // targetMeetingPointId
      assert.strictEqual(params[4], null); // etaMinutes
      assert.strictEqual(params[5], null); // note
    });

    it('returns null when the row is not found after upsert', async () => {
      const { store } = makeStore([{ rows: [] }, { rows: [] }]);
      const result = await store.upsert({ crewId: 'crew-1', userId: 'user-1', status: 'here' });
      assert.strictEqual(result, null);
    });
  });

  // =========================================================================
  // listByCrew()
  // =========================================================================
  describe('listByCrew', () => {
    it('selects statuses for the crew joined to users, newest-synced first', async () => {
      const rows = [
        { crew_id: 'crew-1', user_id: 'user-1', status: 'on-my-way', updated_at: '2026-06-03T12:05:00Z' },
        { crew_id: 'crew-1', user_id: 'user-2', status: 'here', updated_at: '2026-06-03T12:00:00Z' },
      ];
      const { store, pool } = makeStore([{ rows }]);

      const result = await store.listByCrew('crew-1');

      assert.deepStrictEqual(result, rows);
      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]!;
      const sql = (call.arguments as any[])[0];
      assert.ok(sql.includes('FROM') && sql.includes('crew_member_status'));
      assert.ok(sql.includes('JOIN users'));
      assert.ok(sql.includes('ORDER BY'));
      assert.ok(sql.includes('updated_at'));
      assert.deepStrictEqual((call.arguments as any[])[1], ['crew-1']);
    });
  });
});
