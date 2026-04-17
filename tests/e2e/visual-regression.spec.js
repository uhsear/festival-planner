/**
 * Visual regression suite — Phase 4 deliverable (2026-04-09).
 *
 * Snapshots the login shell at three representative viewports. Baselines live
 * under tests/__snapshots__/ via playwright.config.js snapshotPathTemplate.
 *
 * First run (or after intentional UI changes):
 *   npm run test:visual:update
 *
 * Gate run:
 *   npm run test:visual
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.FESTIE_BASE_URL || 'http://localhost:4000';

const viewports = [
  { name: 'iphone-se',    width: 375, height: 667 },
  { name: 'iphone-14',    width: 390, height: 844 },
  { name: 'pixel-7',      width: 412, height: 915 },
];

for (const vp of viewports) {
  test(`login shell ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot(`login-${vp.name}.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
}
