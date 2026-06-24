/**
 * generateThemeCss — single-source codegen for the web Tailwind v4 `@theme` block.
 *
 * The TS tokens in this directory (colors/spacing/typography/motion/radii/
 * z-index/breakpoints) are the SINGLE source of truth. This pure function emits
 * the `@theme { ... }` CSS that packages/web's theme.css used to hand-maintain,
 * so the two can no longer drift. The Node wrapper in
 * `packages/shared/scripts/gen-theme-css.mjs` writes the result to the committed
 * `packages/web/src/styles/theme.generated.css`, which theme.css `@import`s.
 *
 * SCOPE: this emits ONLY the tokens that have a TS source. CSS-only tokens
 * (the 11px/13px off-ramp font sizes, focus rings, glass blur, accent hover
 * tones, timeline NOW tokens, bg-chrome/bg-disabled, the var()-referencing and
 * rgb-channel one-offs) remain hand-authored in theme.css — they are not
 * design tokens shared with React Native.
 *
 * CRITICAL: the emitted values must EQUAL the current theme.css literals — this
 * is single-sourcing, not a restyle. The companion test
 * (generateThemeCss.test.ts) pins that contract.
 *
 * Pure: zero runtime/DOM/Node dependencies, so it is unit-testable and safe to
 * import from either platform's tooling.
 */

import { colors } from './colors.js';
import { breakpoints } from './breakpoints.js';
import { fontFamily, fontSize, lineHeight, letterSpacing } from './typography.js';
import { spacing, measureProse } from './spacing.js';
import { radii } from './radii.js';
import { zIndex } from './z-index.js';
import { easing, duration } from './motion.js';

/** px → rem string (16px base), trimming trailing zeros (16 → "1rem"). */
function rem(px: number): string {
  const v = px / 16;
  // Number() drops trailing zeros: 0.875 stays, 1.0 → 1, 1.25 stays.
  return `${Number(v.toFixed(6))}rem`;
}

/** em number → em string. */
function em(n: number): string {
  return `${n}em`;
}

type Decl = readonly [name: string, value: string];

/**
 * The ordered list of `--var: value` declarations the generated `@theme` block
 * contains, each derived from a TS token. Order is grouped for readability and
 * is not load-bearing (CSS custom properties are order-independent here).
 */
