import { describe, it, expect } from 'vitest';
import { meetAtTimeOfDay, meetingOccurrences, nextMeetingOccurrence, meetingTimeDisplay } from './meetingTime';

// Three festival days. Times resolved in UTC in the zoned-path tests so the
// assertions are deterministic regardless of the CI/host time zone.
const DAYS = [{ date: '2026-09-04' }, { date: '2026-09-05' }, { date: '2026-09-06' }];

// 3:00 PM UTC on the middle day — the "first set" instant for a recurring point.
const MEET_AT_3PM_UTC = '2026-09-05T15:00:00Z';

describe('meetAtTimeOfDay', () => {
  it('reads the wall-clock time-of-day in the given zone', () => {
    expect(meetAtTimeOfDay(MEET_AT_3PM_UTC, 'UTC')).toEqual({ hours: 15, minutes: 0 });
  });

  it('shifts the time-of-day into a different zone', () => {
    // 15:00Z is 11:00 in America/New_York (EDT, UTC-4) on 2026-09-05.
    expect(meetAtTimeOfDay(MEET_AT_3PM_UTC, 'America/New_York')).toEqual({ hours: 11, minutes: 0 });
  });

  it('returns null for missing/garbage input', () => {
    expect(meetAtTimeOfDay(null)).toBeNull();
    expect(meetAtTimeOfDay(undefined)).toBeNull();
    expect(meetAtTimeOfDay('not-a-date', 'UTC')).toBeNull();
  });
});

describe('meetingOccurrences', () => {
  it('one-shot: a single occurrence at the literal meetAt instant', () => {
    const occ = meetingOccurrences(MEET_AT_3PM_UTC, false, DAYS, 'UTC');
    expect(occ).toHaveLength(1);
    expect(occ[0]!.dayKey).toBe('2026-09-05');
    expect(occ[0]!.ms).toBe(new Date(MEET_AT_3PM_UTC).getTime());
  });

  it('recurring: one occurrence per festival day at the same time-of-day', () => {
    const occ = meetingOccurrences(MEET_AT_3PM_UTC, true, DAYS, 'UTC');
    expect(occ.map((o) => o.dayKey)).toEqual(['2026-09-04', '2026-09-05', '2026-09-06']);
    // Each lands at 15:00 UTC on its day.
    expect(occ[0]!.ms).toBe(new Date('2026-09-04T15:00:00Z').getTime());
    expect(occ[1]!.ms).toBe(new Date('2026-09-05T15:00:00Z').getTime());
    expect(occ[2]!.ms).toBe(new Date('2026-09-06T15:00:00Z').getTime());
  });

  it('recurring occurrences are sorted ascending by instant', () => {
    const shuffled = [{ date: '2026-09-06' }, { date: '2026-09-04' }, { date: '2026-09-05' }];
    const occ = meetingOccurrences(MEET_AT_3PM_UTC, true, shuffled, 'UTC');
    const ms = occ.map((o) => o.ms);
    expect(ms).toEqual([...ms].sort((a, b) => a - b));
  });

  it('skips malformed day-keys', () => {
    const occ = meetingOccurrences(MEET_AT_3PM_UTC, true, [{ date: 'nope' }, { date: '2026-09-05' }], 'UTC');
    expect(occ).toHaveLength(1);
    expect(occ[0]!.dayKey).toBe('2026-09-05');
  });

  it('returns empty for missing meetAt', () => {
    expect(meetingOccurrences(null, true, DAYS, 'UTC')).toEqual([]);
    expect(meetingOccurrences(undefined, false, DAYS, 'UTC')).toEqual([]);
  });
});

describe('nextMeetingOccurrence', () => {
  it('returns the first occurrence at/after now', () => {
    // now = day 1 noon → next recurring 3pm is day 1.
    const now = new Date('2026-09-04T12:00:00Z');
    const next = nextMeetingOccurrence(MEET_AT_3PM_UTC, true, DAYS, now, 'UTC');
    expect(next!.dayKey).toBe('2026-09-04');
  });

  it('rolls to the next day once the current day occurrence has passed', () => {
    // now = day 1 at 4pm (past 3pm) → next is day 2.
    const now = new Date('2026-09-04T16:00:00Z');
    const next = nextMeetingOccurrence(MEET_AT_3PM_UTC, true, DAYS, now, 'UTC');
    expect(next!.dayKey).toBe('2026-09-05');
  });

  it('falls back to the most-recent occurrence when all are past', () => {
    const now = new Date('2026-09-09T00:00:00Z'); // after the festival
    const next = nextMeetingOccurrence(MEET_AT_3PM_UTC, true, DAYS, now, 'UTC');
    expect(next!.dayKey).toBe('2026-09-06');
  });

  it('returns null when there are no occurrences', () => {
    expect(nextMeetingOccurrence(null, true, DAYS, new Date(), 'UTC')).toBeNull();
  });
});

describe('meetingTimeDisplay', () => {
  it('recurring → "daily <time>" label in the festival zone', () => {
    const d = meetingTimeDisplay(MEET_AT_3PM_UTC, true, DAYS, new Date('2026-09-04T12:00:00Z'), 'UTC');
    expect(d.recurring).toBe(true);
    expect(d.label).toBe('daily 3:00 PM');
    expect(d.next!.dayKey).toBe('2026-09-04');
  });

  it('recurring label reflects the festival zone, not UTC', () => {
    // 15:00Z = 11:00 EDT → "daily 11:00 AM".
    const d = meetingTimeDisplay(MEET_AT_3PM_UTC, true, DAYS, new Date('2026-09-04T00:00:00Z'), 'America/New_York');
    expect(d.label).toBe('daily 11:00 AM');
  });

  it('one-shot → weekday + time label for the concrete instant', () => {
    const d = meetingTimeDisplay(MEET_AT_3PM_UTC, false, DAYS, new Date('2026-09-01T00:00:00Z'), 'UTC');
    expect(d.recurring).toBe(false);
    // 2026-09-05 is a Saturday; 15:00 UTC.
    expect(d.label).toBe('Sat 3:00 PM');
    expect(d.next!.ms).toBe(new Date(MEET_AT_3PM_UTC).getTime());
  });

  it('no meetAt → empty label and null next', () => {
    const d = meetingTimeDisplay(null, true, DAYS, new Date(), 'UTC');
    expect(d.label).toBe('');
    expect(d.next).toBeNull();
  });
});
