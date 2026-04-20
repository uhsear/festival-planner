# Contributing

Festie is source-available under the BSL 1.1. Contributions are welcome — bug reports, security findings, and pull requests all help improve the project.

## Bug Reports

Open a [GitHub issue](https://github.com/uhsear/festival-planner/issues) with a clear description, steps to reproduce, and expected vs. actual behavior. Include browser/OS info if it's a frontend issue.

## Security Vulnerabilities

Do **not** open public issues for security findings. Report them per [SECURITY.md](SECURITY.md).

## Pull Requests

1. Fork the repo and create a feature branch from `main`
2. Follow the existing code patterns (see below)
3. Run the quality gate before opening a PR:
   - `npm run lint` — ESLint passes
   - `npm test` — all test suites pass
   - `npm run lint:check` — no syntax errors
4. Write a clear commit message describing what changed and why
5. Open a PR against `main`

## Tech Stack

- **Backend:** Node.js 22, Express 4, Socket.IO 4, PostgreSQL 16, Redis 7
- **Frontend:** React 19 + Vite 6 + TypeScript (`packages/web/`)
- **State:** Zustand (client), TanStack Router (routing)
- **Workspace:** pnpm monorepo (`packages/`)

## Code Conventions

- `const`/`let` only (never `var`), 2-space indent, single quotes, trailing commas
- All SQL uses parameterized queries (`$1`, `$2`) — never string interpolation
- Route files export factory functions: `createXRoutes(deps)`
- Configuration lives in `lib/config.js` — no hardcoded values
- User input sanitized through `sanitizeString()` / `sanitizeIdentifier()`

## License

By contributing, you agree that your contributions will be licensed under the project's BSL 1.1 license.
