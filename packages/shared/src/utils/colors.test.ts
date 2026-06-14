import { describe, it, expect } from 'vitest';
import { getIdentityHash, getAvatarColor, getInitials, normalizeIdentityName } from './colors';

describe('getIdentityHash', () => {
  it('returns a non-negative number', () => {
    expect(getIdentityHash('Alice')).toBeGreaterThanOrEqual(0);
  });

  it('returns the same hash for the same input', () => {
    expect(getIdentityHash('Bob')).toBe(getIdentityHash('Bob'));
  });

  it('returns different hashes for different inputs', () => {
    expect(getIdentityHash('Alice')).not.toBe(getIdentityHash('Bob'));
  });

  it('returns 0 for empty string', () => {
    expect(getIdentityHash('')).toBe(0);
  });
});

describe('getAvatarColor', () => {
  it('returns an HSL color string', () => {
    const color = getAvatarColor('Alice');
    expect(color).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
  });

  it('returns the same color for the same name', () => {
    expect(getAvatarColor('Bob')).toBe(getAvatarColor('Bob'));
  });

  it('returns different colors for different names', () => {
    expect(getAvatarColor('Alice')).not.toBe(getAvatarColor('Charlie'));
  });

  it('caches results (second call returns same ref)', () => {
    const first = getAvatarColor('CacheTest');
    const second = getAvatarColor('CacheTest');
    expect(first).toBe(second);
  });

  it('keeps saturation in valid range (62-73)', () => {
    const color = getAvatarColor('TestSaturation');
    const match = color.match(/hsl\(\d+ (\d+)% \d+%\)/);
    const sat = parseInt(match![1]!, 10);
    expect(sat).toBeGreaterThanOrEqual(62);
    expect(sat).toBeLessThanOrEqual(73);
  });

  it('keeps lightness in valid range (46-55)', () => {
    const color = getAvatarColor('TestLightness');
    const match = color.match(/hsl\(\d+ \d+% (\d+)%\)/);
    const light = parseInt(match![1]!, 10);
    expect(light).toBeGreaterThanOrEqual(46);
    expect(light).toBeLessThanOrEqual(55);
  });

  it('never lands in the brand-accent hue bands (aqua ~160-205, coral ~335-20)', () => {
    // Exhaustive sweep over many names; no generated hue may collide with the
    // aqua primary or coral danger accent, so avatars never compete with them.
    for (let i = 0; i < 2000; i++) {
      const color = getAvatarColor(`sweep-${i}-user`);
      const hue = parseInt(color.match(/hsl\((\d+) /)![1]!, 10);
      expect(hue).toBeGreaterThanOrEqual(21);
      expect(hue).toBeLessThanOrEqual(334);
      expect(hue < 160 || hue > 205, `hue ${hue} fell in the aqua band`).toBe(true);
    }
  });
});

describe('getInitials', () => {
  it('returns two-letter initials from two words', () => {
    expect(getInitials('Alice Brown')).toBe('AB');
  });

  it('returns single letter for single word', () => {
    expect(getInitials('Alice')).toBe('A');
  });

  it('truncates to 2 characters for three words', () => {
    expect(getInitials('Alice B Charlie')).toBe('AB');
  });

  it('returns uppercase initials', () => {
    expect(getInitials('alice brown')).toBe('AB');
  });

  it('handles empty string', () => {
    expect(getInitials('')).toBe('');
  });

  it('caches results', () => {
    const first = getInitials('CacheInit');
    const second = getInitials('CacheInit');
    expect(first).toBe(second);
  });
});

describe('normalizeIdentityName', () => {
  it('returns the trimmed name', () => {
    expect(normalizeIdentityName('  Alice  ')).toBe('Alice');
  });

  it('returns User for undefined', () => {
    expect(normalizeIdentityName(undefined)).toBe('User');
  });

  it('returns User for empty string', () => {
    expect(normalizeIdentityName('')).toBe('User');
  });

  it('returns User for whitespace-only', () => {
    expect(normalizeIdentityName('   ')).toBe('User');
  });

  it('returns the name as-is when valid', () => {
    expect(normalizeIdentityName('Bob')).toBe('Bob');
  });
});
