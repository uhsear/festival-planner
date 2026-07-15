import { describe, it, expect } from 'vitest';
import { getAvatarColor } from '@festie/shared';
import { avatarInk } from './avatarInk';

// Independent WCAG relative-luminance calc so the invariant test validates the
// outcome rather than restating avatarInk's own math.
function srgb(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function lumRgb(r: number, g: number, b: number): number {
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function hslLum(hsl: string): number {
  const m = hsl.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/i)!;
  const h = parseFloat(m[1]!);
  const s = parseFloat(m[2]!) / 100;
  const l = parseFloat(m[3]!) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return lumRgb(Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255));
}
function whiteContrast(hsl: string): number {
  return 1.05 / (hslLum(hsl) + 0.05);
}

describe('avatarInk', () => {
  it('clears WCAG AA (4.5:1) for white text on every generated avatar colour', () => {
    const failures: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const { background, color } = avatarInk(getAvatarColor(`Person ${i} ${String.fromCharCode(65 + (i % 26))}`));
      expect(color).toBe('#ffffff');
      const ratio = whiteContrast(background);
      if (ratio < 4.5) failures.push(`${background} = ${ratio.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it('leaves an already-dark background unchanged', () => {
    expect(avatarInk('hsl(210 65% 22%)')).toEqual({ background: 'hsl(210 65% 22%)', color: '#ffffff' });
  });

  it('darkens a bright background until white clears', () => {
    const { background } = avatarInk('hsl(55 70% 55%)');
    const l = parseInt(background.match(/(\d+)%\)$/)![1]!, 10);
    expect(l).toBeLessThan(55);
    expect(whiteContrast(background)).toBeGreaterThanOrEqual(4.5);
  });

  it('passes a non-hsl colour through with white text', () => {
    expect(avatarInk('#cccccc')).toEqual({ background: '#cccccc', color: '#ffffff' });
  });
});
