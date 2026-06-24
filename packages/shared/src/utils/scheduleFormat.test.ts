import { describe, it, expect } from 'vitest';
import { fmtCountdown, fmtClock, byStartTime, setLabel } from './scheduleFormat';
import type { FestivalSet } from '../types/domain';

// ---------------------------------------------------------------------------
// fmtCountdown
// ---------------------------------------------------------------------------

describe('fmtCountdown', () => {
  it('returns "now" when mins < 1', () => {
    expect(fmtCountdown(0)).toBe('now');
    expect(fmtCountdown(-1)).toBe('now');
  });

  it('returns "in Nm" for sub-hour countdowns', () => {
    expect(fmtCountdown(1)).toBe('in 1m');
    expect(fmtCountdown(25)).toBe('in 25m');
    expect(fmtCountdown(59)).toBe('in 59m');
  });

  it('returns "in Nh Nm" for countdowns with leftover minutes', () => {
    expect(fmtCountdown(90)).toBe('in 1h 30m');
    expect(fmtCountdown(75)).toBe('in 1h 15m');
    expect(fmtCountdown(125)).toBe('in 2h 5m');
  });

  it('omits the minutes component when it is exactly 0', () => {
    expect(fmtCountdown(60)).toBe('in 1h');
    expect(fmtCountdown(120)).toBe('in 2h');
    expect(fmtCountdown(180)).toBe('in 3h');
  });
});

// ---------------------------------------------------------------------------
// fmtClock
// ---------------------------------------------------------------------------

describe('fmtClock', () => {
  it('formats midnight as 00:00', () => {
    // Build a specific local midnight to avoid TZ ambiguity
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    expect(fmtClock(d.getTime())).toBe('00:00');
  });

  it('formats noon as 12:00', () => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    expect(fmtClock(d.getTime())).toBe('12:00');
  });

  it('zero-pads hours and minutes', () => {
    const d = new Date();
    d.setHours(9, 5, 0, 0);
    expect(fmtClock(d.getTime())).toBe('09:05');
  });

  it('formats 23:59 correctly', () => {
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    expect(fmtClock(d.getTime())).toBe('23:59');
  });
});

// ---------------------------------------------------------------------------
// byStartTime
// ---------------------------------------------------------------------------

function makeSet(startTime: string | undefined): FestivalSet {
  return {
    id: 'x',
    festivalId: 'f',
    stageId: 's',
    startTime: startTime ?? '',
    endTime: '',
    createdAt: '',
    updatedAt: '',
  };
}

describe('byStartTime', () => {
  it('sorts earlier time before later time', () => {
    const a = makeSet('14:00');
    const b = makeSet('16:00');
    expect(byStartTime(a, b)).toBeLessThan(0);
    expect(byStartTime(b, a)).toBeGreaterThan(0);
  });

  it('returns 0 for equal times', () => {
    const a = makeSet('12:00');
    const b = makeSet('12:00');
    expect(byStartTime(a, b)).toBe(0);
  });

  it('sorts sets with a startTime before sets without one', () => {
    const withTime = makeSet('10:00');
    const noTime = makeSet(undefined);
    expect(byStartTime(withTime, noTime)).toBeLessThan(0);
    expect(byStartTime(noTime, withTime)).toBeGreaterThan(0);
  });

  it('returns 0 when both sets have no startTime', () => {
    const a = makeSet(undefined);
    const b = makeSet(undefined);
    expect(byStartTime(a, b)).toBe(0);
  });

  it('produces chronological order when used with Array.sort', () => {
    const sets = [makeSet('20:00'), makeSet('12:00'), makeSet('08:00'), makeSet('15:30')];
    const sorted = [...sets].sort(byStartTime);
    expect(sorted.map((s) => s.startTime)).toEqual(['08:00', '12:00', '15:30', '20:00']);
  });
});

// ---------------------------------------------------------------------------
// setLabel
// ---------------------------------------------------------------------------

describe('setLabel', () => {
  const base: FestivalSet = {
    id: 'abc123',
    festivalId: 'f',
    stageId: 's',
    startTime: '14:00',
    endTime: '15:00',
    artist: 'Daft Punk',
    createdAt: '',
    updatedAt: '',
  };

  it('returns "Artist — HH:MM" when set has artist + startTime', () => {
    expect(setLabel(base, base.id)).toBe('Daft Punk — 14:00');
  });

  it('falls back to first artist in artists array when artist field absent', () => {
    const set = { ...base, artist: undefined, artists: [{ name: 'Bicep' }] };
    expect(setLabel(set, set.id)).toBe('Bicep — 14:00');
  });

  it('omits the time part when startTime is empty', () => {
    const set = { ...base, startTime: '' };
    expect(setLabel(set, set.id)).toBe('Daft Punk');
  });

  it('falls back to truncated id when set is undefined', () => {
    expect(setLabel(undefined, 'abc123xyz')).toBe('Set abc123');
  });

  it('falls back to truncated id + time when neither artist nor artists present', () => {
    // The fallback id is still combined with the startTime when present.
    const set = { ...base, artist: undefined, artists: undefined };
    expect(setLabel(set, 'abc123xyz')).toBe('Set abc123 — 14:00');
  });

  it('falls back to truncated id only when no artist, no artists, and no startTime', () => {
    const set = { ...base, artist: undefined, artists: undefined, startTime: '' };
    expect(setLabel(set, 'abc123xyz')).toBe('Set abc123');
  });
});
