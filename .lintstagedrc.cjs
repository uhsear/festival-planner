// Lint only the staged backend files (lib/, routes/, server.ts). Scoped globs so a
// commit that touches no backend TS/JS (yaml, md, .gitignore, etc.) matches nothing
// quietly — no "could not find any staged files" warning. packages/* are linted in
// their own CI jobs, not here.
module.exports = {
  'lib/**/*.{ts,tsx,js,cjs}': 'eslint --fix',
  'routes/**/*.{ts,tsx,js,cjs}': 'eslint --fix',
  'server.ts': 'eslint --fix',
};
