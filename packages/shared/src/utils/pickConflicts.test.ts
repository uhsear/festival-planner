import { describe, it, expect } from 'vitest';
import { buildPickConflicts } from './pickConflicts';
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

function makeDay(overrides: Partial<FestivalDay> & { date: string }): FestivalDay {
  return {
    id: 'day-0',
    festivalId: 'fest-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function profile(userId: string, picks: Record<string, Priority>, name?: string) {
  return { userId, name, picks };
}

const DAYS: FestivalDay[] = [makeDay({ date: '2026-06-15' }), makeDay({ id: 'day-1', date: '2026-06-16' })];

describe('buildPickConflicts', () => {
  it('groups two overlapping picks (must vs maybe) and recommends keeping the must', () => {
    const sets = [
      makeSet({ id: 'a', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 'b', startTime: '14:30', endTime: '15:30' }),
    ];
    const out = buildPickConflicts({
      sets,
      myPicks: { a: 'maybe', b: 'must' },
      selectedDay: 0,
      days: DAYS,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.picks.map((p) => p.set.id)).toEqual(['a', 'b']);
    expect(out[0]!.recommendedKeepId).toBe('b');
    // Overlap is 14:30–15:00 = 30 minutes.
    expect(out[0]!.overlapMin).toBe(30);
  });

  it('does NOT flag back-to-back touching picks as a conflict', () => {
    const sets = [
      makeSet({ id: 'a', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 'b', startTime: '15:00', endTime: '16:00' }),
    ];
    const out = buildPickConflicts({
      sets,
      myPicks: { a: 'must', b: 'must' },
      selectedDay: 0,
      days: DAYS,
    });
    expect(out).toEqual([]);
  });

  it('returns [] when days are missing (no date resolution possible)', () => {
    const sets = [
      makeSet({ id: 'a', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 'b', startTime: '14:30', endTime: '15:30' }),
    ];
    const out = buildPickConflicts({
      sets,
      myPicks: { a: 'must', b: 'must' },
      selectedDay: 0,
    });
    expect(out).toEqual([]);
  });

  it('clusters a transitive 3-way chain into a single group of 3', () => {
    // a overlaps b, b overlaps c, but a does NOT overlap c — still one group.
    const sets = [
      makeSet({ id: 'a', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 'b', startTime: '14:45', endTime: '15:45' }),
      makeSet({ id: 'c', startTime: '15:30', endTime: '16:30' }),
    ];
    const out = buildPickConflicts({
      sets,
      myPicks: { a: 'maybe', b: 'must', c: 'want-to-see' },
      selectedDay: 0,
      days: DAYS,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.picks.map((p) => p.set.id)).toEqual(['a', 'b', 'c']);
    expect(out[0]!.recommendedKeepId).toBe('b');
  });

  it('excludes picks on a different day', () => {
    const sets = [
      makeSet({ id: 'a', dayIndex: 0, startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 'b', dayIndex: 1, startTime: '14:30', endTime: '15:30' }),
    ];
    const out = buildPickConflicts({
      sets,
      myPicks: { a: 'must', b: 'must' },
      selectedDay: 0,
      days: DAYS,
    });
    // Only one pick is on day 0 → no clash possible.
    expect(out).toEqual([]);
  });

  it('excludes overlapping sets that are not among my picks', () => {
    const sets = [
      makeSet({ id: 'a', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 'b', startTime: '14:30', endTime: '15:30' }), // overlaps a but not picked
    ];
    const out = buildPickConflicts({
      sets,
      myPicks: { a: 'must' },
      selectedDay: 0,
      days: DAYS,
    });
    expect(out).toEqual([]);
  });

  it('annotates crewCount and crewBreakdown when crew context is provided', () => {
    const sets = [
      makeSet({ id: 'a', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 'b', startTime: '14:30', endTime: '15:30' }),
    ];
    const out = buildPickConflicts({
      sets,
      myPicks: { a: 'maybe', b: 'must' },
      selectedDay: 0,
      days: DAYS,
      allProfiles: [
        profile('me', { a: 'maybe', b: 'must' }), // excluded (it's me)
        profile('u2', { a: 'must' }),
        profile('u3', { a: 'want-to-see', b: 'maybe' }),
        profile('stranger', { a: 'must' }), // excluded (not crew)
      ],
      crewMemberUserIds: new Set(['u2', 'u3']),
      myUserId: 'me',
    });
    expect(out).toHaveLength(1);
    const [pickA, pickB] = out[0]!.picks;
    expect(pickA!.set.id).toBe('a');
    expect(pickA!.crewCount).toBe(2);
    expect(pickA!.crewBreakdown).toBe('1 must, 1 want');
    expect(pickB!.set.id).toBe('b');
    expect(pickB!.crewCount).toBe(1);
    expect(pickB!.crewBreakdown).toBe('1 maybe');
  });

  it('leaves crew fields undefined when crew context is absent', () => {
    const sets = [
      makeSet({ id: 'a', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 'b', startTime: '14:30', endTime: '15:30' }),
    ];
    const out = buildPickConflicts({
      sets,
      myPicks: { a: 'must', b: 'maybe' },
      selectedDay: 0,
      days: DAYS,
    });
    expect(out[0]!.picks[0]!.crewCount).toBeUndefined();
    expect(out[0]!.picks[0]!.crewBreakdown).toBeUndefined();
  });

  it('sorts groups by their earliest start time', () => {
    const sets = [
      // Later clash
      makeSet({ id: 'late1', startTime: '20:00', endTime: '21:00' }),
      makeSet({ id: 'late2', startTime: '20:30', endTime: '21:30' }),
      // Earlier clash
      makeSet({ id: 'early1', startTime: '10:00', endTime: '11:00' }),
      makeSet({ id: 'early2', startTime: '10:30', endTime: '11:30' }),
    ];
    const out = buildPickConflicts({
      sets,
      myPicks: { late1: 'must', late2: 'must', early1: 'must', early2: 'must' },
      selectedDay: 0,
      days: DAYS,
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.picks.map((p) => p.set.id)).toEqual(['early1', 'early2']);
    expect(out[1]!.picks.map((p) => p.set.id)).toEqual(['late1', 'late2']);
  });

  it('computes durationMin and reports the MAX pairwise overlap', () => {
    const sets = [
      makeSet({ id: 'a', startTime: '14:00', endTime: '16:00' }), // 120m, spans both
      makeSet({ id: 'b', startTime: '14:30', endTime: '15:00' }), // overlaps a by 30m
      makeSet({ id: 'c', startTime: '15:00', endTime: '15:45' }), // overlaps a by 45m
    ];
    const out = buildPickConflicts({
      sets,
      myPicks: { a: 'must', b: 'maybe', c: 'maybe' },
      selectedDay: 0,
      days: DAYS,
    });
    expect(out).toHaveLength(1);
    const dur = Object.fromEntries(out[0]!.picks.map((p) => [p.set.id, p.durationMin]));
    expect(dur.a).toBe(120);
    expect(dur.b).toBe(30);
    expect(dur.c).toBe(45);
    // Max pairwise overlap is a∩c = 45m (a∩b is 30m; b and c only touch at 15:00).
    expect(out[0]!.overlapMin).toBe(45);
  });
});
