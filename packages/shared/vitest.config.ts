import { defineConfig } from 'vitest/config';

// Coverage thresholds sit ~3 pts below the actuals measured 2026-09-07 with
// `pnpm --filter @festie/shared test:coverage` (statements=75.49%,
// branches=69.31%, functions=73.66%, lines=76.81%). They enforce only when
// COVERAGE=1 to gate regressions without slowing ordinary local/CI runs.
const withThresholds = process.env.COVERAGE === '1';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-setup.ts', 'src/**/index.ts', 'src/types/**'],
      ...(withThresholds && {
        thresholds: {
          statements: 72,
          branches: 66,
          functions: 70,
          lines: 73,
        },
      }),
    },
  },
});
