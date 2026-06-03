import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planReformRoster } from '../lib/crew-reform.js';
import createCrewsStore from '../lib/db/stores/crews.js';

// ---------------------------------------------------------------------------
// Mock pool factory (mirrors tests/stores-crews-notifications.test.ts)
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
// planReformRoster — the consent-safe roster split
// =====================================================================
describe('planReformRoster', () => {
  it('auto-adds members WITH a target-festival profile, invites the rest', () => {
    const members = [
      { userId: 'owner', role: 'owner' },
      { userId: 'a', role: 'member' }, // has profile -> auto-add
      { userId: 'b', role: 'member' }, // no profile -> invite
      { userId: 'c', role: 'member' }, // has profile -> auto-add
    ];
    const plan = planReformRoster(members, 'owner', ['a', 'c', 'someone-else']);
    assert.deepStrictEqual(plan.toAutoAdd, ['a', 'c']);
    assert.deepStrictEqual(plan.toInvite, ['b']);
  });

  it('never includes the requester in either list (they become owner)', () => {
    const members = [
      { userId: 'me', role: 'owner' },
      { userId: 'x', role: 'member' },
    ];
    // Even if the requester somehow has a target profile, they are excluded.
    const plan = planReformRoster(members, 'me', ['me', 'x']);
    assert.ok(!plan.toAutoAdd.includes('me'));
    assert.ok(!plan.toInvite.includes('me'));
    assert.deepStrictEqual(plan.toAutoAdd, ['x']);
  });

  it('is idempotent: members already on the new crew are skipped', () => {
    const members = [
      { userId: 'owner', role: 'owner' },
      { userId: 'a', role: 'member' },
      { userId: 'b', role: 'member' },
    ];
    // a + b both have profiles, but a is already on the new crew (a re-run).
    const plan = planReformRoster(members, 'owner', ['a', 'b'], ['owner', 'a']);
    assert.deepStrictEqual(plan.toAutoAdd, ['b']);
    assert.deepStrictEqual(plan.toInvite, []);
  });

  it('produces empty lists on a second identical run (full idempotency)', () => {
    const members = [
      { userId: 'owner', role: 'owner' },
      { userId: 'a', role: 'member' },
    ];
    // First run added a; second run passes the post-run roster as existing.
    const plan = planReformRoster(members, 'owner', ['a'], ['owner', 'a']);
    assert.deepStrictEqual(plan.toAutoAdd, []);
    assert.deepStrictEqual(plan.toInvite, []);
  });

  it('de-dups a roster that lists the same user twice', () => {
    const members = [
      { userId: 'a', role: 'member' },
      { userId: 'a', role: 'member' },
      { userId: 'b', role: 'member' },
    ];
    const plan = planReformRoster(members, 'owner', ['a']);
    assert.deepStrictEqual(plan.toAutoAdd, ['a']);
    assert.deepStrictEqual(plan.toInvite, ['b']);
  });

  it('treats everyone as invite-only when nobody has a target profile', () => {
    const members = [
      { userId: 'owner', role: 'owner' },
      { userId: 'a', role: 'member' },
      { userId: 'b', role: 'member' },
    ];
    const plan = planReformRoster(members, 'owner', []);
    assert.deepStrictEqual(plan.toAutoAdd, []);
    assert.deepStrictEqual(plan.toInvite, ['a', 'b']);
  });

  it('skips falsy/blank userIds defensively', () => {
    const members = [{ userId: 'a', role: 'member' }, { userId: '', role: 'member' }, { role: 'member' } as any];
    const plan = planReformRoster(members, 'owner', ['a']);
    assert.deepStrictEqual(plan.toAutoAdd, ['a']);
    assert.deepStrictEqual(plan.toInvite, []);
  });
});

// =====================================================================
// crews store — reformed_from threading (mock pool)
// =====================================================================
describe('createCrewsStore — reformed_from lineage', () => {
  it('create() inserts reformed_from and selects it back', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 1 }, // INSERT
      { rows: [{ id: 'crew2', reformedFrom: 'crew1' }] }, // SELECT
    ]);
    const { crews } = createCrewsStore(pool, {});

    const row = await crews.create({
      id: 'crew2',
      festivalId: 'fest2',
      name: 'Reformed',
      createdBy: 'owner',
      inviteCode: 'ABC123',
      maxMembers: 30,
      reformedFrom: 'crew1',
    });

    const insertSql = norm(pool.queries[0].sql);
    assert.ok(insertSql.includes('reformed_from'), 'INSERT lists reformed_from column');
    // reformed_from is the 8th positional param.
    assert.strictEqual(pool.queries[0].params[7], 'crew1');
    assert.strictEqual(row.reformedFrom, 'crew1');
    // The select projects reformed_from AS "reformedFrom".
    assert.ok(norm(pool.queries[1].sql).includes('reformed_from AS "reformedFrom"'));
  });

  it('create() passes NULL reformed_from for a normal crew', async () => {
    const pool = mockPool([{ rows: [], rowCount: 1 }, { rows: [{ id: 'crew1', reformedFrom: null }] }]);
    const { crews } = createCrewsStore(pool, {});

    await crews.create({
      id: 'crew1',
      festivalId: 'fest1',
      name: 'Original',
      createdBy: 'owner',
      inviteCode: 'XYZ789',
      maxMembers: 30,
    });

    assert.strictEqual(pool.queries[0].params[7], null, 'reformed_from defaults to null');
  });

  it('getById() projects reformed_from', async () => {
    const pool = mockPool([{ rows: [{ id: 'crew2', reformedFrom: 'crew1' }] }]);
    const { crews } = createCrewsStore(pool, {});

    const row = await crews.getById('crew2');
    assert.ok(norm(pool.queries[0].sql).includes('reformed_from AS "reformedFrom"'));
    assert.strictEqual(row.reformedFrom, 'crew1');
  });
});
