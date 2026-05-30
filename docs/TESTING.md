# Testing

## Unit tests (no database)

- **Backend:** `npm run test:unit` (or `npm test` for the full suite — integration files need a DB, see below).
- **Shared:** `pnpm --filter @festie/shared test`
- **Web:** `pnpm --filter @festie/web test`
- **Mobile typecheck:** `pnpm --filter @festie/mobile typecheck`

CI runs all of these (see `.github/workflows/ci.yml`): backend `node --test` with Postgres + Redis services, web + shared vitest, web/shared/mobile typecheck, web lint + shared lint.

## Backend integration tests (require a Postgres test DB)

~20 backend test files (`tests/profiles.test.ts`, `tests/response-shapes.test.ts`,
`tests/integration-*.test.ts`, etc.) talk to a real Postgres. They **hard-require**
`TEST_DATABASE_URL` and refuse to fall back to `DATABASE_URL` (a deliberate safety so
a test run can never touch a real database). Without it they fail locally with
`ERROR: TEST_DATABASE_URL env var required` — this is expected; they pass in CI,
which provides a throwaway Postgres.

### Run them locally

Requires Docker.

```bash
# 1. Start a throwaway Postgres on port 5433 (won't clash with a local 5432)
npm run test:db:up

# 2. Apply migrations
npm run test:db:migrate          # bash; on Windows use Git Bash / WSL

# 3. Point the tests at it and run (set DATABASE_URL too so guards that read it pass)
export TEST_DATABASE_URL=postgres://festie:festie@localhost:5433/festie_test
export DATABASE_URL=$TEST_DATABASE_URL
export REDIS_URL=redis://localhost:6379   # optional; some suites use Redis
npm test

# 4. Tear down when done
npm run test:db:down
```

On Windows PowerShell, set the env with `$env:TEST_DATABASE_URL = "postgres://festie:festie@localhost:5433/festie_test"` before `npm test`.

> Running these locally before opening a PR is the fastest way to catch the kind of
> contract bug the hardening audit found (e.g. an expense schema typed against the
> wrong column type) — the unit suites alone won't exercise the real DB round-trip.
