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

/** Composite an rgba() token over an opaque token -> the #rrggbb a user sees. */
function over(fg: string, bg: string): string {
  const m = /rgba\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s/]+([\d.]+)\s*\)/i.exec(fg)!;
  const base = toRgb(bg);
  const a = +m[4]!;
  return (
    '#' +
    [1, 2, 3]
      .map((i) =>
        Math.round(+m[i]! * a + base[i - 1]! * (1 - a))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
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
  // Confidence + delivery. These colour a NUMERAL (the `numeral` type role,
  // 14px / weight 500), which is NORMAL text by WCAG — large text starts at
  // 24px, or 18.66px bold — so every pair below is held to 4.5:1, not 3.0:1.
  // The three surfaces are the ones a confidence figure actually sits on: the
  // screen ground, a card row, and an elevated sheet (the darkest-composited
  // and therefore tightest of the three).
  ['confidence.live on bg.primary', colors.confidence.live, colors.bg.primary, NORMAL],
  ['confidence.live on bg.card', colors.confidence.live, colors.bg.card, NORMAL],
  ['confidence.live on bg.elevated', colors.confidence.live, colors.bg.elevated, NORMAL],
  ['confidence.aging on bg.primary', colors.confidence.aging, colors.bg.primary, NORMAL],
  ['confidence.aging on bg.card', colors.confidence.aging, colors.bg.card, NORMAL],
  ['confidence.aging on bg.elevated', colors.confidence.aging, colors.bg.elevated, NORMAL],
  ['confidence.stale on bg.primary', colors.confidence.stale, colors.bg.primary, NORMAL],
  ['confidence.stale on bg.card', colors.confidence.stale, colors.bg.card, NORMAL],
  ['confidence.stale on bg.elevated', colors.confidence.stale, colors.bg.elevated, NORMAL],
  ['confidence.dark on bg.primary', colors.confidence.dark, colors.bg.primary, NORMAL],
  ['confidence.dark on bg.card', colors.confidence.dark, colors.bg.card, NORMAL],
  ['confidence.dark on bg.elevated', colors.confidence.dark, colors.bg.elevated, NORMAL],
  ['delivery.local on bg.primary', colors.delivery.local, colors.bg.primary, NORMAL],
  ['delivery.local on bg.card', colors.delivery.local, colors.bg.card, NORMAL],
  ['delivery.local on bg.elevated', colors.delivery.local, colors.bg.elevated, NORMAL],
  ['delivery.sent on bg.primary', colors.delivery.sent, colors.bg.primary, NORMAL],
  ['delivery.sent on bg.card', colors.delivery.sent, colors.bg.card, NORMAL],
  ['delivery.sent on bg.elevated', colors.delivery.sent, colors.bg.elevated, NORMAL],
  ['delivery.failed on bg.primary', colors.delivery.failed, colors.bg.primary, NORMAL],
  ['delivery.failed on bg.card', colors.delivery.failed, colors.bg.card, NORMAL],
  ['delivery.failed on bg.elevated', colors.delivery.failed, colors.bg.elevated, NORMAL],
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

  // The confidence/delivery groups are ALIASES of hues that already exist and
  // are already contrast-tested above. That is the entire reason no new
  // contrast risk was introduced, so pin the aliasing itself: if someone
  // "adjusts" one of these to a bespoke hue, this fails before the ratio does.
  it('confidence + delivery are aliases of existing hues, not new colours', () => {
    expect(colors.confidence.live).toBe(colors.accent.green);
    expect(colors.confidence.aging).toBe(colors.accent.amber);
    expect(colors.confidence.stale).toBe(colors.text.muted);
    expect(colors.confidence.dark).toBe(colors.text.disabled);
    expect(colors.delivery.local).toBe(colors.text.muted);
    expect(colors.delivery.sent).toBe(colors.status.verified);
    expect(colors.delivery.failed).toBe(colors.accent.amber);
  });

  // Two screen-level pairs that had regressed to unreadable: the armed banner in
  // mobile app/admin/festival-map.tsx and the priority badge in
  // mobile app/crew-plan.tsx. Both are asserted in BOTH directions so the wrong
  // ink cannot come back as a "consistency" tidy-up.
  it('filled aqua takes dark ink, never white ink', () => {
    expect(contrast(colors.text.onLightAccent, colors.accent.aqua)).toBeGreaterThanOrEqual(NORMAL);
    expect(contrast(colors.text.onAccent, colors.accent.aqua)).toBeLessThan(LARGE);
  });

  // A 12% amber wash is NOT a solid amber fill. Over bg.secondary it composites
  // to a near-black, so it takes amber TEXT, not the dark ink solid amber wants.
  it('the amberAlpha[12] wash takes amber text, never dark ink', () => {
    const wash = over(colors.amberAlpha[12], colors.bg.secondary);
    expect(contrast(colors.accent.amber, wash)).toBeGreaterThanOrEqual(NORMAL);
    expect(contrast(colors.text.onLightAccent, wash)).toBeLessThan(LARGE);
  });
});
