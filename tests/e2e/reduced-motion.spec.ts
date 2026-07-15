import { test, expect } from './fixtures.js';
import type { Page } from '@playwright/test';

/**
 * `prefers-reduced-motion` accessibility guard (WCAG 2.3.3).
 *
 * The app collapses every CSS animation/transition to ~0 under reduced
 * motion via one global rule: `@media (prefers-reduced-motion: reduce)` in
 * animations.css, which targets `*, *::before, *::after` and sets
 * `animation-duration`/`transition-duration` to `0.01ms !important`.
 *
 * We probe that rule with `.skeleton-shimmer` (theme.css), the app's real
 * loading-shimmer utility (`animation: skeleton-loading 1.4s linear
 * infinite`, used unconditionally by Skeleton.tsx and every `*Skeleton.tsx`
 * loading state — no JS-level reduced-motion gate of its own). A live
 * skeleton is only on screen for the brief window before the seeded server
 * responds, too transient to assert on without flaking, so we inject a
 * detached probe element carrying the same class instead: since the CSS rule
 * targets the universal selector, a detached probe collapses identically to
 * one actually on screen.
 */

async function gotoApp(page: Page, app: { baseUrl: string }) {
  await page.goto(app.baseUrl);
  await expect(page.locator('#app')).toBeVisible();
}

// Computed `animation-duration` (seconds) of a detached `.skeleton-shimmer`
// probe. Un-collapsed this is ~1.4s; under reduced motion, ~0.00001s (0.01ms).
async function skeletonShimmerAnimationDurationSeconds(page: Page): Promise<number> {
  const raw = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'skeleton-shimmer';
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).animationDuration;
    probe.remove();
    return value;
  });
  return parseFloat(raw);
}

test.describe('prefers-reduced-motion', () => {
  test('honors reduced motion: matchMedia matches and animations collapse to ~0', async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoApp(page, app);

    const prefersReduced = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    expect(prefersReduced).toBe(true);

    // 0.01ms next to skeleton-shimmer's real 1.4s — effectively zero.
    const durationSeconds = await skeletonShimmerAnimationDurationSeconds(page);
    expect(durationSeconds).toBeLessThanOrEqual(0.02);
  });

  test('baseline: without the preference, the same probe animates at full duration', async ({ app, page }) => {
    // Explicit 'no-preference' (rather than leaving emulation unset) keeps
    // this deterministic regardless of the host/CI runner's OS-level setting.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await gotoApp(page, app);

    const prefersReduced = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    expect(prefersReduced).toBe(false);

    // Proves the assertion above is meaningful: unforced, the shimmer runs
    // its real 1.4s loop (theme.css), not a coincidental zero.
    const durationSeconds = await skeletonShimmerAnimationDurationSeconds(page);
    expect(durationSeconds).toBeGreaterThan(0.02);
  });
});
