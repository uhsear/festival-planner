// Lint staged files across the whole monorepo. Each glob is scoped so a commit that
// touches only unrelated files (yaml, md, .gitignore, etc.) matches nothing quietly —
// no "could not find any staged files" warning.
//
// Backend (root): runs root eslint which covers lib/ routes/ server.ts.
// packages/web + packages/shared + packages/mobile: delegate to each package's own
// eslint config via the --no-eslintrc / flat-config-aware binary in their node_modules.
// Using relative paths so lint-staged resolves each file against the correct config.
module.exports = {
  // ── backend (root) ──────────────────────────────────────────────────────────
  'lib/**/*.{ts,tsx,js,cjs}': 'eslint --fix',
  'routes/**/*.{ts,tsx,js,cjs}': 'eslint --fix',
  'server.ts': 'eslint --fix',

  // ── packages/shared ─────────────────────────────────────────────────────────
  'packages/shared/src/**/*.{ts,tsx,js}': (files) =>
    `pnpm --filter @festie/shared exec eslint --fix ${files.join(' ')}`,

  // ── packages/mobile ─────────────────────────────────────────────────────────
  'packages/mobile/**/*.{ts,tsx,js,jsx}': (files) =>
    `pnpm --filter @festie/mobile exec eslint --fix ${files.join(' ')}`,
};
