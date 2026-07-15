import { describe, it, expect } from 'vitest';
import { colors } from './colors';

/**
 * WCAG contrast guard for the design tokens.
 *
 * These tokens are the single source of truth for both web and mobile, so a
 * contrast regression here ships everywhere. This test recomputes the ratio for
 * every intended text-on-surface and semantic pairing from the token VALUES, so
 * lightening `text.muted` or darkening a surface fails CI before it can regress
 * the deployed UI. Thresholds: 4.5:1 for normal body text, 3.0:1 for large text
 * / icons / UI components (WCAG 2.1 AA).
 *
 * Semi-transparent surfaces are composited over `bg.primary` (the base ground)
 * to get the effective colour a user actually sees.
 */

const BASE = colors.bg.primary;

function toRgb(c: string): [number, number, number] {
  if (c.startsWith('#')) {
    const h = c.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i)!;
  const rgb: [number, number, number] = [+m[1]!, +m[2]!, +m[3]!];
  const a = m[4] === undefined ? 1 : +m[4]!;
  if (a >= 1) return rgb;
  const base = toRgb(BASE);
  return rgb.map((ch, i) => Math.round(ch * a + base[i]! * (1 - a))) as [number, number, number];
}

function luminance(c: string): number {
  const [r, g, b] = toRgb(c).map((ch) => {
    const s = ch / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
}

const NORMAL = 4.5;
const LARGE = 3.0;

// [label, foreground, background, threshold]
const pairs: Array<[string, string, string, number]> = [
  ['text.primary on bg.primary', colors.text.primary, colors.bg.primary, NORMAL],
  ['text.primary on bg.secondary', colors.text.primary, colors.bg.secondary, NORMAL],
  ['text.primary on bg.card', colors.text.primary, colors.bg.card, NORMAL],
  ['text.secondary on bg.primary', colors.text.secondary, colors.bg.primary, NORMAL],
  ['text.secondary on bg.card', colors.text.secondary, colors.bg.card, NORMAL],
  ['text.muted on bg.primary', colors.text.muted, colors.bg.primary, NORMAL],
  ['text.muted on bg.card', colors.text.muted, colors.bg.card, NORMAL],
  ['text.disabled on bg.primary', colors.text.disabled, colors.bg.primary, NORMAL],
  ['text.placeholder on bg.input', colors.text.placeholder, colors.bg.input, NORMAL],
  ['text.danger on bg.primary', colors.text.danger, colors.bg.primary, NORMAL],
  ['text.danger on bg.card', colors.text.danger, colors.bg.card, NORMAL],
  ['ink (onLightAccent) on aqua fill', colors.text.onLightAccent, colors.accent.aqua, NORMAL],
  ['white (onAccent) on coralStrong fill', colors.text.onAccent, colors.accent.coralStrong, NORMAL],
  // Semantic colours used as icons / large text / UI accents (3:1):
  ['aqua accent on bg.primary', colors.accent.aqua, colors.bg.primary, LARGE],
  ['coral accent on bg.primary', colors.accent.coral, colors.bg.primary, LARGE],
  ['amber accent on bg.primary', colors.accent.amber, colors.bg.primary, LARGE],
  ['green accent on bg.primary', colors.accent.green, colors.bg.primary, LARGE],
  ['status.verified on bg.primary', colors.status.verified, colors.bg.primary, LARGE],
  ['status.unverified on bg.primary', colors.status.unverified, colors.bg.primary, LARGE],
  ['status.warning on bg.primary', colors.status.warning, colors.bg.primary, LARGE],
  ['status.error on bg.primary', colors.status.error, colors.bg.primary, LARGE],
  ['priority.must on bg.card', colors.priority.must, colors.bg.card, LARGE],
  ['priority.want on bg.card', colors.priority.want, colors.bg.card, LARGE],
  ['priority.maybe on bg.card', colors.priority.maybe, colors.bg.card, LARGE],
  ['stage.purpleAccessible on bg.primary', colors.stage.purpleAccessible, colors.bg.primary, LARGE],
  ['stage.fallback on bg.primary', colors.stage.fallback, colors.bg.primary, LARGE],
];

describe('design token contrast (WCAG AA)', () => {
  for (const [label, fg, bg, threshold] of pairs) {
    it(`${label} clears ${threshold}:1`, () => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(threshold);
    });
  }

  // Locks the rationale for coralStrong: filled coral danger buttons must use the
  // deepened coralStrong (passes AA on white), never plain coral (fails). This is
  // also enforced at author-time by the web eslint no-restricted-syntax rule.
  it('coralStrong is the AA-safe danger fill; plain coral fill fails (why coralStrong exists)', () => {
    expect(contrast(colors.text.onAccent, colors.accent.coralStrong)).toBeGreaterThanOrEqual(NORMAL);
    expect(contrast('#ffffff', colors.accent.coral)).toBeLessThan(NORMAL);
  });
});
