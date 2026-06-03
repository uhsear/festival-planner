import { describe, it, expect, vi, afterEach } from 'vitest';
import { timeAgo } from './timeAgo';

const NOW = new Date('2026-06-03T12:00:00Z').getTime();

afterEach(() => {
  vi.useRealTimers();
});

function at(msAgo: number): number {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  return NOW - msAgo;
}

describe('timeAgo', () => {
  it('returns "just now" under 45 seconds', () => {
    expect(timeAgo(at(0))).toBe('just now');
    expect(timeAgo(at(44_000))).toBe('just now');
  });

  it('returns minutes between 45s and 60m', () => {
    expect(timeAgo(at(60_000))).toBe('1m ago');
    expect(timeAgo(at(59 * 60_000))).toBe('59m ago');
  });

  it('returns hours between 60m and 24h', () => {
    expect(timeAgo(at(60 * 60_000))).toBe('1h ago');
    expect(timeAgo(at(23 * 60 * 60_000))).toBe('23h ago');
  });

  it('returns days at/after 24h', () => {
    expect(timeAgo(at(24 * 60 * 60_000))).toBe('1d ago');
    expect(timeAgo(at(3 * 24 * 60 * 60_000))).toBe('3d ago');
  });

  it('collapses negative / non-finite deltas to "just now"', () => {
    expect(timeAgo(at(-5_000))).toBe('just now'); // future timestamp (clock skew)
    expect(timeAgo(NaN)).toBe('just now');
    expect(timeAgo(Infinity)).toBe('just now');
  });
});