export function themeDeclarations(): Decl[] {
  const d: Decl[] = [];

  // ── Breakpoints (rem) ────────────────────────────────────────────────────
  d.push(['--breakpoint-sm', rem(breakpoints.sm)]);
  d.push(['--breakpoint-md', rem(breakpoints.md)]);
  d.push(['--breakpoint-lg', rem(breakpoints.lg)]);
  d.push(['--breakpoint-xl', rem(breakpoints.xl)]);
  d.push(['--breakpoint-2xl', rem(breakpoints['2xl'])]);

  // ── Core colors ──────────────────────────────────────────────────────────
  d.push(['--color-bg-primary', colors.bg.primary]);
  d.push(['--color-bg-secondary', colors.bg.secondary]);
  d.push(['--color-bg-card', colors.bg.card]);
  d.push(['--color-bg-card-hover', colors.bg.cardHover]);
  d.push(['--color-bg-input', colors.bg.input]);
  d.push(['--color-text-primary', colors.text.primary]);
  d.push(['--color-text-secondary', colors.text.secondary]);
  d.push(['--color-text-muted', colors.text.muted]);
  d.push(['--color-accent-coral', colors.accent.coral]);
  d.push(['--color-accent-coral-strong', colors.accent.coralStrong]);
  d.push(['--color-accent-aqua', colors.accent.aqua]);
  d.push(['--color-accent-amber', colors.accent.amber]);
  d.push(['--color-accent-green', colors.accent.green]);
  d.push(['--color-border', colors.border.default]);
  d.push(['--color-border-light', colors.border.light]);
  d.push(['--color-priority-must', colors.priority.must]);
  d.push(['--color-priority-want', colors.priority.want]);
  d.push(['--color-priority-maybe', colors.priority.maybe]);

  // ── Font families ──────────────────────────────────────────────────────────
  d.push(['--font-family-body', fontFamily.body]);
  // Web renders Clash Display (displayWeb); mobile renders Syncopate (display).
  d.push(['--font-family-display', fontFamily.displayWeb]);

  d.push(['--color-glass', colors.glass.bg]);
  d.push(['--color-glass-border', colors.glass.border]);

  // ── Stage palette ──────────────────────────────────────────────────────────
  d.push(['--stage-purple-accessible', colors.stage.purpleAccessible]);

  // ── Motion (easing curves + durations) ────────────────────────────────────
  d.push(['--ease-out', easing.out.css]);
  d.push(['--ease-in', easing.in.css]);
  d.push(['--ease-standard', easing.standard.css]);
  d.push(['--ease-out-quart', easing.outQuart.css]);
  d.push(['--ease-in-quart', easing.inQuart.css]);
  d.push(['--duration-fast', `${duration.fast}ms`]);
  d.push(['--duration-med', `${duration.med}ms`]);
  d.push(['--duration-slow', `${duration.slow}ms`]);

  // ── Typography scale ───────────────────────────────────────────────────────
  // 11/13 are CSS-only off-ramp steps and stay hand-authored in theme.css.
  d.push(['--font-size-10', rem(fontSize[10])]);
  d.push(['--font-size-12', rem(fontSize[12])]);
  d.push(['--font-size-14', rem(fontSize[14])]);
  d.push(['--font-size-16', rem(fontSize[16])]);
  d.push(['--font-size-18', rem(fontSize[18])]);
  d.push(['--font-size-20', rem(fontSize[20])]);
  d.push(['--font-size-24', rem(fontSize[24])]);
  d.push(['--font-size-32', rem(fontSize[32])]);
  d.push(['--font-size-48', rem(fontSize[48])]);
  d.push(['--line-height-tight', String(lineHeight.tight)]);
  d.push(['--line-height-snug', String(lineHeight.snug)]);
  d.push(['--line-height-normal', String(lineHeight.normal)]);
  d.push(['--line-height-relaxed', String(lineHeight.relaxed)]);
  d.push(['--letter-spacing-display', em(letterSpacing.display)]);
  d.push(['--letter-spacing-caps', em(letterSpacing.caps)]);
  d.push(['--letter-spacing-body', em(letterSpacing.body)]);

  // ── Spacing (4px base, rem) ──────────────────────────────────────────────
  d.push(['--space-1', rem(spacing[1])]);
  d.push(['--space-2', rem(spacing[2])]);
  d.push(['--space-3', rem(spacing[3])]);
  d.push(['--space-4', rem(spacing[4])]);
  d.push(['--space-5', rem(spacing[5])]);
  d.push(['--space-6', rem(spacing[6])]);
  d.push(['--space-8', rem(spacing[8])]);
  d.push(['--space-10', rem(spacing[10])]);
  d.push(['--space-12', rem(spacing[12])]);
  d.push(['--space-16', rem(spacing[16])]);
  d.push(['--space-20', rem(spacing[20])]);

  d.push(['--measure-prose', `${measureProse}ch`]);

  // ── Border radii (px) ──────────────────────────────────────────────────────
  d.push(['--radius-xs', `${radii.xs}px`]);
  d.push(['--radius-sm', `${radii.sm}px`]);
  d.push(['--radius-md', `${radii.md}px`]);
  d.push(['--radius-DEFAULT', `${radii.default}px`]);
  d.push(['--radius-lg', `${radii.lg}px`]);
  d.push(['--radius-pill', `${radii.pill}px`]);

  // ── Z-index ladder ─────────────────────────────────────────────────────────
  d.push(['--z-base', String(zIndex.base)]);
  d.push(['--z-sticky', String(zIndex.sticky)]);
  d.push(['--z-dropdown', String(zIndex.dropdown)]);
  d.push(['--z-overlay', String(zIndex.overlay)]);
  d.push(['--z-modal', String(zIndex.modal)]);
  d.push(['--z-toast', String(zIndex.toast)]);
  d.push(['--z-cookie', String(zIndex.cookie)]);
  d.push(['--z-top', String(zIndex.top)]);

  // ── Glow shadows ───────────────────────────────────────────────────────────
  d.push(['--shadow-glow-coral', colors.glow.coral]);
  d.push(['--shadow-glow-aqua', colors.glow.aqua]);
  d.push(['--shadow-glow-amber', colors.glow.amber]);
  d.push(['--shadow-glow-green', colors.glow.green]);

  // ── Additional colors ──────────────────────────────────────────────────────
  d.push(['--color-bg-hover', colors.bg.hover]);
  d.push(['--color-bg-elevated', colors.bg.elevated]);
  d.push(['--color-text-danger', colors.text.danger]);
  d.push(['--color-text-disabled', colors.text.disabled]);
  d.push(['--color-text-placeholder', colors.text.placeholder]);
  d.push(['--color-text-on-accent', colors.text.onAccent]);
  d.push(['--color-text-on-dark', colors.text.onDark]);
  d.push(['--color-status-verified', colors.status.verified]);
  d.push(['--color-status-unverified', colors.status.unverified]);
  d.push(['--color-status-verified-bg', colors.status.verifiedBg]);
  d.push(['--color-status-unverified-bg', colors.status.unverifiedBg]);
  d.push(['--color-status-warning', colors.status.warning]);
  d.push(['--color-status-error', colors.status.error]);
  d.push(['--color-spotify', colors.spotify.brand]);

  // ── Overlay scale (white at increasing opacity) ────────────────────────────
  d.push(['--color-overlay-1', colors.overlay[1]]);
  d.push(['--color-overlay-2', colors.overlay[2]]);
  d.push(['--color-overlay-3', colors.overlay[3]]);
  d.push(['--color-overlay-4', colors.overlay[4]]);
  d.push(['--color-overlay-5', colors.overlay[5]]);

  // ── Shade scale (black at increasing opacity) ──────────────────────────────
  d.push(['--color-shade-1', colors.shade[1]]);
  d.push(['--color-shade-2', colors.shade[2]]);
  d.push(['--color-shade-3', colors.shade[3]]);
  d.push(['--color-shade-4', colors.shade[4]]);
  d.push(['--color-shade-5', colors.shade[5]]);
  d.push(['--color-shade-6', colors.shade[6]]);
  d.push(['--color-shade-7', colors.shade[7]]);
  d.push(['--color-shade-8', colors.shade[8]]);
  d.push(['--color-shade-9', colors.shade[9]]);
  d.push(['--color-shade-10', colors.shade[10]]);

  // ── Aqua alpha scale ───────────────────────────────────────────────────────
  d.push(['--color-aqua-a06', colors.aquaAlpha[6]]);
  d.push(['--color-aqua-a08', colors.aquaAlpha[8]]);
  d.push(['--color-aqua-a1', colors.aquaAlpha[10]]);
  d.push(['--color-aqua-a12', colors.aquaAlpha[12]]);
  d.push(['--color-aqua-a15', colors.aquaAlpha[15]]);
  d.push(['--color-aqua-a2', colors.aquaAlpha[20]]);
  // a25 has no entry in the aquaAlpha scale (only web's spotlight glow uses it);
  // kept as an explicit literal here rather than adding an RN-unused token.
  d.push(['--color-aqua-a25', 'rgba(0, 232, 208, 0.25)']);
  d.push(['--color-aqua-a3', colors.aquaAlpha[30]]);
  d.push(['--color-aqua-a4', colors.aquaAlpha[40]]);
  d.push(['--color-aqua-a7', colors.aquaAlpha[70]]);

  // ── Coral alpha scale (built from the raw coral rgb channel token) ─────────
  d.push(['--color-coral-a3', `rgba(${colors.rgb.coral}, 0.3)`]);

  // ── Amber alpha scale ──────────────────────────────────────────────────────
  d.push(['--color-amber-a08', colors.amberAlpha[8]]);
  d.push(['--color-amber-a12', colors.amberAlpha[12]]);
  d.push(['--color-amber-a2', colors.amberAlpha[20]]);
  d.push(['--color-amber-a3', colors.amberAlpha[30]]);

  // ── Focus rings + promoted surfaces (sourced from the token mirrors) ───────
  d.push(['--color-coral-ring', colors.ring.coral]);
  d.push(['--color-aqua-ring', colors.ring.aqua]);
  d.push(['--color-stage-fallback', colors.stage.fallback]);
  d.push(['--color-bg-sticky', colors.bg.sticky]);
  d.push(['--color-day-tab-active', colors.dayTab.active]);

  return d;
}

/**
 * Render the full generated CSS file (header comment + `@theme { ... }`).
 * The leading comment names the generator so no one hand-edits the output.
 */
export function generateThemeCss(): string {
  const decls = themeDeclarations()
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');

  return `/* AUTO-GENERATED — DO NOT EDIT BY HAND.
 * Source of truth: packages/shared/src/tokens/*.ts
 * Regenerate: pnpm --filter @festie/shared gen:theme
 * Generator:  packages/shared/src/tokens/generateThemeCss.ts
 *
 * These are the design tokens shared with React Native (colors/type/spacing/
 * motion/radii/z-index/breakpoints). CSS-only tokens (11px/13px font sizes,
 * focus rings, glass blur, accent hover tones, timeline NOW, bg-chrome, the
 * rgb-channel + var()-referencing one-offs) stay hand-authored in theme.css.
 */
@theme {
${decls}
}
`;
}
