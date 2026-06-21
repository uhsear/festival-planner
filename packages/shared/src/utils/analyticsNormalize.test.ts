import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeAnalytics,
  ANALYTICS_DEFAULTS,
  formatDate,
  timeAgoFromIso,
} from './analyticsNormalize';

// ---------------------------------------------------------------------------
// normalizeAnalytics
// ---------------------------------------------------------------------------

describe('normalizeAnalytics', () => {
  it('returns empty defaults for null input', () => {
    expect(normalizeAnalytics(null)).toEqual(ANALYTICS_DEFAULTS);
  });

  it('returns empty defaults for undefined input', () => {
    expect(normalizeAnalytics(undefined)).toEqual(ANALYTICS_DEFAULTS);
  });

  it('returns empty defaults for empty object', () => {
    expect(normalizeAnalytics({})).toEqual(ANALYTICS_DEFAULTS);
  });

  it('passes generatedAt through when it is a string', () => {
    const result = normalizeAnalytics({ generatedAt: '2026-06-01T12:00:00Z' });
    expect(result.generatedAt).toBe('2026-06-01T12:00:00Z');
  });

  it('sets generatedAt to null when missing', () => {
    expect(normalizeAnalytics({}).generatedAt).toBeNull();
  });

  it('sets generatedAt to null when non-string', () => {
    expect(normalizeAnalytics({ generatedAt: 42 }).generatedAt).toBeNull();
  });

  describe('topSets coercion', () => {
    it('normalizes a fully-populated set row', () => {
      const raw = {
        topSets: [
          {
            artist: 'Bonobo',
            stageId: 'stage-1',
            dayIndex: 2,
            festivalId: 'fest-1',
            startTime: '20:00',
            endTime: '22:00',
            pickCount: '15',
            mustCount: '7',
            wantCount: '5',
            maybeCount: '3',
          },
        ],
      };
      const [set] = normalizeAnalytics(raw).topSets;
      expect(set).toEqual({
        artist: 'Bonobo',
        stageId: 'stage-1',
        dayIndex: 2,
        festivalId: 'fest-1',
        startTime: '20:00',
        endTime: '22:00',
        pickCount: 15,
        mustCount: 7,
        wantCount: 5,
        maybeCount: 3,
      });
    });

    it('coerces numeric-string counts to numbers', () => {
      const raw = { topSets: [{ artist: 'X', festivalId: 'f', pickCount: '99', mustCount: '0', wantCount: '0', maybeCount: '0' }] };
      expect(normalizeAnalytics(raw).topSets[0]!.pickCount).toBe(99);
    });

    it('defaults null-ish numeric fields to 0', () => {
      const raw = { topSets: [{ artist: 'X', festivalId: 'f' }] };
      const [set] = normalizeAnalytics(raw).topSets;
      expect(set!.pickCount).toBe(0);
      expect(set!.mustCount).toBe(0);
      expect(set!.wantCount).toBe(0);
      expect(set!.maybeCount).toBe(0);
    });

    it('sets stageId/startTime/endTime to null when absent', () => {
      const raw = { topSets: [{ artist: 'X', festivalId: 'f' }] };
      const [set] = normalizeAnalytics(raw).topSets;
      expect(set!.stageId).toBeNull();
      expect(set!.startTime).toBeNull();
      expect(set!.endTime).toBeNull();
      expect(set!.dayIndex).toBeNull();
    });

    it('treats non-array topSets as empty', () => {
      expect(normalizeAnalytics({ topSets: 'bad' }).topSets).toEqual([]);
    });

    it('returns empty array for missing topSets', () => {
      expect(normalizeAnalytics({}).topSets).toEqual([]);
    });

    it('collapses non-finite numeric-string to 0', () => {
      const raw = { topSets: [{ artist: 'X', festivalId: 'f', pickCount: 'NaN' }] };
      expect(normalizeAnalytics(raw).topSets[0]!.pickCount).toBe(0);
    });
  });

  describe('activeUsers coercion', () => {
    it('normalizes a user row with string numeric fields', () => {
      const raw = {
        activeUsers: [
          { id: 'u1', username: 'alice', profileCount: '3', totalPicks: '42', lastActive: '2026-06-01T10:00:00Z' },
        ],
      };
      expect(normalizeAnalytics(raw).activeUsers[0]).toEqual({
        id: 'u1',
        username: 'alice',
        profileCount: 3,
        totalPicks: 42,
        lastActive: '2026-06-01T10:00:00Z',
      });
    });

    it('defaults missing fields to empty string / 0', () => {
      const raw = { activeUsers: [{}] };
      const [u] = normalizeAnalytics(raw).activeUsers;
      expect(u!.id).toBe('');
      expect(u!.username).toBe('');
      expect(u!.profileCount).toBe(0);
      expect(u!.totalPicks).toBe(0);
      expect(u!.lastActive).toBe('');
    });

    it('treats non-array activeUsers as empty', () => {
      expect(normalizeAnalytics({ activeUsers: null }).activeUsers).toEqual([]);
    });
  });

  describe('crews coercion', () => {
    it('normalizes a crew row with string memberCount', () => {
      const raw = {
        crews: [{ id: 'c1', name: 'Goons', festivalId: 'f', memberCount: '8', createdAt: '2026-01-01' }],
      };
      expect(normalizeAnalytics(raw).crews[0]).toEqual({
        id: 'c1',
        name: 'Goons',
        festivalId: 'f',
        memberCount: 8,
        createdAt: '2026-01-01',
      });
    });

    it('treats non-array crews as empty', () => {
      expect(normalizeAnalytics({ crews: 42 }).crews).toEqual([]);
    });
  });

  describe('festivalStats coercion', () => {
    it('normalizes stat fields', () => {
      const raw = {
        festivalStats: [
          { id: 'f1', name: 'Fest', profileCount: '100', uniqueSetsPicked: '50', totalPicks: '300' },
        ],
      };
      expect(normalizeAnalytics(raw).festivalStats[0]).toEqual({
        id: 'f1',
        name: 'Fest',
        profileCount: 100,
        uniqueSetsPicked: 50,
        totalPicks: 300,
      });
    });

    it('treats non-array festivalStats as empty', () => {
      expect(normalizeAnalytics({ festivalStats: false }).festivalStats).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// ANALYTICS_DEFAULTS
// ---------------------------------------------------------------------------

describe('ANALYTICS_DEFAULTS', () => {
  it('has all empty arrays and null generatedAt', () => {
    expect(ANALYTICS_DEFAULTS).toEqual({
      topSets: [],
      activeUsers: [],
      crews: [],
      festivalStats: [],
      generatedAt: null,
    });
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('returns "—" for empty string', () => {
    expect(formatDate('')).toBe('—');
  });

  it('formats an ISO datetime to YYYY-MM-DD', () => {
    expect(formatDate('2026-06-01T12:00:00Z')).toBe('2026-06-01');
  });

  it('passes through a bare YYYY-MM-DD unchanged', () => {
    expect(formatDate('2026-06-01')).toBe('2026-06-01');
  });

  it('returns the original string for an unparseable value', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

// ---------------------------------------------------------------------------
// timeAgoFromIso
// ---------------------------------------------------------------------------

const NOW_ISO = '2026-06-21T15:00:00Z';
const NOW_MS = new Date(NOW_ISO).getTime();

afterEach(() => {
  vi.useRealTimers();
});

function freeze(msAgo: number): string {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  return new Date(NOW_MS - msAgo).toISOString();
}

describe('timeAgoFromIso', () => {
  it('returns "—" for empty string', () => {
    expect(timeAgoFromIso('')).toBe('—');
  });

  it('returns the raw string for an unparseable ISO value', () => {
    expect(timeAgoFromIso('not-a-date')).toBe('not-a-date');
  });

  it('returns "just now" for a timestamp under 60 seconds ago', () => {
    expect(timeAgoFromIso(freeze(30_000))).toBe('just now');
    expect(timeAgoFromIso(freeze(59_000))).toBe('just now');
  });

  it('returns minutes for 1m–59m ago', () => {
    expect(timeAgoFromIso(freeze(60_000))).toBe('1m ago');
    expect(timeAgoFromIso(freeze(59 * 60_000))).toBe('59m ago');
  });

  it('returns hours for 1h–23h ago', () => {
    expect(timeAgoFromIso(freeze(60 * 60_000))).toBe('1h ago');
    expect(timeAgoFromIso(freeze(23 * 60 * 60_000))).toBe('23h ago');
  });

  it('returns days at/after 24h', () => {
    expect(timeAgoFromIso(freeze(24 * 60 * 60_000))).toBe('1d ago');
    expect(timeAgoFromIso(freeze(3 * 24 * 60 * 60_000))).toBe('3d ago');
  });
});
