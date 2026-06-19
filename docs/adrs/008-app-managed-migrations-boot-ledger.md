# ADR-008: App-Managed Migrations Auto-Applied on Boot via Version Ledger

**Status:** Accepted
**Date:** 2026-06-19

## Context

Festie has 54 migration files (`migrations/NNN_*.sql`) covering schema versions 004 through 057.
Historically, migrations were applied by shell scripts that ran `psql -f "$file"` in a loop. Two
defects in that approach were discovered during a 2026-04-14 audit: (1) the legacy script never
inserted rows into `schema_migrations`, so every apply succeeded in the database but was never
recorded; (2) a later script used two separate `psql` invocations — one for the SQL file and one
for the `INSERT INTO schema_migrations` — meaning a network blip between them could leave the
schema changed but unrecorded. These defects caused drift: migrations 012–015, 017–024, and 026
were present in the live schema but absent from the bookkeeping table.

Alternatives considered were a dedicated migration tool (Flyway, Liquibase, node-pg-migrate) or a
separate npm script that operators run manually before restarting the server. These would require
additional process coordination and do not fit the single-operator deploy model. Down-migrations
(rollback SQL) were explicitly rejected as too risky to maintain with high confidence on a small
team.

## Decision

Migration logic lives entirely inside `lib/planner-db-pg.ts`. On the first call to
`openPlannerDatabase()` per process per database URL, `runPostgresMigrations()` is invoked
automatically. It discovers `.sql` files in `migrations/` sorted by numeric prefix, checks them
against the integer `version` column in `schema_migrations`, and applies each pending migration
inside a single `pg` client in a `BEGIN … COMMIT` transaction — the SQL body and the
`INSERT INTO schema_migrations` row are committed atomically. Migrations using
`CREATE INDEX CONCURRENTLY` (which cannot run inside a transaction) are handled separately: each
statement runs in autocommit with an idempotent `ON CONFLICT DO NOTHING` bookkeeping insert. A
process-level guard (`MIGRATED_URLS` Map keyed on the database URL) prevents re-running on
repeated calls within the same process. The deploy process note is: "Migrations are APP-MANAGED —
no separate migration step in the deploy."

## Consequences

- Operators never need to remember a separate migration command; a `pm2 restart festie` is
  sufficient for both code and schema updates.
- Any migration failure aborts with a rolled-back transaction and a thrown error logged at `ERROR`
  level — it is never silently swallowed.
- A startup gap check compares files on disk against recorded rows and logs a `WARN` listing
  missing versions, making ledger drift immediately visible.
- There are no down-migrations; rollback of a failed deploy relies on git-level rollback scripts
  and manual schema repair if the migration partially succeeded before the process-level guard
  fired.
- Trade-off: the migration runner acquires a pg pool connection on every process boot, even if
  migrations are already current. Under PM2 with multiple workers this means N connection
  acquisitions at restart time; the `MIGRATED_URLS` Map mitigates repeated work within a single
  process but not across workers.
- Trade-off: test environments skip the runner entirely (detected via `NODE_ENV=test` or a `_test`
  suffix in `DATABASE_URL`) — test harnesses manage their own schema via `ensureTestSchema()`.
  This divergence means the runner itself is not exercised against the test database.
- Trade-off: `CONCURRENTLY` migrations cannot be transactional; if the process crashes mid-apply
  of such a migration, the index may exist in the schema without a `schema_migrations` row,
  requiring manual reconciliation.
