import { describe, it, expect } from 'vitest';
import { getSetStatus } from './useSetStatus';
import type { FestivalSet, FestivalDay } from '@festie/shared/types';

function makeSet(overrides: Partial<FestivalSet> = {}): FestivalSet {
  return {
    id: 'set-1',
    festivalId: 'fest-1',
    stageId: 'stage-1',
    startTime: '14:00',
    endTime: '15:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeDay(overrides: Partial<FestivalDay> = {}): FestivalDay {
  return {
    id: 'day-1',
    festivalId: 'fest-1',
    date: '2026-06-15',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('getSetStatus', () => {
  describe('TBA cases', () => {
    it('returns tba when date is missing', () => {
      const result = getSetStatus(makeSet({ date: undefined }), new Date());
      expect(result.status).toBe('tba');
      expect(result.label).toBe('TBA');
      expect(result.minutesUntil).toBe(Infinity);
    });

    it('returns tba when startTime is missing', () => {
      const result = getSetStatus(
        makeSet({ date: '2026-06-15', startTime: undefined as unknown as string }),
        new Date(),
      );
      expect(result.status).toBe('tba');
    });

    it('returns tba when endTime is missing', () => {
      const result = getSetStatus(
        makeSet({ date: '2026-06-15', endTime: undefined as unknown as string }),
        new Date(),
      );
      expect(result.status).toBe('tba');
    });

    it('returns tba for invalid date string', () => {
      const result = getSetStatus(
        makeSet({ date: 'not-a-date', startTime: '14:00', endTime: '15:00' }),
        new Date(),
      );
      expect(result.status).toBe('tba');
    });
  });

  describe('live status', () => {
    it('returns live when now is between start and end', () => {
      const now = new Date('2026-06-15T14:30:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('live');
      expect(result.label).toBe('LIVE');
    });

    it('returns correct progress (50% at midpoint)', () => {
      const now = new Date('2026-06-15T14:30:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.progress).toBeCloseTo(0.5, 1);
    });

    it('returns progress near 0 at the start', () => {
      const now = new Date('2026-06-15T14:01:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.progress).toBeGreaterThan(0);
      expect(result.progress).toBeLessThan(0.1);
    });

    it('returns live exactly at start time', () => {
      const now = new Date('2026-06-15T14:00:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('live');
      expect(result.progress).toBe(0);
    });
  });

  describe('past status', () => {
    it('returns past when set has ended', () => {
      const now = new Date('2026-06-15T16:00:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('past');
      expect(result.label).toBe('Ended');
    });

    it('returns past exactly at end time', () => {
      const now = new Date('2026-06-15T15:00:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('past');
    });
  });

  describe('soon status (within 30 minutes)', () => {
    it('returns soon when set starts in 15 minutes', () => {
      const now = new Date('2026-06-15T13:45:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('soon');
      expect(result.label).toBe('In 15m');
      expect(result.minutesUntil).toBe(15);
    });

    it('returns soon when set starts in 1 minute', () => {
      const now = new Date('2026-06-15T13:59:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('soon');
      expect(result.label).toBe('In 1m');
    });

    it('returns soon when set starts in exactly 30 minutes', () => {
      const now = new Date('2026-06-15T13:30:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('soon');
      expect(result.label).toBe('In 30m');
    });
  });

  describe('upcoming status (30 min to 2 hours)', () => {
    it('returns upcoming when set starts in 1 hour', () => {
      const now = new Date('2026-06-15T13:00:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('upcoming');
      expect(result.label).toBe('In 1h');
    });

    it('returns upcoming with hours and minutes', () => {
      const now = new Date('2026-06-15T12:15:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('upcoming');
      expect(result.label).toBe('In 1h 45m');
    });

    it('returns upcoming when set starts in exactly 2 hours', () => {
      const now = new Date('2026-06-15T12:00:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('upcoming');
      expect(result.label).toBe('In 2h');
    });
  });

  describe('later status (more than 2 hours)', () => {
    it('returns later when set starts in 5 hours', () => {
      const now = new Date('2026-06-15T09:00:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('later');
      expect(result.label).toBe('2:00 PM');
    });

    it('returns later for a set on a future date', () => {
      const now = new Date('2026-06-14T12:00:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('later');
    });
  });

  describe('overnight sets (end before start)', () => {
    it('handles sets that cross midnight', () => {
      const now = new Date('2026-06-15T23:30:00');
      const set = makeSet({ date: '2026-06-15', startTime: '23:00', endTime: '01:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('live');
    });

    it('returns past for midnight-crossing set after the end time', () => {
      const now = new Date('2026-06-16T02:00:00');
      const set = makeSet({ date: '2026-06-15', startTime: '23:00', endTime: '01:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('past');
    });
  });

  describe('dayIndex-based date lookup', () => {
    it('resolves date from days array when dayIndex is set', () => {
      const days = [
        makeDay({ date: '2026-06-14' }),
        makeDay({ date: '2026-06-15' }),
      ];
      const now = new Date('2026-06-15T14:30:00');
      const set = makeSet({
        date: undefined,
        dayIndex: 1,
        startTime: '14:00',
        endTime: '15:00',
      });
      const result = getSetStatus(set, now, days);
      expect(result.status).toBe('live');
    });

    it('returns tba when dayIndex points to nonexistent day', () => {
      const days: FestivalDay[] = [];
      const now = new Date();
      const set = makeSet({
        date: undefined,
        dayIndex: 5,
        startTime: '14:00',
        endTime: '15:00',
      });
      const result = getSetStatus(set, now, days);
      expect(result.status).toBe('tba');
    });
  });

  describe('edge cases', () => {
    it('progress is clamped between 0 and 1', () => {
      const now = new Date('2026-06-15T14:30:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.progress).toBeGreaterThanOrEqual(0);
      expect(result.progress).toBeLessThanOrEqual(1);
    });

    it('progress is 0 for non-live statuses', () => {
      const now = new Date('2026-06-15T13:00:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.progress).toBe(0);
    });
  });
});
