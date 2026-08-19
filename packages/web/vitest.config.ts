/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from 'vite';
import viteConfig from './vite.config';

// Coverage thresholds are set ~2-3 pts below actuals measured 2026-06-11:
//   statements=34.7%, branches=33.5%, functions=35.1%, lines=34.5%
// They only enforce when COVERAGE=1, to avoid slowing ordinary local runs.
// THE GATE IS LIVE IN CI: .github/workflows/ci.yml's frontend-tests job sets
// COVERAGE: '1' and runs `pnpm --filter @festie/web test -- --coverage`, so these
// thresholds do fail PRs. (An earlier version of this comment said the job did not
// pass --coverage; that was wrong and made the gate look decorative.)
// The numbers are stale as of 2026-08-18 — re-baseline them against a fresh run.
const withThresholds = process.env.COVERAGE === '1';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'json-summary'],
        include: ['src/components/**/*.tsx', 'src/hooks/**/*.ts', 'src/lib/**/*.ts'],
        exclude: ['src/**/*.test.*', 'src/**/*.spec.*', 'src/test-setup.ts', 'src/routeTree.gen.ts'],
        ...(withThresholds && {
          thresholds: {
            statements: 32,
            branches: 31,
            functions: 32,
            lines: 32,
          },
        }),
      },
    },
  }),
);
