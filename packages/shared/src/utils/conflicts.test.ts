import { describe, it, expect } from 'vitest';
import { detectConflicts, getConflictingSetIds, hasConflict } from './conflicts';
import type { FestivalSet, Priority } from '../types/domain';

function makeSet(overrides: Partial<FestivalSet> & { id: string }): FestivalSet {
  return {
    festivalId: 'fest-1',
    stageId: 'stage-1',
    startTime: '14:00',
    endTime: '15:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('detectConflicts', () => {
  it('returns empty array when no sets are picked', () => {
    const sets = [makeSet({ id: 's1' }), makeSet({ id: 's2' })];
    const getMyPick = () => undefined;
    expect(detectConflicts(sets, getMyPick)).toEqual([]);
  });

  it('returns empty array for non-overlapping picked sets', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 's2', startTime: '15:00', endTime: '16:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    expect(detectConflicts(sets, getMyPick)).toEqual([]);
  });

  it('detects overlapping picked sets', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:30' }),
      makeSet({ id: 's2', startTime: '15:00', endTime: '16:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'want-to-see' };
    const getMyPick = (id: string) => picks[id];
    const conflicts = detectConflicts(sets, getMyPick);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.overlapMinutes).toBe(30);
  });

  it('does not duplicate conflicts (same pair)', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '16:00' }),
      makeSet({ id: 's2', startTime: '15:00', endTime: '17:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    const conflicts = detectConflicts(sets, getMyPick);
    expect(conflicts).toHaveLength(1);
  });

  it('handles sets that wrap past midnight', () => {
    // The +1440 adjustment is per-set, so a 23:00-01:00 set becomes 23:00-25:00
    // but a 00:00-02:00 set stays 0-120. These ranges don't overlap in this model.
    // Overlap only detected when both sets are in the same midnight-relative window.
    const sets = [
      makeSet({ id: 's1', startTime: '23:00', endTime: '01:00' }),
      makeSet({ id: 's2', startTime: '23:30', endTime: '00:30' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'maybe' };
    const getMyPick = (id: string) => picks[id];
    const conflicts = detectConflicts(sets, getMyPick);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.overlapMinutes).toBe(60);
  });

  it('ignores sets without start/end time', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 's2', startTime: '', endTime: '' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    expect(detectConflicts(sets, getMyPick)).toEqual([]);
  });

  it('detects multiple conflicts among three sets', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:30' }),
      makeSet({ id: 's2', startTime: '15:00', endTime: '16:30' }),
      makeSet({ id: 's3', startTime: '16:00', endTime: '17:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must', s3: 'must' };
    const getMyPick = (id: string) => picks[id];
    const conflicts = detectConflicts(sets, getMyPick);
    expect(conflicts).toHaveLength(2);
  });
});

describe('getConflictingSetIds', () => {
  it('returns empty set when no conflicts', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 's2', startTime: '16:00', endTime: '17:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    const ids = getConflictingSetIds(sets, getMyPick);
    expect(ids.size).toBe(0);
  });

  it('returns both set IDs from a conflict', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:30' }),
      makeSet({ id: 's2', startTime: '15:00', endTime: '16:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    const ids = getConflictingSetIds(sets, getMyPick);
    expect(ids.has('s1')).toBe(true);
    expect(ids.has('s2')).toBe(true);
  });
});

describe('hasConflict', () => {
  it('returns false for a set with no conflicts', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 's2', startTime: '16:00', endTime: '17:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    expect(hasConflict('s1', sets, getMyPick)).toBe(false);
  });

  it('returns true for a set with a conflict', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:30' }),
      makeSet({ id: 's2', startTime: '15:00', endTime: '16:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    expect(hasConflict('s1', sets, getMyPick)).toBe(true);
  });
});

describe('multi-day conflict handling (S-3)', () => {
  const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
  const getMyPick = (id: string) => picks[id];

  it('does NOT flag the same clock time on different festival days', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }),
      makeSet({ id: 's2', startTime: '14:00', endTime: '15:00', dayIndex: 1 }),
    ];
    expect(detectConflicts(sets, getMyPick)).toEqual([]);
    expect(getConflictingSetIds(sets, getMyPick).size).toBe(0);
  });

  it('still flags overlapping sets on the SAME day', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }),
      makeSet({ id: 's2', startTime: '14:30', endTime: '15:30', dayIndex: 0 }),
    ];
    expect(detectConflicts(sets, getMyPick)).toHaveLength(1);
  });

  it('falls back to time-only when dayIndex is absent (single-day festivals)', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 's2', startTime: '14:30', endTime: '15:30' }),
    ];
    expect(detectConflicts(sets, getMyPick)).toHaveLength(1);
  });
});

describe('all-TBA festival (S-8) — no set has start/end times', () => {
  it('reports zero conflicts when every picked set is TBA', () => {
    const sets = [
      makeSet({ id: 's1', startTime: undefined, endTime: undefined }),
      makeSet({ id: 's2', startTime: undefined, endTime: undefined }),
      makeSet({ id: 's3', startTime: undefined, endTime: undefined }),
    ];
    const getMyPick = () => 'must' as Priority;
    expect(detectConflicts(sets, getMyPick)).toEqual([]);
    expect(getConflictingSetIds(sets, getMyPick).size).toBe(0);
  });

  it('reports only the timed overlaps in a mixed timed + TBA lineup', () => {
    const sets = [
      makeSet({ id: 'timed-a', startTime: '14:00', endTime: '15:00', dayIndex: 0 }),
      makeSet({ id: 'timed-b', startTime: '14:30', endTime: '15:30', dayIndex: 0 }),
      makeSet({ id: 'tba', startTime: undefined, endTime: undefined }),
    ];
    const getMyPick = () => 'must' as Priority;
    const conflicts = detectConflicts(sets, getMyPick);
    expect(conflicts).toHaveLength(1);
    const ids = [conflicts[0]!.setA.id, conflicts[0]!.setB.id].sort();
    expect(ids).toEqual(['timed-a', 'timed-b']);
  });
});
