import { defineConfig } from 'vitest/config';

// Coverage thresholds are set ~2-3 pts below current actuals (measured 2026-06-11):
//   statements=86.5%, branches=83.2%, functions=89.5%, lines=87.0%
// They only enforce when COVERAGE=1 to avoid slowing ordinary local/CI runs.
// The frontend-tests CI job does not pass --coverage; set COVERAGE=1 in that job
// (or add a separate coverage step) to make the gate active.
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
          statements: 84,
          branches: 81,
          functions: 87,
          lines: 84,
        },
      }),
    },
  },
});
