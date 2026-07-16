import type { Page } from '@playwright/test';

import { test, expect, DEFAULT_PASSWORD } from './fixtures.js';

const viewports = [
  { name: 'iphone-se', width: 320, height: 568 },
  { name: 'iphone-14', width: 390, height: 844 },
  { name: 'ipad', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function gotoSchedule(
  page: Page,
  app: { baseUrl: string },
  route: '/cards' | '/timeline' = '/cards',
) {
  // The suite verifies settled layout, not entrance-animation keyframes. This
  // also avoids Chromium's screenshot animation fast-forward leaving
  // content-visibility/staggered cards in an unpainted first frame.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${app.baseUrl}${route}`);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('[data-testid="festival-select"]')).toHaveValue('fest-1');

  if (route === '/cards') {
    await expect(page.locator('[data-testid="set-card"][data-artist="Alpha"]')).toBeVisible();
  } else {
    await expect(page.getByRole('region', { name: 'Timeline view' })).toBeVisible();
  }

  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Give Chromium two painted frames after lazy route/content-visibility work.
  // Without this, the 320px timeline intermittently captures blank chrome.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await page.waitForTimeout(100);
}

async function createJoinedUser(page: Page, app: { baseUrl: string }) {
  const headers = { 'content-type': 'application/json', 'x-festie-request': '1' };
  const username = `responsive_${Date.now()}`;
  const register = await page.context().request.post(`${app.baseUrl}/api/v1/auth/register`, {
    headers,
    data: {
      username,
      password: DEFAULT_PASSWORD,
      confirmPassword: DEFAULT_PASSWORD,
      dateOfBirth: '1995-01-01',
      tosAccepted: true,
    },
  });
  expect(register.ok(), `registration failed (${register.status()})`).toBe(true);

  const join = await page.context().request.post(`${app.baseUrl}/api/v1/profiles`, {
    headers,
    data: { festivalId: 'fest-1' },
  });
  expect(join.ok(), `festival join failed (${join.status()})`).toBe(true);

  // APIRequestContext shares cookies with the page, but the app's in-memory
  // auth store still starts as a guest. Sign in through the UI so this test
  // exercises the same profile-loading path that exposes pick controls.
  await page.goto(`${app.baseUrl}/login`);
  await page.getByLabel('Username').fill(username);
  await page.locator('input[aria-label="Password"]').fill(DEFAULT_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/cards$/);
}

async function expectViewportScreenshot(page: Page, name: string) {
  // toHaveScreenshot's animation fast-forward drops composited chrome on the
  // Timeline route. The page already emulates reduced motion, so compare a raw
  // settled viewport capture and keep the same snapshot/update workflow.
  const image = await page.screenshot({ animations: 'allow', fullPage: false });
  expect(image).toMatchSnapshot(name, { maxDiffPixelRatio: 0.05 });
}

test.describe('responsive design', () => {
  for (const vp of viewports) {
    test(`card grid fills width at ${vp.name} (${vp.width}px)`, async ({ app, page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoSchedule(page, app);

      const grid = page.locator('.card-grid');
      await expect(grid).toBeVisible();
      await expect(grid.locator('.set-card')).toHaveCount(3);

      const gridBox = await grid.boundingBox();
      expect(gridBox).toBeTruthy();
      expect(gridBox!.width).toBeGreaterThan(Math.min(vp.width * 0.7, 700));

      const firstCard = await grid.locator('.set-card').first().boundingBox();
      expect(firstCard).toBeTruthy();
      expect(firstCard!.width).toBeGreaterThan(200);
    });
  }

  for (const vp of viewports) {
    test(`no horizontal overflow at ${vp.name} (${vp.width}px)`, async ({ app, page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoSchedule(page, app);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    });
  }

  test('header stays above scrolled content', async ({ app, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoSchedule(page, app);

    await page.locator('#main-content').evaluate((main) => {
      main.scrollTop = 500;
    });

    const header = page.locator('header').first();
    await expect(header).toBeVisible();
    const headerBox = await header.boundingBox();
    expect(headerBox).toBeTruthy();
    expect(headerBox!.y).toBeLessThanOrEqual(5);
  });

  test('detail panel opens above schedule', async ({ app, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoSchedule(page, app);

    const firstCard = page.locator('[data-testid="set-card"]').first();
    await firstCard.getByRole('button', { name: /^Alpha — / }).click();

    const drawer = page.locator('[aria-label="Set detail panel"]');
    await expect(drawer).toBeVisible();
    await page.getByRole('button', { name: 'Close detail panel' }).click();
    await expect(drawer).toHaveCount(0);
  });

  test('priority buttons meet 44px minimum', async ({ app, page }) => {
    await createJoinedUser(page, app);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoSchedule(page, app);

    const buttons = page.locator('.card-priority-btn');
    await expect(buttons).toHaveCount(9);

    for (let i = 0; i < 6; i++) {
      const box = await buttons.nth(i).boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('search input fits within viewport at 320px', async ({ app, page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await gotoSchedule(page, app);

    const searchInput = page.getByLabel('Search festival artists');
    await expect(searchInput).toBeVisible();
    const box = await searchInput.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  });

  for (const vp of viewports) {
    test(`cards view screenshot ${vp.name}`, async ({ app, page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoSchedule(page, app);
      await expectViewportScreenshot(page, `cards-${vp.name}.png`);
    });

    test(`timeline view screenshot ${vp.name}`, async ({ app, page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoSchedule(page, app, '/timeline');
      await expectViewportScreenshot(page, `timeline-${vp.name}.png`);
    });
  }
});
