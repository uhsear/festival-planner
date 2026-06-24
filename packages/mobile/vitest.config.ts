import { defineConfig } from 'vitest/config';

// Mobile unit tests run ONLY pure, framework-free modules (no React Native
// rendering) — webviewBridge, expenseView, festivalEditState, and the lifted
// adminValidators. So the node environment is correct here; we deliberately do
// NOT add jsdom or any RN transform. The tested modules either import nothing
// or only types from `@festie/shared/...`, whose `exports` map points at the
// workspace's TS source — vite resolves that through the pnpm symlink, so no
// alias is required.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
