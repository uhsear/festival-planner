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

// Helper: create a Date in the same consistent LOCAL frame that getSetStatus
// uses internally (via createDateInLocalFrame): seed the calendar fields from
// the YYYY-MM-DD string explicitly, then apply HH:MM with local setHours. This
// never touches the JS date-string parser, so "now" and the set's computed
// start/end share one frame and the comparisons line up on ANY machine TZ.
//
// (Previously this built the day with `new Date('YYYY-MM-DD')` — UTC midnight —
// then applied local setHours. That UTC/local mix shifted every comparison by
// the host's UTC offset, so these tests only passed on UTC CI and would have
// failed for any non-UTC user. See the timezone-agnostic suite below.)
function asSetDate(dateStr: string, time: string): Date {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const date = new Date();
  date.setFullYear(y, m - 1, d);
  date.setHours(hh, mm, 0, 0);
  return date;
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
      const result = getSetStatus(makeSet({ date: '2026-06-15', endTime: undefined as unknown as string }), new Date());
      expect(result.status).toBe('tba');
    });

    it('returns tba for invalid date string', () => {
      const result = getSetStatus(makeSet({ date: 'not-a-date', startTime: '14:00', endTime: '15:00' }), new Date());
      expect(result.status).toBe('tba');
    });
  });

  describe('live status', () => {
    it('returns live when now is between start and end', () => {
      const now = asSetDate('2026-06-15', '14:30');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('live');
      expect(result.label).toBe('LIVE');
    });

    it('returns correct progress (50% at midpoint)', () => {
      const now = asSetDate('2026-06-15', '14:30');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.progress).toBeCloseTo(0.5, 1);
    });

    it('returns progress near 0 at the start', () => {
      const now = asSetDate('2026-06-15', '14:01');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.progress).toBeGreaterThan(0);
      expect(result.progress).toBeLessThan(0.1);
    });

    it('returns live exactly at start time', () => {
      const now = asSetDate('2026-06-15', '14:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('live');
      expect(result.progress).toBe(0);
    });
  });

  describe('past status', () => {
    it('returns past when set has ended', () => {
      const now = asSetDate('2026-06-15', '16:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('past');
      expect(result.label).toBe('Ended');
    });

    it('returns past exactly at end time', () => {
      const now = asSetDate('2026-06-15', '15:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('past');
    });
  });

  describe('soon status (within 30 minutes)', () => {
    it('returns soon when set starts in 15 minutes', () => {
      const now = asSetDate('2026-06-15', '13:45');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('soon');
      expect(result.label).toBe('In 15m');
      expect(result.minutesUntil).toBe(15);
    });

    it('returns soon when set starts in 1 minute', () => {
      const now = asSetDate('2026-06-15', '13:59');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('soon');
      expect(result.label).toBe('In 1m');
    });

    it('returns soon when set starts in exactly 30 minutes', () => {
      const now = asSetDate('2026-06-15', '13:30');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('soon');
      expect(result.label).toBe('In 30m');
    });
  });

  describe('upcoming status (30 min to 2 hours)', () => {
    it('returns upcoming when set starts in 1 hour', () => {
      const now = asSetDate('2026-06-15', '13:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('upcoming');
      expect(result.label).toBe('In 1h');
    });

    it('returns upcoming with hours and minutes', () => {
      const now = asSetDate('2026-06-15', '12:15');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('upcoming');
      expect(result.label).toBe('In 1h 45m');
    });

    it('returns upcoming when set starts in exactly 2 hours', () => {
      const now = asSetDate('2026-06-15', '12:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('upcoming');
      expect(result.label).toBe('In 2h');
    });
  });

  describe('later status (more than 2 hours)', () => {
    it('returns later when set starts in 5 hours', () => {
      const now = asSetDate('2026-06-15', '09:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('later');
      expect(result.label).toBe('2:00 PM');
    });

    it('returns later for a set on a future date', () => {
      const now = asSetDate('2026-06-14', '12:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('later');
    });
  });

  describe('overnight sets (end before start)', () => {
    it('handles sets that cross midnight', () => {
      const now = asSetDate('2026-06-15', '23:30');
      const set = makeSet({ date: '2026-06-15', startTime: '23:00', endTime: '01:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('live');
    });

    it('returns past for midnight-crossing set after the end time', () => {
      const now = asSetDate('2026-06-16', '02:00');
      const set = makeSet({ date: '2026-06-15', startTime: '23:00', endTime: '01:00' });
      const result = getSetStatus(set, now);
      expect(result.status).toBe('past');
    });
  });

  describe('dayIndex-based date lookup', () => {
    it('resolves date from days array when dayIndex is set', () => {
      const days = [makeDay({ date: '2026-06-14' }), makeDay({ date: '2026-06-15' })];
      const now = asSetDate('2026-06-15', '14:30');
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
      const now = asSetDate('2026-06-15', '14:30');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.progress).toBeGreaterThanOrEqual(0);
      expect(result.progress).toBeLessThanOrEqual(1);
    });

    it('progress is 0 for non-live statuses', () => {
      const now = asSetDate('2026-06-15', '13:00');
      const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });
      const result = getSetStatus(set, now);
      expect(result.progress).toBe(0);
    });
  });

  // ── Timezone-consistency regression (setstatus-tz) ───────────────────────────
  //
  // Why this matters: getSetStatus derives a set's start/end instants from a
  // `YYYY-MM-DD` day plus an `HH:MM` wall-clock time, then compares them against
  // `now`. If the day is built with one parse mode (e.g. `new Date('2026-06-15')`,
  // which the spec defines as *UTC* midnight) but the hours are applied with the
  // *local* `setHours`, every comparison is silently shifted by the machine's UTC
  // offset. A non-UTC user would then see a set flip to LIVE / Ended at the wrong
  // moment. CI runs in UTC where offset == 0, so the skew is invisible there.
  //
  // `localNow` below builds "now" purely from explicit local calendar fields
  // (setFullYear + setHours) — the exact same frame createDateInLocalFrame uses
  // inside the source. Because both sides live in the same local frame, these
  // assertions must hold on ANY machine TZ. They would NOT hold if the source
  // reverted to mixing `new Date('YYYY-MM-DD')` (UTC) with local setHours.
  describe('timezone-agnostic status transitions', () => {
    // Construct a Date from explicit local calendar fields — no string parsing,
    // so it is anchored to the host's local frame the same way the source is.
    function localNow(dateStr: string, time: string): Date {
      const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
      const [hh, mm] = time.split(':').map(Number) as [number, number];
      const date = new Date();
      date.setFullYear(y, m - 1, d);
      date.setHours(hh, mm, 0, 0);
      return date;
    }

    const set = makeSet({ date: '2026-06-15', startTime: '14:00', endTime: '15:00' });

    it('is soon at 13:45, live at 14:30, and past at 16:00 regardless of machine TZ', () => {
      expect(getSetStatus(set, localNow('2026-06-15', '13:45')).status).toBe('soon');
      expect(getSetStatus(set, localNow('2026-06-15', '14:30')).status).toBe('live');
      expect(getSetStatus(set, localNow('2026-06-15', '16:00')).status).toBe('past');
    });

    it('flips to live exactly at the wall-clock start time in the local frame', () => {
      // Just before start: not live yet.
      expect(getSetStatus(set, localNow('2026-06-15', '13:59')).status).toBe('soon');
      // At start: live with 0 progress.
      const atStart = getSetStatus(set, localNow('2026-06-15', '14:00'));
      expect(atStart.status).toBe('live');
      expect(atStart.progress).toBe(0);
    });

    it('treats a 14:00 set as live at local 14:30 even when run far from UTC', () => {
      // This assertion is the canary: under the old UTC-parse + local-setHours
      // mix, a machine offset (e.g. UTC-7) would push the computed start to a
      // different instant than `localNow` and break this on real users' devices
      // while staying green on UTC CI. With createDateInLocalFrame it holds.
      const result = getSetStatus(set, localNow('2026-06-15', '14:30'));
      expect(result.status).toBe('live');
      expect(result.progress).toBeCloseTo(0.5, 1);
    });
  });
});
