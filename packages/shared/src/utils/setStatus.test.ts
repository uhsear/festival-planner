import { describe, it, expect } from 'vitest';
import { getSetTimeBounds, getSetStatus } from './setStatus';
import type { FestivalSet, FestivalDay } from '../types/domain';

function makeSet(overrides: Partial<FestivalSet> = {}): FestivalSet {
  return {
    id: 's1',
    festivalId: 'f1',
    stageId: 'st1',
    startTime: '20:00',
    endTime: '21:00',
    date: '2026-09-04',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// Reconstruct the expected local-frame epoch-ms for a YYYY-MM-DD + HH:MM, the
// same way createDateInLocalFrame does, so assertions are TZ-independent.
function localMs(dateStr: string, hh: number, mm: number, dayOffset = 0): number {
  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  const dt = new Date();
  dt.setFullYear(y!, m! - 1, d! + dayOffset);
  dt.setHours(hh, mm, 0, 0);
  return dt.getTime();
}

describe('getSetTimeBounds', () => {
  it('resolves start/end to local-frame epoch-ms for a same-day set', () => {
    const bounds = getSetTimeBounds(makeSet({ startTime: '20:00', endTime: '21:30' }));
    expect(bounds).not.toBeNull();
    expect(bounds!.startMs).toBe(localMs('2026-09-04', 20, 0));
    expect(bounds!.endMs).toBe(localMs('2026-09-04', 21, 30));
  });

  it('rolls a post-midnight end PAST midnight (end <= start → +1 day)', () => {
    // 23:30 → 01:00 crosses midnight; the end must land on the next calendar day.
    const bounds = getSetTimeBounds(makeSet({ startTime: '23:30', endTime: '01:00' }));
    expect(bounds).not.toBeNull();
    expect(bounds!.startMs).toBe(localMs('2026-09-04', 23, 30));
    expect(bounds!.endMs).toBe(localMs('2026-09-04', 1, 0, 1));
    // The end must be AFTER the start (positive duration), never before it.
    expect(bounds!.endMs).toBeGreaterThan(bounds!.startMs);
  });

  it('rolls forward when end EQUALS start (a 24h-long edge — still +1 day)', () => {
    const bounds = getSetTimeBounds(makeSet({ startTime: '12:00', endTime: '12:00' }));
    expect(bounds!.endMs).toBe(localMs('2026-09-04', 12, 0, 1));
    expect(bounds!.endMs).toBeGreaterThan(bounds!.startMs);
  });

  it('assumes a one-hour set when endTime is missing', () => {
    const bounds = getSetTimeBounds({ startTime: '20:00', endTime: '', date: '2026-09-04' });
    expect(bounds!.endMs - bounds!.startMs).toBe(60 * 60_000);
  });

  it('prefers the festival days[] date via dayIndex over set.date', () => {
    const days: FestivalDay[] = [{ date: '2026-09-05', dayIndex: 0 }] as FestivalDay[];
    const bounds = getSetTimeBounds(makeSet({ date: '2026-09-04', dayIndex: 0, startTime: '10:00' }), days);
    expect(bounds!.startMs).toBe(localMs('2026-09-05', 10, 0));
  });

  it('returns null for a missing/invalid date (TBA)', () => {
    expect(getSetTimeBounds(makeSet({ date: undefined, dayIndex: undefined }))).toBeNull();
    expect(getSetTimeBounds(makeSet({ date: 'not-a-date' }))).toBeNull();
  });

  it('returns null when startTime is missing', () => {
    expect(getSetTimeBounds(makeSet({ startTime: '' }))).toBeNull();
  });
});

describe('getSetStatus consumes getSetTimeBounds (parity)', () => {
  it('reports a post-midnight set as LIVE just after midnight', () => {
    const set = makeSet({ startTime: '23:30', endTime: '01:00' });
    // 00:30 on the NEXT day is within [23:30, 01:00+1d].
    const now = new Date(localMs('2026-09-04', 0, 30, 1));
    expect(getSetStatus(set, now).status).toBe('live');
  });

  it('still returns TBA when endTime is absent (status path unchanged)', () => {
    const set = makeSet({ endTime: '' });
    expect(getSetStatus(set, new Date(localMs('2026-09-04', 20, 30))).status).toBe('tba');
  });
});
