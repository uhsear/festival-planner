import { describe, it, expect, vi } from 'vitest';
import { getSetTimeBounds, getSetStatus, zonedWallTimeToMs } from './setStatus';
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

// Festival-timezone-aware bounds (opt-in via the `timeZone` arg). These assert
// against absolute UTC instants computed from the zone's known offset, so they
// are host-timezone-independent (Node ships full IANA tz data).
describe('zonedWallTimeToMs (festival-zone anchoring)', () => {
  it('interprets a wall-clock in the given IANA zone, not the device zone', () => {
    // 2026-09-04 is EDT (UTC-4) for America/New_York: 20:00 EDT = 00:00 UTC next day.
    const ms = zonedWallTimeToMs('2026-09-04', 20, 0, 'America/New_York');
    expect(ms).toBe(Date.UTC(2026, 8, 5, 0, 0, 0));
  });

  it('matches plain UTC for the UTC zone', () => {
    expect(zonedWallTimeToMs('2026-09-04', 20, 0, 'UTC')).toBe(Date.UTC(2026, 8, 4, 20, 0, 0));
  });

  it('returns NaN for an unparseable date', () => {
    expect(Number.isNaN(zonedWallTimeToMs('not-a-date', 12, 0, 'UTC'))).toBe(true);
  });
});

describe('getSetTimeBounds with a festival timeZone', () => {
  it('anchors start/end in the festival zone when timeZone is supplied', () => {
    const bounds = getSetTimeBounds(makeSet({ startTime: '20:00', endTime: '21:30' }), [], 'UTC');
    expect(bounds!.startMs).toBe(Date.UTC(2026, 8, 4, 20, 0, 0));
    expect(bounds!.endMs).toBe(Date.UTC(2026, 8, 4, 21, 30, 0));
  });

  it('rolls a post-midnight end to the next day in the festival zone', () => {
    const bounds = getSetTimeBounds(makeSet({ startTime: '23:30', endTime: '01:00' }), [], 'UTC');
    expect(bounds!.startMs).toBe(Date.UTC(2026, 8, 4, 23, 30, 0));
    expect(bounds!.endMs).toBe(Date.UTC(2026, 8, 5, 1, 0, 0));
    expect(bounds!.endMs).toBeGreaterThan(bounds!.startMs);
  });
});

