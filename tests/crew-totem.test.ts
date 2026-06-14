import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import createCrewsStore from '../lib/db/stores/crews.js';

// ---------------------------------------------------------------------------
// Mock pool factory (mirrors tests/crew-reform.test.ts)
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
    connect: async () => ({
      query: async (sql: any, params: any) => {
        queries.push({ sql, params });
        const result = queryResults[callIndex] || { rows: [], rowCount: 0 };
        callIndex++;
        return result;
      },
      release: () => {},
    }),
  };
}

const norm = (s: any) => String(s).replace(/\s+/g, ' ').trim();

// =====================================================================
// crews store — totem_name / totem_emoji threading (mock pool)
// =====================================================================
describe('createCrewsStore — crew totem', () => {
  it('create() inserts totem columns and threads the values', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 1 }, // INSERT
      { rows: [{ id: 'crew1', totemName: 'Flamingo Squad', totemEmoji: '🦩' }] }, // SELECT
    ]);
    const { crews } = createCrewsStore(pool, {});

    const row = await crews.create({
      id: 'crew1',
      festivalId: 'fest1',
      name: 'Flamingos',
      createdBy: 'owner',
      inviteCode: 'ABC123',
      maxMembers: 30,
      totemName: 'Flamingo Squad',
      totemEmoji: '🦩',
    });

    const insertSql = norm(pool.queries[0].sql);
    assert.ok(insertSql.includes('totem_name'), 'INSERT lists totem_name column');
    assert.ok(insertSql.includes('totem_emoji'), 'INSERT lists totem_emoji column');
    // totem_name / totem_emoji are the 9th and 10th positional params.
    assert.strictEqual(pool.queries[0].params[8], 'Flamingo Squad');
    assert.strictEqual(pool.queries[0].params[9], '🦩');
    assert.strictEqual(row.totemName, 'Flamingo Squad');
    assert.strictEqual(row.totemEmoji, '🦩');
    // The select projects the snake → camel aliases.
    assert.ok(norm(pool.queries[1].sql).includes('totem_name AS "totemName"'));
    assert.ok(norm(pool.queries[1].sql).includes('totem_emoji AS "totemEmoji"'));
  });

  it('create() defaults both totem columns to null when omitted', async () => {
    const pool = mockPool([{ rows: [], rowCount: 1 }, { rows: [{ id: 'crew2', totemName: null, totemEmoji: null }] }]);
    const { crews } = createCrewsStore(pool, {});

    await crews.create({
      id: 'crew2',
      festivalId: 'fest1',
      name: 'Plain',
      createdBy: 'owner',
      inviteCode: 'XYZ789',
      maxMembers: 30,
    });

    assert.strictEqual(pool.queries[0].params[8], null, 'totem_name defaults to null');
    assert.strictEqual(pool.queries[0].params[9], null, 'totem_emoji defaults to null');
  });

  it('createWithOwner() inserts totem columns and threads the values', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 1 }, // INSERT crews
      { rows: [], rowCount: 1 }, // INSERT crew_members
      { rows: [{ id: 'crew3', totemName: 'Tree', totemEmoji: '🌳' }] }, // SELECT
    ]);
    const { crews } = createCrewsStore(pool, {});

    const row = await crews.createWithOwner({
      id: 'crew3',
      festivalId: 'fest1',
      name: 'Treehouse',
      createdBy: 'owner',
      inviteCode: 'TREE01',
      maxMembers: 30,
      totemName: 'Tree',
      totemEmoji: '🌳',
    });

    const insertSql = norm(pool.queries[0].sql);
    assert.ok(insertSql.includes('totem_name'), 'INSERT lists totem_name column');
    assert.ok(insertSql.includes('totem_emoji'), 'INSERT lists totem_emoji column');
    assert.strictEqual(pool.queries[0].params[8], 'Tree');
    assert.strictEqual(pool.queries[0].params[9], '🌳');
    assert.strictEqual(row.totemName, 'Tree');
    assert.strictEqual(row.totemEmoji, '🌳');
  });

  it('update() includes totem columns in the SET clause and threads values', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 1 }, // UPDATE
      { rows: [{ id: 'crew1', totemName: 'New Sign', totemEmoji: '🚩' }] }, // SELECT
    ]);
    const { crews } = createCrewsStore(pool, {});

    const row = await crews.update({
      id: 'crew1',
      name: 'Flamingos',
      maxMembers: 30,
      totemName: 'New Sign',
      totemEmoji: '🚩',
    });

    const updateSql = norm(pool.queries[0].sql);
    assert.ok(updateSql.includes('totem_name ='), 'UPDATE SET includes totem_name');
    assert.ok(updateSql.includes('totem_emoji ='), 'UPDATE SET includes totem_emoji');
    // params: name, max_members, totem_name, totem_emoji, id
    assert.deepStrictEqual(pool.queries[0].params, ['Flamingos', 30, 'New Sign', '🚩', 'crew1']);
    assert.strictEqual(row.totemName, 'New Sign');
    assert.strictEqual(row.totemEmoji, '🚩');
  });

  it('update() omits totem columns from SET when not provided', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 1 }, // UPDATE
      { rows: [{ id: 'crew1' }] }, // SELECT
    ]);
    const { crews } = createCrewsStore(pool, {});

    await crews.update({ id: 'crew1', name: 'Renamed', maxMembers: 20 });

    const updateSql = norm(pool.queries[0].sql);
    assert.ok(!updateSql.includes('totem_name ='), 'UPDATE SET omits totem_name when absent');
    assert.ok(!updateSql.includes('totem_emoji ='), 'UPDATE SET omits totem_emoji when absent');
    // Only name, max_members, id are bound.
    assert.deepStrictEqual(pool.queries[0].params, ['Renamed', 20, 'crew1']);
  });

  it('getById() projects the snake → camel totem aliases', async () => {
    const pool = mockPool([{ rows: [{ id: 'crew1', totemName: 'Flag', totemEmoji: '🏴' }] }]);
    const { crews } = createCrewsStore(pool, {});

    const row = await crews.getById('crew1');
    const sql = norm(pool.queries[0].sql);
    assert.ok(sql.includes('totem_name AS "totemName"'));
    assert.ok(sql.includes('totem_emoji AS "totemEmoji"'));
    assert.strictEqual(row.totemName, 'Flag');
    assert.strictEqual(row.totemEmoji, '🏴');
  });
});
