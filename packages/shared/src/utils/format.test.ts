import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatTime,
  timeToMinutes,
  minutesToTime,
  artistDisplayName,
  artistSubtitle,
  getSetLinks,
  getSetHotness,
} from './format';
import type { FestivalSet } from '../types/domain';

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

describe('formatTime', () => {
  it('returns empty string for undefined', () => {
    expect(formatTime(undefined)).toBe('');
  });

  it('converts 24h morning time to 12h AM', () => {
    expect(formatTime('09:30')).toBe('9:30 AM');
  });

  it('converts noon to 12 PM', () => {
    expect(formatTime('12:00')).toBe('12:00 PM');
  });

  it('converts afternoon time to 12h PM', () => {
    expect(formatTime('14:30')).toBe('2:30 PM');
  });

  it('converts midnight to 12 AM', () => {
    expect(formatTime('00:00')).toBe('12:00 AM');
  });

  it('converts 23:59 to 11:59 PM', () => {
    expect(formatTime('23:59')).toBe('11:59 PM');
  });
});

describe('timeToMinutes', () => {
  it('returns 0 for undefined', () => {
    expect(timeToMinutes(undefined)).toBe(0);
  });

  it('converts midnight to 0', () => {
    expect(timeToMinutes('00:00')).toBe(0);
  });

  it('converts 14:30 to 870', () => {
    expect(timeToMinutes('14:30')).toBe(870);
  });

  it('converts 23:59 to 1439', () => {
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('converts 01:00 to 60', () => {
    expect(timeToMinutes('01:00')).toBe(60);
  });
});

describe('minutesToTime', () => {
  it('converts 0 to 00:00', () => {
    expect(minutesToTime(0)).toBe('00:00');
  });

  it('converts 870 to 14:30', () => {
    expect(minutesToTime(870)).toBe('14:30');
  });

  it('converts 60 to 01:00', () => {
    expect(minutesToTime(60)).toBe('01:00');
  });

  it('converts 1439 to 23:59', () => {
    expect(minutesToTime(1439)).toBe('23:59');
  });
});

describe('artistDisplayName', () => {
  it('returns artist field when no artists array', () => {
    const set = makeSet({ artist: 'Daft Punk' });
    expect(artistDisplayName(set)).toBe('Daft Punk');
  });

  it('returns Unknown when no artist and no artists', () => {
    const set = makeSet({});
    expect(artistDisplayName(set)).toBe('Unknown');
  });

  it('returns joined artists when artist matches joined', () => {
    const set = makeSet({
      artist: 'A b2b B',
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(artistDisplayName(set)).toBe('A b2b B');
  });

  it('returns artist field when it differs from joined artists', () => {
    const set = makeSet({
      artist: 'Custom Name',
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(artistDisplayName(set)).toBe('Custom Name');
  });

  it('uses custom separator', () => {
    const set = makeSet({
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(artistDisplayName(set, 'vs')).toBe('A vs B');
  });

  it('returns joined artists when artist field is empty', () => {
    const set = makeSet({
      artist: '',
      artists: [{ name: 'Solo' }],
    });
    expect(artistDisplayName(set)).toBe('Solo');
  });
});

describe('artistSubtitle', () => {
  it('returns empty string for single artist', () => {
    const set = makeSet({ artists: [{ name: 'Solo' }] });
    expect(artistSubtitle(set)).toBe('');
  });

  it('returns empty string when no artists', () => {
    const set = makeSet({});
    expect(artistSubtitle(set)).toBe('');
  });

  it('returns joined artists when artist field differs', () => {
    const set = makeSet({
      artist: 'Custom',
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(artistSubtitle(set)).toBe('A b2b B');
  });

  it('returns empty string when artist matches joined', () => {
    const set = makeSet({
      artist: 'A b2b B',
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(artistSubtitle(set)).toBe('');
  });

  it('uses custom separator', () => {
    const set = makeSet({
      artist: 'Custom',
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(artistSubtitle(set, 'vs')).toBe('A vs B');
  });
});

describe('getSetLinks', () => {
  it('returns empty array when no artists and no linkUrl', () => {
    const set = makeSet({});
    expect(getSetLinks(set)).toEqual([]);
  });

  it('returns linkUrl as spotify link when no artists but linkUrl present', () => {
    const set = makeSet({
      artist: 'Solo',
      linkUrl: 'https://spotify.com/track/123',
    });
    expect(getSetLinks(set)).toEqual([
      { name: 'Solo', links: { spotify: 'https://spotify.com/track/123' } },
    ]);
  });

  it('returns artists with links, filtering out those without', () => {
    const set = makeSet({
      artists: [
        { name: 'A', links: { spotify: 'https://sp/a' } },
        { name: 'B' },
        { name: 'C', links: { soundcloud: 'https://sc/c' } },
      ],
    });
    const result = getSetLinks(set);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'A', links: { spotify: 'https://sp/a' } });
    expect(result[1]).toEqual({ name: 'C', links: { soundcloud: 'https://sc/c' } });
  });

  it('returns empty array for artists with empty link objects', () => {
    const set = makeSet({
      artists: [{ name: 'A', links: {} }],
    });
    expect(getSetLinks(set)).toEqual([]);
  });
});

describe('getSetHotness', () => {
  it('returns 0 when no date', () => {
    const set = makeSet({ date: undefined });
    expect(getSetHotness(set)).toBe(0);
  });

  it('returns 0 when no startTime', () => {
    const set = makeSet({ date: '2026-01-01', startTime: undefined as unknown as string });
    expect(getSetHotness(set)).toBe(0);
  });

  it('returns 1000 for a currently-playing set', () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    // Set that started 30 minutes ago and ends 30 minutes from now
    const startH = now.getHours();
    const startM = now.getMinutes() > 30 ? now.getMinutes() - 30 : 0;
    const endH = now.getHours() + 1;
    const set = makeSet({
      date,
      startTime: `${pad(startH)}:${pad(startM)}`,
      endTime: `${pad(endH)}:00`,
    });
    expect(getSetHotness(set)).toBe(1000);
  });

  it('returns 0 for a set far in the future', () => {
    const set = makeSet({
      date: '2099-12-31',
      startTime: '23:00',
      endTime: '23:59',
    });
    expect(getSetHotness(set)).toBe(0);
  });
});
