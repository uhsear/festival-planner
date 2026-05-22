/**
 * Visual regression for authenticated views.
 *
 * Uses storageState from auth.setup.js (one shared registered user).
 * Tolerates 2% pixel drift; masks per-run varying elements.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.FESTIE_BASE_URL || 'http://localhost:4000';
const viewports = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-14', width: 390, height: 844 },
  { name: 'pixel-7',   width: 412, height: 915 },
];
const routes = [
  { name: 'picks', path: '/picks' },
  { name: 'grid',  path: '/grid' },
  { name: 'crew',  path: '/crew' },
];

for (const vp of viewports) {
  for (const route of routes) {
    test(`auth ${route.name} ${vp.name}`, async ({ page }: any) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const masks = await page.locator('.profile-badge, .username, [data-username], time, .timestamp').all();
      await expect(page).toHaveScreenshot(`${route.name}-${vp.name}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.02,
        animations: 'disabled',
        mask: masks,
      });
    });
  }
}
