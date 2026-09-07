/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from 'vite';
import viteConfig from './vite.config';

// Coverage thresholds are set ~3 pts below actuals measured 2026-09-07 with
// `pnpm --filter @festie/web test:coverage`:
//   statements=39.68%, branches=35.69%, functions=38.72%, lines=39.57%
// They only enforce when COVERAGE=1, to avoid slowing ordinary local runs.
// Branches stays at 31: its actual is 35.7%, a 4.7 pt gap, under the 5 pt
// margin this ratchet requires before raising a floor.
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
            statements: 36,
            branches: 31,
            functions: 35,
            lines: 36,
          },
        }),
      },
    },
  }),
);
