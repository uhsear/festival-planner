<!-- Copyright (c) 2026 Asir Khan. All rights reserved. See the LICENSE file. -->

# Migrations

PostgreSQL schema migrations for the Festie backend. Files are applied on boot
by the runner in [`lib/planner-db-pg.ts`](../lib/planner-db-pg.ts), version-keyed
by the `schema_migrations` ledger.

## File naming

```
NNN_description.sql      e.g. 012_add_crew_roles.sql
NNNb_description.sql     suffix letter only to disambiguate a version collision
```

`NNN` is a zero-padded integer version (3–4 digits). The runner discovers files
matching `^(\d{3,4})([a-z])?_.*\.sql$`, sorts by `(version, suffix)`, and applies
any whose `version` is not yet recorded in `schema_migrations`.

## How migrations are applied

- Each normal migration runs in a **single transaction**: the SQL body and the
  `INSERT INTO schema_migrations` bookkeeping row commit together, or roll back
  together. There is no partial-apply state.
- Migrations using `CREATE/DROP INDEX CONCURRENTLY` cannot run inside a
  transaction, so each statement runs in autocommit. These **must** be written
  idempotently (`IF [NOT] EXISTS`, guarded `DO $$` blocks) because no atomic
  rollback is possible.
- Under a multi-instance deploy, a Postgres **session advisory lock** serializes
  the apply critical section so only one instance applies at a time; the others
  block, then wake to find the ledger already advanced and no-op.

## Down-migration strategy

**There are no down-migrations. Migrations are additive, idempotent, and
forward-only.**

Rationale:

1. **Additive** — new migrations add tables, columns, indexes, or backfill data.
   They do not destructively drop or rewrite existing structures that older
   running instances still depend on. This keeps zero-downtime rolling deploys
   safe: an old instance and a new instance can coexist against the same schema
   during a rollout.
2. **Idempotent** — every migration is written so re-running it is a no-op
   (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO
   NOTHING`, guarded `DO` blocks). A retried or partially-recorded apply heals
   itself on the next boot rather than failing.
3. **Forward-only** — the only way schema state moves is forward to a higher
   version. We never ship a numbered `down` step that drops or reverts a prior
   migration.

### How to roll back

If a deploy must be reverted, **restore the database from backup** to a point
before the bad migration applied. Do **not** author a destructive down-migration
to undo a forward one:

- A destructive `DROP`/`ALTER ... DROP COLUMN` can silently break older
  instances still serving traffic during a rollout, and is itself irreversible
  if it deletes data.
- Backups are the source of truth for point-in-time recovery and are tested
  against the real production schema.

### Correcting a bad migration

To change schema introduced by an already-applied migration, write a **new,
higher-numbered, additive** migration that moves the schema forward to the
desired state (e.g. add the corrected column, backfill, then leave the old one
in place or drop it only once no running instance references it, in a later
deploy). Never edit an already-applied migration file in place — the ledger keys
on version, so an edited file with the same `NNN` will not re-apply.

## Authoring checklist

- [ ] Next sequential `NNN_` (or `NNNb_` to break a version tie).
- [ ] Additive only — no destructive drops of structures live instances use.
- [ ] Idempotent — safe to run twice (`IF [NOT] EXISTS`, guarded `DO` blocks).
- [ ] `CONCURRENTLY` index ops are kept out of explicit transaction blocks.
- [ ] No `BEGIN;`/`COMMIT;` wrapping the whole file — the runner manages the
      transaction (an outer pair is stripped, but don't rely on it).