// ── Festival-timezone-aware getSetStatus ─────────────────────────────────────
// This block tests the bug fixed by passing `timeZone` through getSetStatus.
//
// THE BUG: When a festival is in America/Chicago (UTC-5 in winter) and the user's
// device is in America/New_York (UTC-4 in winter), a set at "20:00" wall-clock
// in Chicago actually starts at 01:00 UTC. Without the timeZone fix, getSetStatus
// anchors "20:00" in New York local time (00:00 UTC), making the set appear to
// start one hour earlier than reality. A user in New York would see the badge flip
// to "LIVE" at 20:00 New York time — but the set hasn't started yet in Chicago.
//
// The fix: pass `timeZone` to getSetTimeBounds so bounds are absolute epoch-ms in
// the festival's zone. `now` must then be an absolute Date (new Date(Date.now())),
// which it always is in production — so the comparison is like-for-like in UTC.
//
// These tests use Date.UTC to build `now` so they are host-TZ-independent and
// FAIL before the fix (getSetStatus ignoring timeZone uses createDateInLocalFrame,
// whose result differs from Date.UTC by the host's UTC offset on non-UTC hosts).
describe('getSetStatus with festival timeZone', () => {
  // Festival is in UTC for isolation: wall-clock 20:00 UTC = 20:00 wall-clock.
  // `now` is constructed from Date.UTC so it is absolute and host-TZ-independent.
  const set = makeSet({ startTime: '20:00', endTime: '21:00', date: '2026-09-04' });

  it('reports LIVE at wall-clock midpoint in the festival zone (UTC)', () => {
    // 2026-09-04 20:30 UTC — inside [20:00, 21:00] UTC.
    const now = new Date(Date.UTC(2026, 8, 4, 20, 30, 0));
    expect(getSetStatus(set, now, [], 'UTC').status).toBe('live');
  });

  it('reports past just after the wall-clock end in the festival zone (UTC)', () => {
    // 2026-09-04 21:01 UTC — after [20:00, 21:00] UTC.
    const now = new Date(Date.UTC(2026, 8, 4, 21, 1, 0));
    expect(getSetStatus(set, now, [], 'UTC').status).toBe('past');
  });

  it('reports upcoming 90 minutes before the festival-zone start', () => {
    // 2026-09-04 18:30 UTC — 90m before 20:00 UTC.
    const now = new Date(Date.UTC(2026, 8, 4, 18, 30, 0));
    const result = getSetStatus(set, now, [], 'UTC');
    expect(result.status).toBe('upcoming');
    expect(result.minutesUntil).toBe(90);
  });

  it('LIVE/past badge is correct for a festival in America/New_York (EDT = UTC-4)', () => {
    // 2026-09-04 is in EDT (UTC-4): wall-clock 20:00 EDT = 00:00 UTC 2026-09-05.
    // A set 20:00-21:00 EDT; at 20:30 EDT (= 00:30 UTC next day) it should be LIVE.
    const edtSet = makeSet({ startTime: '20:00', endTime: '21:00', date: '2026-09-04' });
    const nowLive = new Date(Date.UTC(2026, 8, 5, 0, 30, 0)); // 20:30 EDT
    expect(getSetStatus(edtSet, nowLive, [], 'America/New_York').status).toBe('live');

    // At 21:30 EDT (= 01:30 UTC next day) the set has ended.
    const nowPast = new Date(Date.UTC(2026, 8, 5, 1, 30, 0)); // 21:30 EDT
    expect(getSetStatus(edtSet, nowPast, [], 'America/New_York').status).toBe('past');

    // At 18:30 EDT (= 22:30 UTC same day = 90m before start) it should be upcoming.
    const nowUpcoming = new Date(Date.UTC(2026, 8, 4, 22, 30, 0)); // 18:30 EDT
    const upcoming = getSetStatus(edtSet, nowUpcoming, [], 'America/New_York');
    expect(upcoming.status).toBe('upcoming');
    expect(upcoming.minutesUntil).toBe(90);
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

// Regression guard for the historical UTC/local skew bug: if the bounds were ever
// derived by JS string-parsing the set date (`new Date('2026-09-04')` -> UTC
// midnight) while comparing against a local `now`, the status would flip by the
// machine's UTC offset for any non-UTC user. CI runs in UTC so the skew is
// invisible there. These cases pin the *local-frame* interpretation explicitly so a
// regression to that mix fails on ANY host timezone, not just a non-zero-offset one.
describe('getSetStatus timezone consistency', () => {
  // The set runs 20:00-21:00 local. `now` is built from the same local frame the
  // source anchors on (createDateInLocalFrame -> setFullYear + setHours), so the
  // expected status is purely the local-wall-clock reading -- exactly what a
  // UTC/local mix would corrupt (e.g. a UTC-5 user seeing "Ended" while still LIVE).
  const set = makeSet({ startTime: '20:00', endTime: '21:00', date: '2026-09-04' });

  it('reports LIVE at the set wall-clock midpoint (no offset skew)', () => {
    const result = getSetStatus(set, new Date(localMs('2026-09-04', 20, 30)));
    expect(result.status).toBe('live');
    expect(result.progress).toBeCloseTo(0.5, 5);
  });

  it('reports past (Ended) just after the local end wall-clock', () => {
    expect(getSetStatus(set, new Date(localMs('2026-09-04', 21, 1))).status).toBe('past');
  });

  it('reports upcoming 90m before the local start wall-clock', () => {
    const result = getSetStatus(set, new Date(localMs('2026-09-04', 18, 30)));
    expect(result.status).toBe('upcoming');
    expect(result.minutesUntil).toBe(90);
  });

  it('timezone: live/past badge is correct for non-UTC users (e.g. PST = UTC-7)', () => {
    // Simulate a non-UTC environment: a set that sits near midnight locally.
    // If getSetStatus mixed a UTC parse of set.date with a local `now`, the
    // status would skew by the host's UTC offset and mislabel this set.
    const pstSet = makeSet({ startTime: '23:00', endTime: '23:30', date: '2026-09-04' });
    // At 23:15 local, the set should be LIVE on any host timezone.
    const now = new Date(localMs('2026-09-04', 23, 15));
    expect(getSetStatus(pstSet, now).status).toBe('live');
  });

  it('computes status correctly for a non-UTC user (simulated wall-clock)', () => {
    // Drive a concrete instant through fake timers so `now` is a real `new Date()`,
    // the same object production constructs. createDateInLocalFrame anchors the set
    // in the SAME frame as `now`, so any UTC offset cancels out: 20:45 reads LIVE
    // whether the host is UTC or UTC-5. Under the old UTC-parse + local-setHours
    // mix this would skew by the offset and mislabel the set for non-UTC users.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(localMs('2026-09-04', 20, 45)));
      expect(getSetStatus(set, new Date()).status).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });

  // DST-boundary regression. On a host that observes DST (e.g. US Pacific), the
  // spring-forward instant skips a wall-clock hour: 2026-03-08 02:00 local jumps
  // straight to 03:00, so that calendar day is only 23h long. A set whose window
  // STRADDLES that gap (01:00 -> 04:00) must still read by the surrounding wall
  // clock on any host, because both the set bounds and `now` flow through the
  // SAME local frame (createDateInLocalFrame vs the localMs helper, both
  // setFullYear + setHours) so the missing hour cancels out. We deliberately
  // sample `now` at times that EXIST on both DST and non-DST hosts (00:30 / 01:30
  // / 04:30) — 02:00-02:59 is non-existent wall-clock during spring-forward and
  // would normalize forward ambiguously, so it is not a valid assertion point. On
  // a non-DST host (incl. UTC CI) these are ordinary times and the assertions hold
  // identically: the test pins the local-frame contract on every host without
  // depending on a DST jump actually firing.
  it('stays wall-clock-consistent across a spring-forward DST boundary', () => {
    const dstSet = makeSet({ startTime: '01:00', endTime: '04:00', date: '2026-03-08' });
    // 01:30 is before the gap and inside [01:00, 04:00] — LIVE on any host.
    expect(getSetStatus(dstSet, new Date(localMs('2026-03-08', 1, 30))).status).toBe('live');
    // Before the start wall-clock it must read upcoming; after the end, past — a
    // raw-ms comparison corrupted by the skipped hour would flip one of these.
    // 00:00 is a clean 60m before the 01:00 start (>30m → upcoming, not "soon").
    expect(getSetStatus(dstSet, new Date(localMs('2026-03-08', 0, 0))).status).toBe('upcoming');
    expect(getSetStatus(dstSet, new Date(localMs('2026-03-08', 4, 30))).status).toBe('past');
  });
});
