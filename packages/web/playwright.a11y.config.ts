import { defineConfig, devices } from '@playwright/test';

/**
 * Standalone Playwright config for the Stagelight item 12 accessibility gate.
 *
 * Why a separate config (not the repo-root playwright.config.cjs)?
 *   - The root config targets the legacy app and needs a backend at :4000.
 *   - This suite only needs the *built static SPA* — the public auth surfaces
 *     (login / register / forgot-password) render fully client-side with no
 *     API, which is all axe's colour-contrast checks require.
 *   - Keeping it self-contained makes `pnpm --filter @festie/web test:a11y`
 *     runnable locally and in CI without standing up the API server.
 *
 * The webServer block builds + previews the app automatically, so a single
 * command (test:a11y) is fully self-bootstrapping and CI-ready.
 */
const PORT = Number(process.env.A11Y_PORT) || 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /axe-themes\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'output/playwright-a11y',
  use: {
    baseURL: BASE_URL,
    headless: true,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Build once, then serve the static SPA. `reuseExistingServer` lets a
  // dev run reuse a preview you already have open on PORT.
  webServer: {
    command: `pnpm run build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `${BASE_URL}/login`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
