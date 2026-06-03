import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCrewWrap, createRatingsStore } from '../lib/db/stores/ratings.js';
import type { CrewWrapMember, CrewHighRating, CrewWrapBalance } from '../lib/db/stores/ratings.js';

// ---------------------------------------------------------------------------
// aggregateCrewWrap — pure superlative math (no DB)
// ---------------------------------------------------------------------------

const members: CrewWrapMember[] = [
  { userId: 'a', name: 'Alice' },
  { userId: 'b', name: 'Bob' },
  { userId: 'c', name: 'Cara' },
];

// Alice: s1(5), s2(4), s3(4)
// Bob:   s1(5), s2(5)            → shares s1,s2 with Alice (overlap 2)
// Cara:  s3(4)                   → shares s3 with Alice (overlap 1)
const highRatings: CrewHighRating[] = [
  { userId: 'a', setId: 's1', artist: 'Aphex', rating: 5 },
  { userId: 'a', setId: 's2', artist: 'Bonobo', rating: 4 },
  { userId: 'a', setId: 's3', artist: 'Caribou', rating: 4 },
  { userId: 'b', setId: 's1', artist: 'Aphex', rating: 5 },
  { userId: 'b', setId: 's2', artist: 'Bonobo', rating: 5 },
  { userId: 'c', setId: 's3', artist: 'Caribou', rating: 4 },
];

const expenses = [{ amount: '25.50' }, { amount: 10 }, { amount: '4.49' }];
const balances: CrewWrapBalance[] = [
  { userId: 'a', username: 'Alice', balance: 26.66 },
  { userId: 'b', username: 'Bob', balance: -13.33 },
  { userId: 'c', username: 'Cara', balance: -13.33 },
];

describe('aggregateCrewWrap — superlative math', () => {
  it('picks the most-overlapping pair (shared ≥4★ sets)', () => {
    const wrap = aggregateCrewWrap('crew-1', 'fest-1', members, highRatings, expenses, balances);
    assert.ok(wrap.topOverlap);
    assert.strictEqual(wrap.topOverlap!.shared, 2);
    const pair = [wrap.topOverlap!.aName, wrap.topOverlap!.bName].sort();
    assert.deepStrictEqual(pair, ['Alice', 'Bob']);
    assert.deepStrictEqual(wrap.topOverlap!.sharedSets.sort(), ['Aphex', 'Bonobo']);
  });

  it('lists all non-zero overlap pairs sorted by shared desc', () => {
    const wrap = aggregateCrewWrap('crew-1', 'fest-1', members, highRatings, expenses, balances);
    // Alice-Bob (2), Alice-Cara (1). Bob-Cara share nothing.
    assert.strictEqual(wrap.overlapMatrix.length, 2);
    assert.strictEqual(wrap.overlapMatrix[0]!.shared, 2);
    assert.strictEqual(wrap.overlapMatrix[1]!.shared, 1);
  });

  it('computes sets seen together (≥2 members rated ≥4★)', () => {
    const wrap = aggregateCrewWrap('crew-1', 'fest-1', members, highRatings, expenses, balances);
    // s1 (Alice,Bob), s2 (Alice,Bob), s3 (Alice,Cara) → all 3 sets, count 2.
    assert.strictEqual(wrap.setsSeenTogether.length, 3);
    assert.ok(wrap.setsSeenTogether.every((s) => s.count === 2));
  });

  it('sums totalSplit in cents (no float drift)', () => {
    const wrap = aggregateCrewWrap('crew-1', 'fest-1', members, highRatings, expenses, balances);
    assert.strictEqual(wrap.totalSplit, 39.99);
  });

  it('names the biggest spender (largest positive balance)', () => {
    const wrap = aggregateCrewWrap('crew-1', 'fest-1', members, highRatings, expenses, balances);
    assert.ok(wrap.biggestSpender);
    assert.strictEqual(wrap.biggestSpender!.userId, 'a');
    assert.strictEqual(wrap.biggestSpender!.name, 'Alice');
    assert.strictEqual(wrap.biggestSpender!.amount, 26.66);
  });

  it('gives each member their top-3 high-rated sets', () => {
    const wrap = aggregateCrewWrap('crew-1', 'fest-1', members, highRatings, expenses, balances);
    const alice = wrap.perMember.find((m) => m.userId === 'a')!;
    assert.strictEqual(alice.topSets.length, 3);
    assert.strictEqual(alice.topSets[0]!.rating, 5); // sorted rating desc
    const cara = wrap.perMember.find((m) => m.userId === 'c')!;
    assert.strictEqual(cara.topSets.length, 1);
  });

  it('ignores ratings from non-members (defensive)', () => {
    const withStranger: CrewHighRating[] = [...highRatings, { userId: 'zzz', setId: 's1', artist: 'Aphex', rating: 5 }];
    const wrap = aggregateCrewWrap('crew-1', 'fest-1', members, withStranger, expenses, balances);
    // s1 still only has 2 member raters, not 3.
    const s1 = wrap.setsSeenTogether.find((s) => s.setId === 's1')!;
    assert.strictEqual(s1.count, 2);
  });
});

