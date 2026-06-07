import { describe, it, expect } from 'vitest';
import {
  festivalStatus,
  isFestivalOver,
  hasSetStarted,
  isValidTimeZone,
  resolveFestivalTimeZone,
} from './festivalTime';
import type { Festival } from '../types/domain';

function fest(overrides: Partial<Festival> = {}): Festival {
  return {
    id: 'f1',
    name: 'Test Fest',
    startDate: '2026-09-04',
    endDate: '2026-09-06',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('isValidTimeZone', () => {
  it('accepts a valid IANA zone', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects empty/garbage zones', () => {
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
});

describe('resolveFestivalTimeZone', () => {
  it('returns the festival zone when present and valid', () => {
    expect(resolveFestivalTimeZone(fest({ timeZone: 'America/New_York' }))).toBe('America/New_York');
  });

  it('returns undefined when absent or invalid (device-local fallback)', () => {
    expect(resolveFestivalTimeZone(fest())).toBeUndefined();
    expect(resolveFestivalTimeZone(fest({ timeZone: 'bogus' }))).toBeUndefined();
    expect(resolveFestivalTimeZone(null)).toBeUndefined();
  });
});

describe('festivalStatus', () => {
  it("returns 'past' after the final day's 23:59", () => {
    expect(festivalStatus(fest(), undefined, new Date('2026-09-07T00:00:00'))).toBe('past');
  });

  it("returns 'upcoming' before the first day", () => {
    expect(festivalStatus(fest(), undefined, new Date('2026-08-01T00:00:00'))).toBe('upcoming');
  });

  it("returns 'ongoing' during the festival", () => {
    expect(festivalStatus(fest(), undefined, new Date('2026-09-05T12:00:00'))).toBe('ongoing');
  });

  it('prefers inline days[] over start/end dates', () => {
    const f = fest({ startDate: '', endDate: '' });
    const days = [{ date: '2026-09-04' }, { date: '2026-09-06' }];
    expect(festivalStatus(f, days, new Date('2026-09-07T00:00:00'))).toBe('past');
    expect(festivalStatus(f, days, new Date('2026-08-01T00:00:00'))).toBe('upcoming');
  });

  it('returns null when no dates are available', () => {
    expect(festivalStatus(fest({ startDate: '', endDate: '' }), undefined, new Date())).toBeNull();
    expect(festivalStatus(null)).toBeNull();
  });

  // Regression: festival bounds must be anchored to the device's LOCAL wall
  // clock, not a UTC-parsed instant. The injected `now` is built from local
  // calendar fields, so the comparison must agree with local midnight/23:59
  // regardless of the machine's UTC offset (CI runs UTC; users do not).
  it('anchors bounds to the local wall clock (non-UTC safe)', () => {
    // `now` constructed via local fields — one minute past the last day's 23:59.
    const justPast = new Date();
    justPast.setFullYear(2026, 8, 7); // 2026-09-07 (month is 0-based)
    justPast.setHours(0, 0, 0, 0);
    expect(festivalStatus(fest(), undefined, justPast)).toBe('past');

    // The prior local day, 23:59 — still before the first day's 00:00.
    const justBefore = new Date();
    justBefore.setFullYear(2026, 8, 3); // 2026-09-03
    justBefore.setHours(23, 59, 0, 0);
    expect(festivalStatus(fest(), undefined, justBefore)).toBe('upcoming');

    // Squarely inside the window, late local night (where a UTC vs local parse
    // of 23:59 would diverge for negative-offset zones).
    const lateNight = new Date();
    lateNight.setFullYear(2026, 8, 6); // 2026-09-06
    lateNight.setHours(23, 30, 0, 0);
    expect(festivalStatus(fest(), undefined, lateNight)).toBe('ongoing');
  });
});

describe('isFestivalOver / hasSetStarted (local-frame)', () => {
  const days = [{ date: '2026-09-04' }, { date: '2026-09-05' }, { date: '2026-09-06' }];

  it('isFestivalOver flips at the last day local 23:59', () => {
    // A long-past festival is over; a far-future one is not — independent of TZ
    // because both bounds and `new Date()` share the same local frame.
    // (isFestivalOver reads the days array, not startDate/endDate.)
    expect(isFestivalOver(fest(), [{ date: '2000-01-01' }, { date: '2000-01-02' }])).toBe(true);
    expect(isFestivalOver(fest(), [{ date: '2099-01-01' }, { date: '2099-01-02' }])).toBe(false);
  });

  it('isFestivalOver returns false for missing/invalid dates', () => {
    expect(isFestivalOver(undefined)).toBe(false);
    expect(isFestivalOver(fest(), [])).toBe(false);
    expect(isFestivalOver(fest(), [{ date: null }])).toBe(false);
  });

  it('hasSetStarted is false for a future-dated set, true for a past one', () => {
    const futureFest = fest({ startDate: '2099-09-04', endDate: '2099-09-06' });
    const futureDays = [{ date: '2099-09-04' }, { date: '2099-09-05' }, { date: '2099-09-06' }];
    expect(hasSetStarted({ startTime: '20:00', dayIndex: 1 }, futureFest, futureDays)).toBe(false);

    const pastFest = fest({ startDate: '2000-09-04', endDate: '2000-09-06' });
    const pastDays = [{ date: '2000-09-04' }, { date: '2000-09-05' }, { date: '2000-09-06' }];
    expect(hasSetStarted({ startTime: '20:00', dayIndex: 1 }, pastFest, pastDays)).toBe(true);
  });

  it('hasSetStarted falls back to isFestivalOver when the set has no time', () => {
    expect(hasSetStarted({ startTime: null, dayIndex: 0 }, fest(), days)).toBe(isFestivalOver(fest(), days));
  });
});
