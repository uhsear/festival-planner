# Festie Test Suite

## Quick Start

```bash
# Unit tests only (no database required)
npm run test:unit

# All tests (requires TEST_DATABASE_URL)
npm test

# Coverage report
npm run test:coverage

# Single file
node --test tests/integration-auth.test.js

# E2E (Playwright)
npm run test:e2e
```

## Test Database Setup

Integration tests require a PostgreSQL 16 test database. **Production safety**: tests
never fall back to `DATABASE_URL` -- they only use `TEST_DATABASE_URL`, and the URL
must contain `_test` in the database name.

### 1. Create the test database

```bash
createdb festival_planner_test
# or via psql:
psql -c "CREATE DATABASE festival_planner_test;"
```

### 2. Set the environment variable

Add to your `.env` file (project root):

```
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/festival_planner_test
```

Replace `user` and `pass` with your PostgreSQL credentials.

### 3. Run migrations

Tests apply migrations automatically on first run via `ensureTestSchema()` in
`_integration-helpers.js`. No manual migration step is needed.

### 4. Run the full suite

```bash
npm test
```

## Which Tests Need the Database?

### Pure unit tests (no database)

These run without `TEST_DATABASE_URL`:

| File | What it tests |
|------|---------------|
| `unit.test.js` | Config, schemas, helpers, sanitization, merge logic |
| `export-utils.test.js` | ICS/HTML export formatting (pure functions) |
| `notifications-factory.test.js` | Notification service factory, DnD window |

### Integration tests (require TEST_DATABASE_URL)

These skip gracefully when `TEST_DATABASE_URL` is absent. In CI, the variable
is always set.

| File | What it tests |
|------|---------------|
| `integration-auth.test.js` | Register, login, logout, sessions |
| `integration-festivals.test.js` | Festival CRUD, stages, days, sets |
| `integration-picks.test.js` | Pick/unpick sets, conflict detection |
| `integration-crews.test.js` | Crew create, join, leave, invite codes |
| `integration-notifications.test.js` | Push notification delivery paths |
| `integration-admin.test.js` | Admin routes, role checks |
| `integration-export.test.js` | Server-side export (HTML, ICS, PNG) |
| `integration-sockets.test.js` | Socket.IO real-time events |
| `critical-paths.test.js` | End-to-end user journeys |
| `hardening.test.js` | Rate limiting, session edge cases, security |
| `coverage-auth.test.js` | Auth edge cases for coverage |
| `coverage-routes.test.js` | Route edge cases for coverage |
| `coverage-edges.test.js` | Library edge cases, migration idempotency |
| `notifications.test.js` | Notification preferences, DnD |
| `response-shapes.test.js` | API response contract verification |
| `tech-debt-fixes.test.js` | Migration schema verification |
| `phase1-features.test.js` | Phase 1 feature routes |
| `email-auth.test.js` | Email verification, password reset |
| `profiles.test.js` | Festival profile CRUD |
| `account.test.js` | Username change, avatar, soft-delete, GDPR export |
| `crew-features.test.js` | Crew polls, meeting points |
| `crews.test.js` | Crew routes (create, invite, membership) |
| `export.test.js` | Export routes (HTML, ICS, calendar, picks-card) |
| `share.test.js` | Public share pages, vanity URLs |
| `lineup-import.test.js` | CSV/TSV lineup import (admin) |

## Skip-Gate Pattern

All integration test files use the same pattern:

```js
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

describe('feature name', { skip }, () => {
  // tests here
});
```

- Without `TEST_DATABASE_URL`: describe blocks are skipped (reported as skipped, not failed)
- With `TEST_DATABASE_URL`: all tests run normally
- Safety: the URL must contain `_test` to prevent accidental production writes

Some files (like `coverage-edges.test.js`) use `process.exit(1)` instead of
skip-gate because they have DB-dependent tests mixed with unit tests that still
need the pool.

## Coverage

Coverage is collected with `c8` and enforced at 60% minimum (lines, branches,
functions, statements). The threshold is configured in `.c8rc.json` at the project
root and checked in CI.

```bash
# Generate coverage report
npm run test:coverage

# Check threshold locally
npx c8 check-coverage
```

## CI

GitHub Actions runs the full suite with real Postgres 16 and Redis 7 services.
See `.github/workflows/ci.yml`. The test job:

1. Applies all migrations to the test database
2. Runs `npm run test:coverage`
3. Enforces the 60% coverage threshold
4. Uploads the coverage report as an artifact
