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

    // 055: offline presence breadcrumb (latitude/longitude/location_captured_at).
    it('threads the 055 location breadcrumb into the INSERT params + SELECTs the columns', async () => {
      const { store, pool } = makeStore([{ rows: [] }, { rows: [{ crew_id: 'crew-1', user_id: 'user-1' }] }]);
      await store.upsert({
        crewId: 'crew-1',
        userId: 'user-1',
        status: 'on-my-way',
        latitude: 41.85,
        longitude: -87.65,
        locationCapturedAt: '2026-06-14T12:00:00.000Z',
      });
      const insert = pool.query.mock.calls[0]!;
      const sql = (insert.arguments as any[])[0];
      assert.ok(sql.includes('latitude'));
      assert.ok(sql.includes('longitude'));
      assert.ok(sql.includes('location_captured_at'));
      // COALESCE preserves a prior breadcrumb on a status-only update.
      assert.ok(sql.includes('COALESCE'));
      const params = (insert.arguments as any[])[1];
      // [crewId, userId, status, targetMeetingPointId, etaMinutes, note, lat, lng, capturedAt]
      assert.strictEqual(params[6], 41.85);
      assert.strictEqual(params[7], -87.65);
      assert.strictEqual(params[8], '2026-06-14T12:00:00.000Z');
      // The post-upsert SELECT returns the breadcrumb columns (snake_case).
      const select = (pool.query.mock.calls[1]!.arguments as any[])[0];
      assert.ok(select.includes('latitude'));
      assert.ok(select.includes('longitude'));
      assert.ok(select.includes('location_captured_at'));
    });

    it('passes null breadcrumb coords on a status-only update (no position)', async () => {
      const { store, pool } = makeStore([{ rows: [] }, { rows: [{ crew_id: 'crew-1', user_id: 'user-1' }] }]);
      await store.upsert({ crewId: 'crew-1', userId: 'user-1', status: 'here' });
      const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
      assert.strictEqual(params[6], null); // latitude
      assert.strictEqual(params[7], null); // longitude
      assert.strictEqual(params[8], null); // location_captured_at
    });

    it('preserves latitude=0 / longitude=0 (treats 0 as a real coord)', async () => {
      const { store, pool } = makeStore([{ rows: [] }, { rows: [{ crew_id: 'crew-1', user_id: 'user-1' }] }]);
      await store.upsert({
        crewId: 'crew-1',
        userId: 'user-1',
        latitude: 0,
        longitude: 0,
        locationCapturedAt: '2026-06-14T12:00:00.000Z',
      });
      const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
      assert.strictEqual(params[6], 0);
      assert.strictEqual(params[7], 0);
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
      // 055: the list returns the offline presence breadcrumb columns (snake).
      assert.ok(sql.includes('latitude'));
      assert.ok(sql.includes('longitude'));
      assert.ok(sql.includes('location_captured_at'));
      assert.deepStrictEqual((call.arguments as any[])[1], ['crew-1']);
    });
  });
});
