import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Helper: mock pool factory (same pattern as stores-polls.test.ts)
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
// lib/db/stores/crews.ts — createCrewsStore().crewPacking
// ---------------------------------------------------------------------------
describe('lib/db/stores/crews.ts — crewPacking sub-store', () => {
  let createCrewsStore: any;

  beforeEach(async () => {
    const mod = await import('../lib/db/stores/crews.js');
    createCrewsStore = mod.default;
  });

  function makeStore(queryResults: any[] = []) {
    const pool = makePool(queryResults);
    const store = createCrewsStore(pool, {}).crewPacking;
    return { store, pool };
  }

  // =========================================================================
  // create()
  // =========================================================================
  describe('create', () => {
    it('inserts an item and returns the created row', async () => {
      const createdRow = {
        id: 'pack-abc',
        crew_id: 'crew-1',
        created_by: 'user-1',
        label: 'Tent',
        brought_by: null,
        claimed: false,
        created_at: '2026-06-03T12:00:00Z',
      };
      // create() issues INSERT then a SELECT for the row.
      const { store, pool } = makeStore([{ rows: [] }, { rows: [createdRow] }]);

      const result = await store.create({
        id: 'pack-abc',
        crewId: 'crew-1',
        createdBy: 'user-1',
        label: 'Tent',
      });

      assert.deepStrictEqual(result, createdRow);
      assert.strictEqual(pool.query.mock.calls.length, 2);
      const insert = pool.query.mock.calls[0]!;
      assert.ok((insert.arguments as any[])[0].includes('INSERT INTO'));
      assert.ok((insert.arguments as any[])[0].includes('crew_packing_items'));
      // Params: [id, crewId, createdBy, label, broughtBy(null), claimed(false)]
      const params = (insert.arguments as any[])[1];
      assert.strictEqual(params[0], 'pack-abc');
      assert.strictEqual(params[1], 'crew-1');
      assert.strictEqual(params[2], 'user-1');
      assert.strictEqual(params[3], 'Tent');
      assert.strictEqual(params[4], null);
      assert.strictEqual(params[5], false);
    });

    it('passes broughtBy + claimed through when provided', async () => {
      const { store, pool } = makeStore([{ rows: [] }, { rows: [{ id: 'pack-x' }] }]);
      await store.create({
        id: 'pack-x',
        crewId: 'crew-1',
        createdBy: 'user-1',
        label: 'Cooler',
        broughtBy: 'user-2',
        claimed: true,
      });
      const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
      assert.strictEqual(params[4], 'user-2');
      assert.strictEqual(params[5], true);
    });

    it('returns null when the row is not found after insert', async () => {
      const { store } = makeStore([{ rows: [] }, { rows: [] }]);
      const result = await store.create({
        id: 'pack-y',
        crewId: 'crew-1',
        createdBy: 'user-1',
        label: 'Chairs',
      });
      assert.strictEqual(result, null);
    });
  });

  // =========================================================================
  // listByCrew()
  // =========================================================================
  describe('listByCrew', () => {
    it('selects items for the crew, claimed-last then oldest-first', async () => {
      const rows = [
        { id: 'pack-1', crew_id: 'crew-1', label: 'Tent', claimed: false },
        { id: 'pack-2', crew_id: 'crew-1', label: 'Cooler', claimed: true },
      ];
      const { store, pool } = makeStore([{ rows }]);

      const result = await store.listByCrew('crew-1');

      assert.deepStrictEqual(result, rows);
      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]!;
      const sql = (call.arguments as any[])[0];
      assert.ok(sql.includes('FROM') && sql.includes('crew_packing_items'));
      assert.ok(sql.includes('ORDER BY'));
      assert.ok(sql.includes('claimed'));
      assert.deepStrictEqual((call.arguments as any[])[1], ['crew-1']);
    });
  });

  // =========================================================================
  // update()
  // =========================================================================
  describe('update', () => {
    it('maps camelCase fields to columns and returns the updated row', async () => {
      const updated = { id: 'pack-1', label: 'Big Tent', brought_by: 'user-2', claimed: true };
      // update() issues UPDATE then a SELECT.
      const { store, pool } = makeStore([{ rows: [] }, { rows: [updated] }]);

      const result = await store.update('pack-1', { label: 'Big Tent', broughtBy: 'user-2', claimed: true });

      assert.deepStrictEqual(result, updated);
      const upd = pool.query.mock.calls[0]!;
      const sql = (upd.arguments as any[])[0];
      assert.ok(sql.startsWith('UPDATE crew_packing_items SET'));
      assert.ok(sql.includes('label = $1'));
      assert.ok(sql.includes('brought_by = $2'));
      assert.ok(sql.includes('claimed = $3'));
      // Final param is the id at the trailing placeholder.
      const params = (upd.arguments as any[])[1];
      assert.deepStrictEqual(params, ['Big Tent', 'user-2', true, 'pack-1']);
    });

    it('updates a single field (claimed) and clears brought_by when passed null', async () => {
      const { store, pool } = makeStore([{ rows: [] }, { rows: [{ id: 'pack-1' }] }]);
      await store.update('pack-1', { claimed: false, broughtBy: null });
      const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
      // Order matches Object.entries iteration: claimed then broughtBy, then id.
      assert.deepStrictEqual(params, [false, null, 'pack-1']);
    });

    it('returns null and issues no query when no known fields are given', async () => {
      const { store, pool } = makeStore([]);
      const result = await store.update('pack-1', { bogus: 'x' } as any);
      assert.strictEqual(result, null);
      assert.strictEqual(pool.query.mock.calls.length, 0);
    });
  });

  // =========================================================================
  // delete() / getById() / countByCrew()
  // =========================================================================
  describe('delete / getById / countByCrew', () => {
    it('delete issues a DELETE with the id', async () => {
      const { store, pool } = makeStore([{ rows: [] }]);
      await store.delete('pack-1');
      const call = pool.query.mock.calls[0]!;
      assert.ok((call.arguments as any[])[0].includes('DELETE FROM crew_packing_items'));
      assert.deepStrictEqual((call.arguments as any[])[1], ['pack-1']);
    });

    it('getById returns the row or null', async () => {
      const row = { id: 'pack-1', crew_id: 'crew-1' };
      const { store } = makeStore([{ rows: [row] }]);
      assert.deepStrictEqual(await store.getById('pack-1'), row);

      const { store: empty } = makeStore([{ rows: [] }]);
      assert.strictEqual(await empty.getById('missing'), null);
    });

    it('countByCrew returns the integer count', async () => {
      const { store, pool } = makeStore([{ rows: [{ count: 3 }] }]);
      const count = await store.countByCrew('crew-1');
      assert.strictEqual(count, 3);
      const call = pool.query.mock.calls[0]!;
      assert.ok((call.arguments as any[])[0].includes('COUNT(*)'));
      assert.deepStrictEqual((call.arguments as any[])[1], ['crew-1']);
    });
  });
});
