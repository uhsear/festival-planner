# DB Migration -- Claude Code Prompt

Safe schema change flow. Prevents the recurring P1 bugs from the 2026-04 debug loops (soft-delete JOINs, missing indexes, non-idempotent DDL, CI-vs-prod drift from retired migrations).

---

## The Prompt

```
Write + ship a DB migration: <CHANGE DESCRIPTION>.

SSH via paramiko (Windows) from main thread. Inspect current schema BEFORE writing the file. Never hardcode table counts -- always live-verify.

---

## Phase 1 -- Inspect
Run on prod (via paramiko):
  PAGER=cat psql -d festival_planner -tA -c "\dt"                          # all tables
  PAGER=cat psql -d festival_planner -tA -c "\d+ <table>"                  # columns, indexes, FKs
  PAGER=cat psql -d festival_planner -tA -c "SELECT MAX(version) FROM schema_migrations"

Sanity-check: `ls migrations/*.sql | wc -l` should equal `SELECT count(*) FROM schema_migrations`. If not, schema_migrations is drifting -- see lib/planner-db-pg.js runner (ships one-time backfill).

## Phase 2 -- Plan
- Next migration number: `MAX(version)+1`, zero-padded (e.g. 029).
- Forward-only or reversible? State explicitly in header.
- Locking risk: if blocking writes on a large table, use `CREATE INDEX CONCURRENTLY` and split DDL from DML (concurrent index can't run in a txn).
- Data backfill for adding NOT NULL: ADD NULL -> backfill -> SET NOT NULL in separate statements.
- Soft-delete impact: does the change interact with `deleted_at IS NULL` filters? Add them to any new JOINs.
- CI-vs-prod drift: if this change depends on a column added by a retired migration, guard with `ADD COLUMN IF NOT EXISTS` in this file too (lesson from migration 014/023).

## Phase 3 -- Write
File: `migrations/<NNN>_<slug>.sql`. Rules:
- Idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `DROP INDEX IF EXISTS`.
- Wrap in BEGIN/COMMIT unless file contains `CREATE INDEX CONCURRENTLY`.
- Every new table: PK, `created_at TIMESTAMPTZ DEFAULT NOW()`, `deleted_at TIMESTAMPTZ` if soft-deletable.
- Every FK: explicit `ON DELETE` (CASCADE / SET NULL / RESTRICT).
- Every new query pattern: matching index.
- Header comment: purpose, related audit finding, explicit rollback notes.
- DO NOT insert into schema_migrations by hand -- the runner does that in-txn.

## Phase 4 -- Store Method
Update `lib/db/stores/<table>.js` (or create new store) with CRUD methods.
If the migration changes API response shapes (column renames, new fields, removed fields), also update:
  - `packages/shared/src/types/` -- shared TypeScript types consumed by the React frontend
  - Any Zustand stores or React Query hooks in `packages/web/src/` that depend on the affected API responses
- Every method `async`.
- Parameterized queries only. Never concatenate.
- Reads: `WHERE deleted_at IS NULL` if soft-deletable.
- Throws errors with `{ cause: origErr }` on re-throw (ESLint rule).
- Register new store in `lib/db/index.js` if adding a whole new store module.

## Phase 5 -- Test
- Add integration test to the relevant `tests/integration-<feature>.test.js` that exercises the new column/table.
- If change is cross-suite: also add skip-gated test in `tests/critical-paths.test.js`.
- Apply migration twice on a throwaway DB to prove idempotency: `psql -f migrations/NNN.sql && psql -f migrations/NNN.sql` -- second run must be a no-op.
- `node --check` any JS store edits.
- Deploy via paramiko SFTP. Test gate must show `# fail 0`.

## Phase 6 -- Ship
Deploy via paramiko:
  - SFTP migration file to `migrations/`.
  - SFTP store updates.
  - `npm test` on prod (halts on regression).
  - Migration applies via `lib/planner-db-pg.js` runner at app boot (records in schema_migrations in-txn).
  - `pg_dump festival_planner -t <affected_tables> > ~/backups/pre-<NNN>-<ts>.sql` BEFORE the apply if table is large or has data loss risk.
  - git commit/push; `pm2 restart festie`; health check.
  - Watch CI (test(20) + test(22) + lint must all succeed).
  - If CI test DB fails on fresh apply: it's usually a dependent-column gap -- add `ADD COLUMN IF NOT EXISTS` to THIS migration.

## Phase 7 -- Verify
- `psql -tA -c "\d+ <table>"` on prod -- confirm columns/indexes landed.
- `SELECT count(*) FROM schema_migrations` = `ls migrations/*.sql | wc -l`.
- Tail pm2 logs 10 min for new DB errors: `pm2 logs festie --lines 200 --nostream | grep -i error`.

ROLLBACK PLAN (must be documented in the migration header BEFORE shipping):
```
-- ROLLBACK (only if migration applied cleanly but needs reversing):
--   BEGIN;
--     <reverse DDL>
--     DELETE FROM schema_migrations WHERE version = <NNN>;
--   COMMIT;
```
If forward-only, document the data-loss impact of any revert.

## Phase 8 -- Memory
If migration adds a non-obvious pattern (new FK cascade rule, soft-delete twist, cross-table invariant), add a `project_*.md` memory note pointing to it. Do NOT add counts -- those stay live-derived.

WRAP UP:
"Migration <NNN> applied. Commit <sha>. New indexes: N. schema_migrations: M/M. CI: success. Rollback: [command or 'forward-only']. Backup: [path]."
```