describe('aggregateCrewWrap — graceful degradation', () => {
  it('empty crew → zeroed counts, null superlatives, no NaN', () => {
    const wrap = aggregateCrewWrap('crew-1', 'fest-1', [], [], [], []);
    assert.strictEqual(wrap.memberCount, 0);
    assert.strictEqual(wrap.topOverlap, null);
    assert.deepStrictEqual(wrap.overlapMatrix, []);
    assert.deepStrictEqual(wrap.setsSeenTogether, []);
    assert.strictEqual(wrap.totalSplit, 0);
    assert.strictEqual(wrap.biggestSpender, null);
    assert.deepStrictEqual(wrap.perMember, []);
    assert.ok(!Number.isNaN(wrap.totalSplit));
  });

  it('single-member crew → no overlap, no sets-seen-together', () => {
    const solo: CrewWrapMember[] = [{ userId: 'a', name: 'Alice' }];
    const soloRatings: CrewHighRating[] = [{ userId: 'a', setId: 's1', artist: 'Aphex', rating: 5 }];
    const wrap = aggregateCrewWrap('crew-1', 'fest-1', solo, soloRatings, [], []);
    assert.strictEqual(wrap.memberCount, 1);
    assert.strictEqual(wrap.topOverlap, null);
    assert.deepStrictEqual(wrap.setsSeenTogether, []);
    assert.strictEqual(wrap.perMember[0]!.topSets.length, 1);
  });

  it('no expenses → totalSplit 0 and no biggest spender', () => {
    const wrap = aggregateCrewWrap('crew-1', 'fest-1', members, highRatings, [], []);
    assert.strictEqual(wrap.totalSplit, 0);
    assert.strictEqual(wrap.biggestSpender, null);
  });

  it('drops a non-finite expense amount instead of poisoning the sum', () => {
    const wrap = aggregateCrewWrap(
      'crew-1',
      'fest-1',
      members,
      highRatings,
      [{ amount: '10.00' }, { amount: 'not-a-number' }],
      balances,
    );
    assert.strictEqual(wrap.totalSplit, 10);
  });
});

// ---------------------------------------------------------------------------
// getCrewWrap — store wiring (mock pool)
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
  };
}

describe('createRatingsStore.getCrewWrap — SQL wiring', () => {
  it('fetches roster + high ratings, scopes to crew + festival, filters ≥4★', async () => {
    const pool = mockPool([
      {
        rows: [
          { userId: 'a', name: 'Alice' },
          { userId: 'b', name: 'Bob' },
        ],
      },
      {
        rows: [
          { userId: 'a', setId: 's1', artist: 'Aphex', rating: 5 },
          { userId: 'b', setId: 's1', artist: 'Aphex', rating: 4 },
        ],
      },
    ]);
    const store = createRatingsStore(pool);
    const wrap = await store.getCrewWrap('crew-1', 'fest-1', {
      expenses: [{ amount: '12.00' }],
      balances: [
        { userId: 'a', username: 'Alice', balance: 6 },
        { userId: 'b', username: 'Bob', balance: -6 },
      ],
    });

    assert.strictEqual(wrap.memberCount, 2);
    assert.strictEqual(wrap.totalSplit, 12);
    assert.strictEqual(wrap.biggestSpender!.userId, 'a');
    // s1 rated ≥4 by both → seen together, and an overlap pair.
    assert.strictEqual(wrap.setsSeenTogether.length, 1);
    assert.strictEqual(wrap.topOverlap!.shared, 1);

    // Roster query scopes by crew; ratings query scopes by crew+festival and
    // filters rating >= 4.
    assert.deepStrictEqual(pool.queries[0].params, ['crew-1']);
    assert.deepStrictEqual(pool.queries[1].params, ['crew-1', 'fest-1']);
    assert.ok(pool.queries[1].sql.includes('r.rating >= 4'));
  });

  it('defaults expenses/balances to empty when omitted', async () => {
    const pool = mockPool([{ rows: [] }, { rows: [] }]);
    const store = createRatingsStore(pool);
    const wrap = await store.getCrewWrap('crew-1', 'fest-1');
    assert.strictEqual(wrap.totalSplit, 0);
    assert.strictEqual(wrap.biggestSpender, null);
  });
});

// ---------------------------------------------------------------------------
// getLifetimeStats — cross-festival YoY history (mock pool)
// ---------------------------------------------------------------------------

