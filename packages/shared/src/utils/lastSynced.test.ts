import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatLastSynced, offlineReadyLabel } from './lastSynced';

afterEach(() => {
  vi.useRealTimers();
});

describe('formatLastSynced', () => {
  it('returns null for null/undefined (no timestamp, no claim)', () => {
    expect(formatLastSynced(null)).toBe(null);
    expect(formatLastSynced(undefined)).toBe(null);
  });

  it('returns null for a non-finite timestamp', () => {
    expect(formatLastSynced(NaN)).toBe(null);
    expect(formatLastSynced(Infinity)).toBe(null);
  });

  it('renders "Updated just now" for a fresh timestamp', () => {
    expect(formatLastSynced(Date.now())).toBe('Updated just now');
  });

  it('renders "Updated Nm ago" for a stale timestamp', () => {
    vi.useFakeTimers();
    const now = new Date('2026-06-14T12:00:00Z').getTime();
    vi.setSystemTime(now);
    expect(formatLastSynced(now - 4 * 60_000)).toBe('Updated 4m ago');
  });

  it('renders "Updated Nh ago" past an hour', () => {
    vi.useFakeTimers();
    const now = new Date('2026-06-14T12:00:00Z').getTime();
    vi.setSystemTime(now);
    expect(formatLastSynced(now - 3 * 3_600_000)).toBe('Updated 3h ago');
  });

  it('collapses a future timestamp to "Updated just now" (clock skew safety)', () => {
    expect(formatLastSynced(Date.now() + 60_000)).toBe('Updated just now');
  });
});

describe('offlineReadyLabel', () => {
  it('returns null when never cached', () => {
    expect(offlineReadyLabel(null)).toBe(null);
    expect(offlineReadyLabel(undefined)).toBe(null);
    expect(offlineReadyLabel(NaN)).toBe(null);
  });

  it('returns "offline-ready" once cached', () => {
    expect(offlineReadyLabel(Date.now())).toBe('offline-ready');
    expect(offlineReadyLabel(0)).toBe('offline-ready');
  });
});
