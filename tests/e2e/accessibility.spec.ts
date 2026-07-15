import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * Automated accessibility scan (axe-core) over the key guest-reachable routes.
 *
 * Runs the real WCAG rule engine against the in-process, Postgres-seeded app
 * from ./fixtures (same harness as festival-planner.spec). This is the
 * "prevention-side detector" complement to the author-time `jsx-a11y` eslint
 * rules: eslint catches static JSX defects, axe catches rendered-DOM defects
 * (roles, names, contrast, landmarks) the linter can't see.
 *
 * Gate policy: fail on `serious` + `critical` violations (the impactful,
 * unambiguous ones); `minor`/`moderate` are logged for visibility but do not
 * fail the run yet. Ratchet the gate down (include moderate) once the routes
 * are clean — see the filter below.
 */

// Guest-renderable routes (no auth needed): fest-1 auto-loads on '/', the auth
// screens render standalone, and /picks renders the GuestTeaser in place.
const ROUTES = ['/', '/login', '/register', '/picks'] as const;

const GATE_IMPACTS = new Set(['serious', 'critical']);

async function waitForShell(page: Page) {
  // '/' mounts #app; /login and /register mount .auth-screen. Wait for whichever
  // this route renders, then let async content settle before scanning.
  await page.locator('#app, .auth-screen').first().waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle').catch(() => {});
}

test.describe('accessibility (axe) — key routes', () => {
  for (const route of ROUTES) {
    test(`no serious/critical a11y violations on ${route}`, async ({ app, page }) => {
      await page.goto(`${app.baseUrl}${route}`);
      await waitForShell(page);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      // Surface everything axe found for this route (helps triage the tail).
      if (results.violations.length) {
        const summary = results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
          help: v.helpUrl,
        }));
        // eslint-disable-next-line no-console
        console.log(`axe violations on ${route}:\n${JSON.stringify(summary, null, 2)}`);
      }

      const gating = results.violations.filter((v) => GATE_IMPACTS.has(v.impact ?? ''));
      expect(gating, `serious/critical a11y violations on ${route}`).toEqual([]);
    });
  }
});
