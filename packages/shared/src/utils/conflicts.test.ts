import { describe, it, expect } from 'vitest';
import {
  detectConflicts,
  getConflictingSetIds,
  findAlternatives,
  hasConflict,
} from './conflicts';
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

describe('findAlternatives', () => {
  it('returns empty array when target set not found', () => {
    expect(findAlternatives('nonexistent', [], () => undefined)).toEqual([]);
  });

  it('returns empty array when target set has no times', () => {
    const sets = [makeSet({ id: 's1', startTime: '', endTime: '' })];
    expect(findAlternatives('s1', sets, () => undefined)).toEqual([]);
  });

  it('finds alternatives on different stages at overlapping times', () => {
    const target = makeSet({ id: 's1', stageId: 'stage-a', startTime: '14:00', endTime: '15:00' });
    const alt = makeSet({ id: 's2', stageId: 'stage-b', startTime: '14:00', endTime: '15:00' });
    const noOverlap = makeSet({ id: 's3', stageId: 'stage-c', startTime: '18:00', endTime: '19:00' });

    const sets = [target, alt, noOverlap];
    const getMyPick = (id: string) => (id === 's1' ? 'must' as Priority : undefined);
    const result = findAlternatives('s1', sets, getMyPick);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('s2');
  });

  it('excludes already-picked sets from alternatives', () => {
    const target = makeSet({ id: 's1', stageId: 'stage-a', startTime: '14:00', endTime: '15:00' });
    const alreadyPicked = makeSet({ id: 's2', stageId: 'stage-b', startTime: '14:00', endTime: '15:00' });

    const sets = [target, alreadyPicked];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    const result = findAlternatives('s1', sets, getMyPick);
    expect(result).toHaveLength(0);
  });

  it('excludes sets on the same stage', () => {
    const target = makeSet({ id: 's1', stageId: 'stage-a', startTime: '14:00', endTime: '15:00' });
    const sameStage = makeSet({ id: 's2', stageId: 'stage-a', startTime: '14:00', endTime: '15:00' });

    const sets = [target, sameStage];
    const getMyPick = (id: string) => (id === 's1' ? 'must' as Priority : undefined);
    const result = findAlternatives('s1', sets, getMyPick);
    expect(result).toHaveLength(0);
  });

  it('respects the limit parameter', () => {
    const target = makeSet({ id: 's1', stageId: 'stage-a', startTime: '14:00', endTime: '16:00' });
    const alts = Array.from({ length: 5 }, (_, i) =>
      makeSet({ id: `alt-${i}`, stageId: `stage-${i + 1}`, startTime: '14:00', endTime: '15:00' }),
    );
    const sets = [target, ...alts];
    const getMyPick = (id: string) => (id === 's1' ? 'must' as Priority : undefined);
    const result = findAlternatives('s1', sets, getMyPick, 2);
    expect(result).toHaveLength(2);
  });
});
