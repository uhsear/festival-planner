import { describe, it, expect, vi, afterEach } from 'vitest';
import { timeAgo, formatUptime } from './timeAgo';

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
  it('returns "just now" under 60 seconds (incl. the 45-59s window that used to render "0m ago")', () => {
    expect(timeAgo(at(0))).toBe('just now');
    expect(timeAgo(at(44_000))).toBe('just now');
    expect(timeAgo(at(50_000))).toBe('just now');
    expect(timeAgo(at(59_000))).toBe('just now');
  });

  it('returns minutes between 60s and 60m', () => {
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

describe('formatUptime', () => {
  it('renders minutes-only when under 1 hour', () => {
    expect(formatUptime(0)).toBe('0m');
    expect(formatUptime(59)).toBe('0m');
    expect(formatUptime(60)).toBe('1m');
    expect(formatUptime(59 * 60 + 59)).toBe('59m');
  });

  it('renders hours + minutes when under 1 day', () => {
    expect(formatUptime(3600)).toBe('1h 0m');
    expect(formatUptime(3600 + 30 * 60)).toBe('1h 30m');
    expect(formatUptime(23 * 3600 + 59 * 60)).toBe('23h 59m');
  });

  it('renders days + hours + minutes when 1 day or more', () => {
    expect(formatUptime(86400)).toBe('1d 0h 0m');
    expect(formatUptime(86400 + 2 * 3600 + 15 * 60)).toBe('1d 2h 15m');
    expect(formatUptime(7 * 86400 + 3600)).toBe('7d 1h 0m');
  });
});
