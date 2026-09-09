import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { generateThemeCss, themeDeclarations } from './generateThemeCss';
import { colors } from './colors';
import { fontSize, typeRoles } from './typography';
import { spacing } from './spacing';
import { radii } from './radii';
import { duration, durationEffects, durationSpatial, spring } from './motion';

// ─────────────────────────────────────────────────────────────────────────────
// Token-sync guard (replaces the old token-sync.test that read the now-deleted
// hand-maintained theme.css @theme block). The TS tokens are the single source
// of truth; packages/web/src/styles/theme.generated.css is emitted from them by
// generateThemeCss() and @import-ed by theme.css. These tests pin that:
//   1. the generator emits each token's literal value, and
//   2. the COMMITTED generated file equals the generator output — so editing a
//      token without re-running `pnpm --filter @festie/shared gen:theme` fails CI.
// ─────────────────────────────────────────────────────────────────────────────

function declMap(): Map<string, string> {
  return new Map(themeDeclarations());
}

describe('generateThemeCss — emits TS token literals', () => {
  const m = declMap();

  it('colors map to their TS literals', () => {
    expect(m.get('--color-bg-primary')).toBe(colors.bg.primary);
    expect(m.get('--color-accent-aqua')).toBe(colors.accent.aqua);
    expect(m.get('--color-accent-coral')).toBe(colors.accent.coral);
    expect(m.get('--color-accent-coral-strong')).toBe(colors.accent.coralStrong);
    expect(m.get('--color-priority-must')).toBe(colors.priority.must);
    expect(m.get('--color-coral-ring')).toBe(colors.ring.coral);
    expect(m.get('--color-stage-fallback')).toBe(colors.stage.fallback);
    expect(m.get('--color-day-tab-active')).toBe(colors.dayTab.active);
    expect(m.get('--shadow-glow-aqua')).toBe(colors.glow.aqua);
  });

  it('px ramps convert to the expected rem values', () => {
    // 16px base: 10/16 = 0.625rem, 48/16 = 3rem.
    expect(m.get('--font-size-10')).toBe('0.625rem');
    expect(m.get('--font-size-16')).toBe(`${fontSize[16] / 16}rem`);
    expect(m.get('--font-size-48')).toBe('3rem');
    expect(m.get('--space-1')).toBe('0.25rem');
    expect(m.get('--space-4')).toBe(`${spacing[4] / 16}rem`);
    expect(m.get('--space-20')).toBe('5rem');
  });

  it('radii emit px with the uppercase DEFAULT key', () => {
    expect(m.get('--radius-xs')).toBe(`${radii.xs}px`);
    expect(m.get('--radius-DEFAULT')).toBe(`${radii.default}px`);
    expect(m.get('--radius-pill')).toBe('999px');
  });

  it('the off-ramp 11/13 sizes are NOT generated (stay hand-authored in theme.css)', () => {
    expect(m.has('--font-size-11')).toBe(false);
    expect(m.has('--font-size-13')).toBe(false);
  });

  it('confidence + delivery colours map to their TS literals', () => {
    expect(m.get('--color-confidence-live')).toBe(colors.confidence.live);
    expect(m.get('--color-confidence-aging')).toBe(colors.confidence.aging);
    expect(m.get('--color-confidence-stale')).toBe(colors.confidence.stale);
    expect(m.get('--color-confidence-dark')).toBe(colors.confidence.dark);
    expect(m.get('--color-delivery-local')).toBe(colors.delivery.local);
    expect(m.get('--color-delivery-sent')).toBe(colors.delivery.sent);
    expect(m.get('--color-delivery-failed')).toBe(colors.delivery.failed);
  });

  it('the axis-named duration groups emit in ms beside the untouched base scale', () => {
    // The base scale is unchanged — the split is additive, so nothing that
    // already reads --duration-fast|med|slow moves.
    expect(m.get('--duration-fast')).toBe(`${duration.fast}ms`);
    expect(m.get('--duration-med')).toBe(`${duration.med}ms`);
    expect(m.get('--duration-slow')).toBe(`${duration.slow}ms`);
    expect(m.get('--duration-effects-fast')).toBe(`${durationEffects.fast}ms`);
    expect(m.get('--duration-effects-med')).toBe(`${durationEffects.med}ms`);
    expect(m.get('--duration-effects-slow')).toBe(`${durationEffects.slow}ms`);
    expect(m.get('--duration-spatial-fast')).toBe(`${durationSpatial.fast}ms`);
    expect(m.get('--duration-spatial-med')).toBe(`${durationSpatial.med}ms`);
    expect(m.get('--duration-spatial-slow')).toBe(`${durationSpatial.slow}ms`);
  });

  it('spatial motion settles slower than effects at every rung', () => {
    // The published guidance the split encodes. If someone "tidies" the two
    // groups into the same numbers, the split has stopped meaning anything.
    expect(durationSpatial.fast).toBeGreaterThan(durationEffects.fast);
    expect(durationSpatial.med).toBeGreaterThan(durationEffects.med);
    expect(durationSpatial.slow).toBeGreaterThan(durationEffects.slow);
  });

  it('the spring preset carries no `duration` (Reanimated 4 perceptual-duration trap)', () => {
    // withSpring's `duration` is PERCEPTUAL in Reanimated 4: real settle time
    // runs ~1.5x longer. The preset uses the physical mass/stiffness/damping
    // form so the trap cannot apply. Guard that it stays that way.
    expect(spring.touch).not.toHaveProperty('duration');
    expect(Object.keys(spring.touch).sort()).toEqual(['damping', 'mass', 'stiffness']);
    // Underdamped (z < 1) so spatial motion may overshoot, but not floppy.
    const z = spring.touch.damping / (2 * Math.sqrt(spring.touch.stiffness * spring.touch.mass));
    expect(z).toBeGreaterThan(0.7);
    expect(z).toBeLessThan(1);
  });

  it('the numeral type role is NOT generated (type roles stay hand-authored)', () => {
    // The generator emits the primitive ramp only; the eight (now nine) type
    // roles are @utility classes in theme.css. type-numeral is one of them.
    expect(m.has('--type-numeral')).toBe(false);
    expect(typeRoles.numeral.numeric).toBe('tabular-nums');
  });

  it('renders a single @theme block with no duplicate declarations', () => {
    const css = generateThemeCss();
    expect(css).toContain('@theme {');
    const names = themeDeclarations().map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('committed theme.generated.css is in sync with the tokens', () => {
  function findGeneratedCss(): string | undefined {
    const candidates = [
      resolve(process.cwd(), '../web/src/styles/theme.generated.css'),
      resolve(process.cwd(), 'packages/web/src/styles/theme.generated.css'),
      resolve(process.cwd(), 'web/src/styles/theme.generated.css'),
    ];
    return candidates.find(existsSync);
  }

  it('matches generateThemeCss() byte-for-byte (run gen:theme after editing tokens)', () => {
    const path = findGeneratedCss();
    expect(path, `theme.generated.css not found from cwd ${process.cwd()}`).toBeDefined();
    const onDisk = readFileSync(path!, 'utf8').replace(/\r\n/g, '\n');
    const expected = generateThemeCss().replace(/\r\n/g, '\n');
    expect(onDisk).toBe(expected);
  });
});
