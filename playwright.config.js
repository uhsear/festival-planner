const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  snapshotDir: 'tests/__snapshots__',
  snapshotPathTemplate: 'tests/__snapshots__/{testFileName}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'output/playwright/report' }],
  ],
  outputDir: 'output/playwright/test-results',
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'visreg-setup', testMatch: /auth\.setup\.js/ },
    {
      name: 'visreg-auth',
      testMatch: /visual-regression-auth\.spec\.js/,
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
  ],
});
