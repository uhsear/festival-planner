const { defineConfig, devices } = require('@playwright/test');

const artifactDir = process.env.PLAYWRIGHT_ARTIFACT_DIR || 'output/playwright';

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      stylePath: './tests/e2e/screenshot.css',
    },
  },
  snapshotDir: 'tests/__snapshots__',
  snapshotPathTemplate: 'tests/__snapshots__/{testFileName}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `${artifactDir}/report` }],
  ],
  outputDir: `${artifactDir}/test-results`,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'visreg-setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'visreg-auth',
      testMatch: /visual-regression-auth\.spec\.ts/,
      use: { storageState: 'tests/e2e/.auth/state.json' },
      dependencies: ['visreg-setup'],
    },
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