describe('createRatingsStore.getLifetimeStats — SQL wiring', () => {
  it('returns totals + per-festival breakdown + top artists, scoped to the user', async () => {
    const pool = mockPool([
      {
        rows: [
          {
            totalRated: 12,
            avgRating: 4.2,
            festivalsAttended: 2,
            stagesVisited: 5,
            daysAttended: 4,
            totalHours: 18.5,
          },
        ],
      },
      {
        rows: [
          {
            festivalId: 'f2',
            festivalName: 'Coast 2025',
            startDate: '2025-08-29',
            endDate: '2025-08-31',
            totalRated: 7,
            avgRating: 4.4,
            stagesVisited: 3,
            daysAttended: 3,
            totalHours: 11,
          },
          {
            festivalId: 'f1',
            festivalName: 'Coast 2024',
            startDate: '2024-08-30',
            endDate: '2024-09-01',
            totalRated: 5,
            avgRating: 3.9,
            stagesVisited: 2,
            daysAttended: 1,
            totalHours: 7.5,
          },
        ],
      },
      {
        rows: [
          { artist: 'Aphex Twin', timesRated: 2, bestRating: 5, avgRating: 5 },
          { artist: 'Bonobo', timesRated: 3, bestRating: 5, avgRating: 4.3 },
        ],
      },
    ]);
    const store = createRatingsStore(pool);
    const result = await store.getLifetimeStats('user-1');

    assert.strictEqual(result.totals.totalRated, 12);
    assert.strictEqual(result.totals.festivalsAttended, 2);
    assert.strictEqual(result.totals.totalHours, 18.5);
    assert.strictEqual(result.byFestival.length, 2);
    assert.strictEqual(result.byFestival[0].festivalId, 'f2'); // newest first
    assert.strictEqual(result.topArtists.length, 2);

    // Every query is scoped to the user id only — no festival param.
    assert.deepStrictEqual(pool.queries[0].params, ['user-1']);
    assert.deepStrictEqual(pool.queries[1].params, ['user-1']);
    assert.deepStrictEqual(pool.queries[2].params, ['user-1']);
    // Totals query must NOT carry a festival filter (un-festival-scoped scan).
    assert.ok(!pool.queries[0].sql.includes('s.festival_id ='));
    // Soft-delete filters replicated from sibling queries.
    assert.ok(pool.queries[0].sql.includes('f.deleted_at IS NULL'));
    // Per-festival breakdown groups by festival.
    assert.ok(pool.queries[1].sql.includes('GROUP BY f.id'));
  });

  it('empty archive (zero ratings) → clean zeroed totals, empty arrays, no 500', async () => {
    // Postgres returns a single row of NULLs for the COUNT/AVG totals query
    // when there are no matching rows; byFestival / topArtists come back empty.
    const pool = mockPool([
      {
        rows: [
          { totalRated: 0, avgRating: null, festivalsAttended: 0, stagesVisited: 0, daysAttended: 0, totalHours: null },
        ],
      },
      { rows: [] },
      { rows: [] },
    ]);
    const store = createRatingsStore(pool);
    const result = await store.getLifetimeStats('user-1');

    assert.strictEqual(result.totals.totalRated, 0);
    assert.strictEqual(result.totals.avgRating, 0); // null coalesced to 0
    assert.strictEqual(result.totals.totalHours, 0);
    assert.deepStrictEqual(result.byFestival, []);
    assert.deepStrictEqual(result.topArtists, []);
  });

  it('handles a totally empty totals result set without throwing', async () => {
    const pool = mockPool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const store = createRatingsStore(pool);
    const result = await store.getLifetimeStats('user-1');
    assert.strictEqual(result.totals.totalRated, 0);
    assert.strictEqual(result.totals.festivalsAttended, 0);
  });
});

describe('createRatingsStore.getAttendedFestivals — SQL wiring', () => {
  it('returns distinct festivals, scoped to the user, newest first', async () => {
    const pool = mockPool([
      {
        rows: [
          { festivalId: 'f2', festivalName: 'Coast 2025', startDate: '2025-08-29', endDate: '2025-08-31' },
          { festivalId: 'f1', festivalName: 'Coast 2024', startDate: '2024-08-30', endDate: '2024-09-01' },
        ],
      },
    ]);
    const store = createRatingsStore(pool);
    const rows = await store.getAttendedFestivals('user-1');
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].festivalId, 'f2');
    assert.deepStrictEqual(pool.queries[0].params, ['user-1']);
    assert.ok(pool.queries[0].sql.includes('f.deleted_at IS NULL'));
  });

  it('empty footprint → empty array, no throw', async () => {
    const pool = mockPool([{ rows: [] }]);
    const store = createRatingsStore(pool);
    const rows = await store.getAttendedFestivals('user-1');
    assert.deepStrictEqual(rows, []);
  });
});
