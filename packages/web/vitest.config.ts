/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from 'vite';
import viteConfig from './vite.config';

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
        exclude: ['src/**/*.test.*', 'src/test-setup.ts'],
        thresholds: {
          statements: 40,
          branches: 35,
          functions: 40,
          lines: 40,
        },
      },
    },
  }),
);
