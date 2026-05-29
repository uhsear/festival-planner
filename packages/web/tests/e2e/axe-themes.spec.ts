/**
 * Stagelight backlog item 12 — "axe-on-light" accessibility gate.
 *
 * The dark theme is already validated elsewhere; this suite specifically
 * asserts that the LIGHT and DAYLIGHT themes introduce no *serious* or
 * *critical* WCAG 2 A/AA violations. Item 12's whole point is contrast on
 * light backgrounds (the retuned status colours in light-theme.css), so we
 * run axe in a real browser where computed CSS — and therefore axe's
 * colour-contrast rule — actually works (jsdom cannot compute contrast).
 *
 * Theme application: in the running app the theme is toggled by setting
 * document.documentElement[data-theme] = 'light' | 'daylight' (persisted in
 * localStorage 'fp-theme'). The public auth surfaces do not render the
 * <Header> that performs this, so we apply the attribute directly the same
 * way the app does, then confirm it stuck before scanning.
 *
 * Run:  pnpm --filter @festie/web run test:a11y
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type Theme = 'light' | 'daylight';

// Public surfaces that render fully client-side (no backend / no auth).
const SURFACES = [
  { name: 'login', path: '/login' },
  { name: 'register', path: '/register' },
  { name: 'forgot-password', path: '/forgot-password' },
];

const THEMES: Theme[] = ['light', 'daylight'];

// Only fail the build on the violation levels that matter for a gate.
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

for (const theme of THEMES) {
  for (const surface of SURFACES) {
    test(`a11y [${theme}] ${surface.name} — no serious/critical WCAG violations`, async ({
      page,
    }) => {
      // Seed persisted theme so any Header-bearing surface picks it up too.
      await page.addInitScript((t) => {
        try {
          window.localStorage.setItem('fp-theme', t as string);
        } catch {
          /* storage may be unavailable in some sandboxes — test still runs */
        }
      }, theme);

      await page.goto(surface.path, { waitUntil: 'networkidle' });

      // Apply the theme the same way the app does, directly on <html>. Public
      // auth surfaces don't mount the Header that normally does this.
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t as string);
      }, theme);

      // Confirm the theme actually took effect; otherwise the scan is moot.
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      // Wait for real content (not just the shell) to be present.
      await page.locator('body').waitFor({ state: 'visible' });

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const blocking = results.violations.filter(
        (v) => v.impact && BLOCKING_IMPACTS.has(v.impact),
      );

      // Emit a readable summary on failure.
      if (blocking.length > 0) {
        const summary = blocking
          .map(
            (v) =>
              `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n` +
              v.nodes
                .slice(0, 5)
                .map((n) => `      - ${n.target.join(' ')}`)
                .join('\n'),
          )
          .join('\n');
        // eslint-disable-next-line no-console
        console.error(
          `axe found ${blocking.length} serious/critical violation(s) on ` +
            `[${theme}] ${surface.path}:\n${summary}`,
        );
      }

      expect(
        blocking,
        `serious/critical WCAG violations on [${theme}] ${surface.path}`,
      ).toEqual([]);
    });
  }
}
