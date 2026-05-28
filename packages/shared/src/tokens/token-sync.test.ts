import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { colors } from './colors';

// theme.css is the source of truth; colors.ts is a hand-maintained mirror for
// React Native (which has no CSS vars). This guards against the two drifting.
// Resolve from cwd (robust across vitest's jsdom env, where import.meta.url is
// not a file URL) — covers running from the shared package, repo root, or packages/.
function findThemeCss(): string {
  const candidates = [
    resolve(process.cwd(), '../web/src/styles/theme.css'),
    resolve(process.cwd(), 'packages/web/src/styles/theme.css'),
    resolve(process.cwd(), 'web/src/styles/theme.css'),
  ];
  const found = candidates.find(existsSync);
  if (!found) throw new Error(`theme.css not found from cwd ${process.cwd()}`);
  return found;
}
const css = readFileSync(findThemeCss(), 'utf8');

function cssVar(name: string): string | undefined {
  // Match `--name:` exactly — the trailing `:` stops `--color-bg-card` from
  // matching `--color-bg-card-hover`.
  return new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css)?.[1]?.trim();
}

// Normalize so `.15`/`0.15` and inter-token spacing compare equal.
function norm(v: string): string {
  return v
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(^|[(,])\./g, '$10.');
}

const PAIRS: Array<[mirror: string, cssVar: string]> = [
  [colors.bg.primary, 'color-bg-primary'],
  [colors.bg.secondary, 'color-bg-secondary'],
  [colors.bg.card, 'color-bg-card'],
  [colors.bg.cardHover, 'color-bg-card-hover'],
  [colors.bg.sticky, 'color-bg-sticky'],
  [colors.text.primary, 'color-text-primary'],
  [colors.text.secondary, 'color-text-secondary'],
  [colors.text.muted, 'color-text-muted'],
  [colors.accent.coral, 'color-accent-coral'],
  [colors.accent.aqua, 'color-accent-aqua'],
  [colors.accent.amber, 'color-accent-amber'],
  [colors.priority.must, 'color-priority-must'],
  [colors.priority.want, 'color-priority-want'],
  [colors.priority.maybe, 'color-priority-maybe'],
  [colors.ring.coral, 'color-coral-ring'],
  [colors.ring.aqua, 'color-aqua-ring'],
  [colors.stage.fallback, 'color-stage-fallback'],
  [colors.dayTab.active, 'color-day-tab-active'],
];

describe('token mirror sync (colors.ts ↔ theme.css)', () => {
  it.each(PAIRS)('mirror "%s" stays in sync with --%s', (mirror, varName) => {
    const cssValue = cssVar(varName);
    expect(cssValue, `--${varName} not found in theme.css`).toBeDefined();
    expect(norm(mirror)).toBe(norm(cssValue!));
  });
});
