import { describe, it, expect } from 'vitest';
import { buildCrewNudges, PRIORITY_RANK, buildOverlapBreakdown } from './crewNudges';
import type { FestivalSet, FestivalDay, Priority } from '../types/domain';

function makeSet(overrides: Partial<FestivalSet> & { id: string }): FestivalSet {
  return {
    festivalId: 'fest-1',
    stageId: 'stage-1',
    dayIndex: 0,
    startTime: '14:00',
    endTime: '15:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function profile(userId: string, picks: Record<string, Priority>, name?: string) {
  return { userId, name, picks };
}

describe('PRIORITY_RANK', () => {
  it('orders must < want-to-see < maybe (lower rank sorts first)', () => {
    expect(PRIORITY_RANK.must).toBeLessThan(PRIORITY_RANK['want-to-see']);
    expect(PRIORITY_RANK['want-to-see']).toBeLessThan(PRIORITY_RANK.maybe);
  });
});

describe('buildOverlapBreakdown', () => {
  it('summarizes counts in must > want > maybe order, omitting empties', () => {
    expect(buildOverlapBreakdown([{ priority: 'must' }, { priority: 'must' }, { priority: 'want-to-see' }])).toBe(
      '2 must, 1 want',
    );
  });

  it('returns empty string for an empty list', () => {
    expect(buildOverlapBreakdown([])).toBe('');
  });
});

describe('buildCrewNudges', () => {
  const crew = new Set(['u2', 'u3', 'u4']);

  it('excludes sets I have already picked', () => {
    const sets = [makeSet({ id: 's1' })];
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: { s1: 'maybe' },
      allProfiles: [profile('u2', { s1: 'must' }), profile('u3', { s1: 'must' })],
      crewMemberUserIds: crew,
      myUserId: 'me',
    });
    expect(out).toEqual([]);
  });

  it('excludes non-crew profiles from the backer aggregation', () => {
    const sets = [makeSet({ id: 's1' })];
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles: [
        profile('u2', { s1: 'must' }), // crew
        profile('stranger', { s1: 'must' }), // not crew
      ],
      crewMemberUserIds: crew,
      myUserId: 'me',
    });
    // Only one crew backer and no must threshold issue — one 'must' passes threshold.
    expect(out).toHaveLength(1);
    expect(out[0]!.backers.map((b) => b.userId)).toEqual(['u2']);
  });

  it('excludes my own profile even if it is in the crew set', () => {
    const sets = [makeSet({ id: 's1' })];
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles: [profile('me', { s1: 'must' }), profile('u2', { s1: 'want-to-see' })],
      crewMemberUserIds: new Set(['me', 'u2']),
      myUserId: 'me',
    });
    // Only u2 counts (1 backer, not 'must') — fails threshold (need >=2 OR a must).
    expect(out).toEqual([]);
  });

  it('dedupes a user with two profiles to one vote at their highest priority', () => {
    const sets = [makeSet({ id: 's1' })];
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles: [
        profile('u2', { s1: 'maybe' }),
        profile('u2', { s1: 'must' }), // same human, higher priority wins
      ],
      crewMemberUserIds: crew,
      myUserId: 'me',
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.backers).toHaveLength(1);
    expect(out[0]!.backers[0]!.priority).toBe('must');
    expect(out[0]!.count).toBe(1);
  });

  it('applies the threshold: a single non-must backer fails, 2+ backers pass', () => {
    const sets = [makeSet({ id: 'one' }), makeSet({ id: 'two' })];
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles: [
        // 'one' has a single non-must backer -> fails threshold
        profile('u2', { one: 'maybe' }),
        // 'two' has two backers -> passes
        profile('u3', { two: 'maybe' }),
        profile('u4', { two: 'want-to-see' }),
      ],
      crewMemberUserIds: new Set(['u2', 'u3', 'u4']),
      myUserId: 'me',
    });
    const ids = out.map((n) => n.set.id);
    expect(ids).toContain('two');
    expect(ids).not.toContain('one');
  });

  it('passes threshold for a single must backer', () => {
    const sets = [makeSet({ id: 's1' })];
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles: [profile('u2', { s1: 'must' })],
      crewMemberUserIds: crew,
      myUserId: 'me',
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.topPriority).toBe('must');
  });

  it('ranks by weighted score: two musts (6) beat three maybes (3)', () => {
    const sets = [makeSet({ id: 'threeMaybe', startTime: '10:00' }), makeSet({ id: 'twoMust', startTime: '11:00' })];
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles: [
        profile('u2', { threeMaybe: 'maybe', twoMust: 'must' }),
        profile('u3', { threeMaybe: 'maybe', twoMust: 'must' }),
        profile('u4', { threeMaybe: 'maybe' }),
      ],
      crewMemberUserIds: crew,
      myUserId: 'me',
    });
    expect(out.map((n) => n.set.id)).toEqual(['twoMust', 'threeMaybe']);
  });

  it('breaks score ties deterministically by mustCount, then count, then startTime, then id', () => {
    // Both sets score 4 (one must+one want each = 3+... no): craft equal scores.
    // setA: must (3) + maybe (1) = 4, mustCount 1
    // setB: want (2) + want (2) = 4, mustCount 0 -> setA ranks first
    const sets = [makeSet({ id: 'setB', startTime: '09:00' }), makeSet({ id: 'setA', startTime: '10:00' })];
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles: [
        profile('u2', { setA: 'must', setB: 'want-to-see' }),
        profile('u3', { setA: 'maybe', setB: 'want-to-see' }),
      ],
      crewMemberUserIds: crew,
      myUserId: 'me',
    });
    expect(out.map((n) => n.set.id)).toEqual(['setA', 'setB']);
  });

  it('only considers sets on the selected day', () => {
    const sets = [makeSet({ id: 'd0', dayIndex: 0 }), makeSet({ id: 'd1', dayIndex: 1 })];
    const out = buildCrewNudges({
      sets,
      selectedDay: 1,
      myPicks: {},
      allProfiles: [profile('u2', { d0: 'must', d1: 'must' })],
      crewMemberUserIds: crew,
      myUserId: 'me',
    });
    expect(out.map((n) => n.set.id)).toEqual(['d1']);
  });

  it('excludes past sets when now + days are given', () => {
    const days: FestivalDay[] = [
      {
        id: 'day-0',
        festivalId: 'fest-1',
        date: '2026-06-15',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    const sets = [
      makeSet({ id: 'over', dayIndex: 0, startTime: '10:00', endTime: '11:00' }),
      makeSet({ id: 'later', dayIndex: 0, startTime: '20:00', endTime: '21:00' }),
    ];
    const allProfiles = [profile('u2', { over: 'must', later: 'must' })];
    // now = 2026-06-15 12:00 local
    const now = new Date(2026, 5, 15, 12, 0, 0).getTime();
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles,
      crewMemberUserIds: crew,
      myUserId: 'me',
      now,
      days,
    });
    expect(out.map((n) => n.set.id)).toEqual(['later']);
  });

  it('returns empty when solo (no crew members)', () => {
    const sets = [makeSet({ id: 's1' })];
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles: [profile('u2', { s1: 'must' })],
      crewMemberUserIds: new Set<string>(),
      myUserId: 'me',
    });
    expect(out).toEqual([]);
  });

  it('returns empty when there is no overlap', () => {
    const sets = [makeSet({ id: 's1' })];
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles: [profile('u2', {})],
      crewMemberUserIds: crew,
      myUserId: 'me',
    });
    expect(out).toEqual([]);
  });

  it('caps the result to the limit (default 5)', () => {
    const sets = Array.from({ length: 8 }, (_, i) => makeSet({ id: `s${i}`, startTime: `1${i}:00` }));
    // Every set gets a single must backer -> all pass threshold.
    const picks: Record<string, Priority> = {};
    for (let i = 0; i < 8; i++) picks[`s${i}`] = 'must';
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles: [profile('u2', picks)],
      crewMemberUserIds: crew,
      myUserId: 'me',
    });
    expect(out).toHaveLength(5);
  });

  it('honors a custom limit', () => {
    const sets = Array.from({ length: 4 }, (_, i) => makeSet({ id: `s${i}`, startTime: `1${i}:00` }));
    const picks: Record<string, Priority> = {};
    for (let i = 0; i < 4; i++) picks[`s${i}`] = 'must';
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles: [profile('u2', picks)],
      crewMemberUserIds: crew,
      myUserId: 'me',
      limit: 2,
    });
    expect(out).toHaveLength(2);
  });

  it('returns backers sorted must > want > maybe and exposes breakdown', () => {
    const sets = [makeSet({ id: 's1' })];
    const out = buildCrewNudges({
      sets,
      selectedDay: 0,
      myPicks: {},
      allProfiles: [
        profile('u2', { s1: 'maybe' }, 'Mara'),
        profile('u3', { s1: 'must' }, 'Theo'),
        profile('u4', { s1: 'want-to-see' }, 'Wes'),
      ],
      crewMemberUserIds: crew,
      myUserId: 'me',
    });
    expect(out).toHaveLength(1);
    const nudge = out[0]!;
    expect(nudge.backers.map((b) => b.priority)).toEqual(['must', 'want-to-see', 'maybe']);
    expect(nudge.count).toBe(3);
    expect(nudge.topPriority).toBe('must');
    expect(buildOverlapBreakdown(nudge.backers)).toBe('1 must, 1 want, 1 maybe');
  });
});
