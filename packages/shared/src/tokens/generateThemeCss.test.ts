import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { generateThemeCss, themeDeclarations } from './generateThemeCss';
import { colors } from './colors';
import { fontSize } from './typography';
import { spacing } from './spacing';
import { radii } from './radii';

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
