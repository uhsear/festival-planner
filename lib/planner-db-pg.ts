// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Public entry point for the PostgreSQL data layer.
 *
 * Historically this file was a one-line re-export of `./db/index`. The
 * 2026-04-14 audit found that `schema_migrations` was drifting — several
 * migration files (012–015, 017–024, 026) were clearly applied to the DB
 * (their tables/columns/indexes exist) yet the bookkeeping rows were
 * missing from `schema_migrations`. Root cause analysis traced the drift
 * to two defects in the historical runner chain:
 *
 *   1. `scripts/auto-deploy.sh` (legacy) ran `for f in migrations/*.sql;
 *      do psql -f "$f"; done` with NO per-migration transaction and NO
 *      INSERT into `schema_migrations`. Every apply succeeded in the DB
 *      but zero rows were ever recorded.
 *   2. `docs/research/research-2026/phase-3-6/migrate.sh` (partially
 *      adopted) DID record rows, but it ran the `-f file` and the
 *      `INSERT INTO schema_migrations` as two SEPARATE `psql` invocations
 *      — i.e. two distinct TCP sessions. If anything (network blip,
 *      trigger side-effect, PK collision on the double-version 019
 *      files) made the second call fail, the schema change landed and
 *      the row didn't. The error was printed but `set -e` on the bash
 *      script did not always halt cleanly because the apply had already
 *      exited 0.
 *
 * The fix moves the runner into Node, inside a single psql connection
 * (one client, one `BEGIN … COMMIT`, the SQL file + the INSERT execute
 * together). Any failure rolls the whole thing back and throws — never
 * silent-continue. The runner also performs a boot-time gap check:
 * count of `migrations/NNN_*.sql` files on disk vs. count of rows in
 * `schema_migrations`. If the disk count is larger, we log a single
 * `WARN` per process boot listing the missing versions so the drift is
 * loud and actionable.
 *
 * Public API compatibility: this module still exports everything
 * `./db/index` did (`createStores`, `openPlannerDatabase`, etc.) with
 * identical signatures and return shapes. Only `openPlannerDatabase`
 * gets a thin wrapper that triggers the migration runner exactly once
 * per-process (protected by an in-memory `Set` keyed on DATABASE_URL so
 * repeated calls in tests don't re-run migrations).
 *
 * See `_MIGRATE_AUDIT_NOTES.md` in this directory for the full
 * investigation trail, including how the legacy SQLite `lib/migrate.js`
 * runner (still present for the sqlite-to-pg import script) differs
 * from this Postgres runner and why the two must not be confused.
 */

import fs from 'fs';
import path from 'path';

import { splitSqlStatements, usesConcurrently } from './db/sql-split.js';
import {
  createStores,
  createDbLatencyTracker,
  openPlannerDatabase as openPlannerDatabaseRaw,
  parseJsonObject,
  serializeJson,
  withTransaction,
} from './db/index.js';

// ── Migration runner ─────────────────────────────────────────────────────

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');

/**
 * Fixed application-specific key for the Postgres session advisory lock
 * that serializes the migration-apply critical section across instances.
 *
 * Under a multi-instance deploy (e.g. PM2 cluster x4, or N rolling
 * pods), every worker boots and races to apply the same pending
 * migrations. While each apply is individually safe (single-txn for
 * normal migrations, idempotent IF [NOT] EXISTS for CONCURRENTLY ones),
 * concurrent appliers still cause avoidable lock contention, duplicate
 * work, and noisy "already recorded by concurrent runner" churn. A
 * single session advisory lock makes exactly one instance apply at a
 * time; the others block on the lock, then wake to find the ledger
 * already advanced and no-op through the `pending` filter.
 *
 * `pg_advisory_lock(bigint)` takes one 64-bit key. The constant below is
 * an arbitrary fixed value unique to Festie's migration runner; it must
 * never change once deployed (changing it would let an old and a new
 * runner hold two different locks and apply concurrently). Chosen to be
 * obviously app-specific and unlikely to collide with any other
 * advisory-lock user in the same database.
 *
 * Passed to pg as a decimal string (not a JS BigInt) so node-postgres
 * serializes it unambiguously; Postgres coerces the text to bigint. The
 * value 5063544977519632205 fits in a signed 64-bit integer.
 */
const MIGRATION_ADVISORY_LOCK_KEY = '5063544977519632205'; // 0x4645535449455f4d — "FEST"/"IE_M", Festie migrations

// Filenames we accept: NNN_name.sql or NNNb_name.sql (the `b` suffix
// exists because 019_expense_categories.sql and 019_reminder_index.sql
// collided; we keep the runner tolerant rather than brittle).
const MIGRATION_FILE_RE = /^(\d{3,4})([a-z])?_.*\.sql$/i;

/**
 * In-memory guard: each Postgres URL we've already migrated in this
 * process. Keeps test suites from re-running migrations on every
 * `openPlannerDatabase()` call, and also ensures the startup WARN logs
 * only once per boot per database (task requirement).
 */
const MIGRATED_URLS: Map<string, Promise<any>> = new Map();

/**
 * Discover migration files on disk, sorted by (version, suffix).
 */
function discoverMigrationsOnDisk() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const entries: any[] = [];
  for (const file of fs.readdirSync(MIGRATIONS_DIR)) {
    const m = MIGRATION_FILE_RE.exec(file);
    if (!m) continue;
    const version = parseInt(m[1]!, 10);
    const suffix = (m[2] || '').toLowerCase();
    entries.push({
      version,
      suffix,
      // Stable sort key: zero-pad the numeric part so lexicographic
      // order === chronological order even if the repo ever introduces
      // a 4-digit version.
      sortKey: `${String(version).padStart(5, '0')}${suffix}`,
      file,
      fullPath: path.join(MIGRATIONS_DIR, file),
    });
  }
  entries.sort((a: any, b: any) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  return entries;
}

/**
 * Ensure `schema_migrations` exists. Uses the legacy integer-PK schema
 * observed in the live audit (version INTEGER PRIMARY KEY, name TEXT,
 * applied_at TIMESTAMPTZ). If the richer phase-3-6 schema (text PK,
 * checksum, duration_ms, applied_by) is already in place we do NOT
 * clobber it — `CREATE TABLE IF NOT EXISTS` + additive `ALTER TABLE
 * ADD COLUMN IF NOT EXISTS` keeps both variants working.
 */
async function ensureSchemaMigrationsTable(client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT '',
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Legacy databases may have the table without the `name` column; add
  // it additively. Safe no-op on new installs.
  await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''");
  await client.query(
    'ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ NOT NULL DEFAULT now()',
  );
}

/**
 * Read the integer `version` column from `schema_migrations`.
 */
async function loadAppliedVersions(client: any) {
  const res = await client.query('SELECT version FROM schema_migrations');
  const out = new Set<number>();
  for (const row of res.rows) {
    // Column is INTEGER in live; be defensive against the text-PK
    // variant (strip any trailing suffix letter).
    const raw =
      typeof row.version === 'number' ? row.version : parseInt(String(row.version).replace(/[a-z]$/i, ''), 10);
    if (Number.isFinite(raw)) out.add(raw);
  }
  return out;
}

/**
 * Apply one migration + record it in a SINGLE transaction. Any error
 * from either the SQL body or the bookkeeping INSERT rolls the whole
 * thing back and is re-thrown with a clear message including the
 * filename, version, and underlying psql error message.
 */
async function applyOneMigration(client: any, migration: any, log: any) {
  const { version, file, fullPath } = migration;
  let sql: string;
  try {
    sql = fs.readFileSync(fullPath, 'utf8');
  } catch (readErr: any) {
    throw new Error(`migration read failed for ${file} (version ${version}): ${readErr.message}`, { cause: readErr });
  }

  const cleaned = stripOuterTxBoundaries(sql);
  const started = Date.now();
  log('info', 'applying migration', { version, file });

  try {
    // CONCURRENTLY migrations (CREATE/DROP INDEX CONCURRENTLY) cannot run
    // inside a transaction block, and a multi-statement query is wrapped in
    // an implicit one — so run each statement separately in autocommit. No
    // atomic rollback is possible here; these migrations are written
    // idempotently (IF [NOT] EXISTS / guarded DO blocks). See lib/db/sql-split.ts.
    if (usesConcurrently(cleaned)) {
      const alreadyConc = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (alreadyConc.rowCount > 0) {
        log('info', 'migration already recorded; skipping', { version, file });
        return false;
      }
      for (const statement of splitSqlStatements(cleaned)) {
        await client.query(statement);
      }
      // Some CONCURRENTLY migrations self-record their row; ON CONFLICT keeps
      // this bookkeeping INSERT a harmless no-op in that case.
      await client.query(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, now()) ON CONFLICT (version) DO NOTHING',
        [version, file],
      );
      const durationConc = Date.now() - started;
      log('info', 'migration applied (non-transactional / CONCURRENTLY)', { version, file, durationMs: durationConc });
      return true;
    }

    await client.query('BEGIN');

    // Double-check inside the txn — another process may have applied
    // this version between our pre-scan and now. If so, silently skip
    // (commit empty txn) rather than crash on PK conflict.
    const already = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
    if (already.rowCount > 0) {
      await client.query('COMMIT');
      log('info', 'migration already recorded by concurrent runner; skipping', {
        version,
        file,
      });
      return false;
    }

    // Apply the migration body. Postgres accepts multi-statement scripts
    // via a single query call.
    await client.query(cleaned);

    // Record the row in the SAME transaction. ON CONFLICT DO NOTHING so a
    // migration that self-records its own row (some do) doesn't cause a PK
    // collision that rolls the whole apply back.
    await client.query(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, now()) ON CONFLICT (version) DO NOTHING',
      [version, file],
    );

    await client.query('COMMIT');
    const durationMs = Date.now() - started;
    log('info', 'migration applied', { version, file, durationMs });
    return true;
  } catch (err: any) {
    // Best-effort rollback; swallow rollback errors so we always surface
    // the original failure.
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    const durationMs = Date.now() - started;
    const psqlMsg = err && err.message ? err.message : String(err);
    log('error', 'MIGRATION FAILED — rolled back', {
      version,
      file,
      durationMs,
      error: psqlMsg,
    });
    const wrapped: any = new Error(`migration ${file} (version ${version}) failed: ${psqlMsg}`);
    wrapped.cause = err;
    wrapped.migrationVersion = version;
    wrapped.migrationFile = file;
    throw wrapped;
  }
}

/**
 * Strip an outermost `BEGIN;` / `COMMIT;` pair from a migration file
 * (Postgres dumps sometimes include them and we're already running
 * inside a transaction, which makes the inner BEGIN a warning/error
 * depending on version). Inner BEGIN blocks (inside PL/pgSQL bodies)
 * are untouched because they're preceded by `DO $$` or similar.
 *
 * Mirrors the SQLite-variant helper in lib/migrate.js so behaviour is
 * consistent across both runners.
 */
function stripOuterTxBoundaries(sql: string) {
  if (!sql || typeof sql !== 'string') return sql;
  let out = sql;
  out = out.replace(/^(\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*)BEGIN(?:\s+TRANSACTION)?\s*;\s*/i, '$1');
  out = out.replace(/;?\s*COMMIT\s*;?\s*(?:(?:--[^\n]*|\/\*[\s\S]*?\*\/)\s*)*$/i, ';');
  return out;
}

/**
 * Module-level flag: once migrations complete successfully for ANY pool
 * in this process, skip all subsequent calls. In PM2 cluster mode each
 * worker only needs to check once; the expensive schema_migrations
 * queries (CREATE TABLE, ALTER TABLE, SELECT version) were the top 3
 * queries by total time because they ran on every process restart.
 * The flag is set AFTER successful completion so a failure still allows
 * a retry on the next call.
 */
let _migrationsRan = false;

/**
 * Run pending migrations against the given pg pool. Exposed as a named
 * export so tests can exercise it directly without going through
 * `openPlannerDatabase`.
 */
async function runPostgresMigrations(pool: any, opts: any = {}) {
  if (_migrationsRan) return { applied: [], current: 0, gap: [] };
  const log = opts.log || (() => {});
  const client = await pool.connect();
  try {
    // ── Cross-instance serialization ────────────────────────────────────
    // Acquire a session advisory lock on THIS client before touching the
    // ledger. Under a multi-instance deploy, N workers boot at once and
    // race to apply the same pending migrations. The lock makes exactly
    // one instance apply at a time; the others block here, then wake once
    // the holder releases and find the ledger already advanced — the
    // `pending` filter below comes back empty and they no-op.
    //
    // The lock is held on the session (client), so it covers both the
    // transactional apply path and the autocommit CONCURRENTLY path. It
    // is released in the inner `finally` (always on the same client),
    // then the client is returned to the pool in the outer `finally`.
    //
    // Single-instance behaviour is unchanged: with no contender, the lock
    // is granted immediately and released at the end of this call.
    log('info', 'acquiring migration advisory lock', { key: String(MIGRATION_ADVISORY_LOCK_KEY) });
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
    log('info', 'migration advisory lock acquired', { key: String(MIGRATION_ADVISORY_LOCK_KEY) });
    try {
      await ensureSchemaMigrationsTable(client);
      const applied = await loadAppliedVersions(client);
      const onDisk = discoverMigrationsOnDisk();

      if (onDisk.length === 0) {
        const current = applied.size ? Math.max(...applied) : 0;
        log('info', 'no migrations on disk', { current, totalApplied: applied.size });
        return { applied: [], current, gap: [] };
      }

      const pending = onDisk.filter((m: any) => !applied.has(m.version));
      const appliedVersions: number[] = [];

      for (const migration of pending) {
        const didApply = await applyOneMigration(client, migration, log);
        if (didApply) appliedVersions.push(migration.version);
      }

      // Startup gap check — runs every time but only logs WARN if there
      // is actual drift (disk > recorded). The caller de-dupes via
      // MIGRATED_URLS so the WARN fires at most once per boot.
      const finalApplied = await loadAppliedVersions(client);
      const diskVersions = new Set(onDisk.map((m: any) => m.version));
      const gap = [...diskVersions].filter((v) => !finalApplied.has(v)).sort((a, b) => a - b);
      if (gap.length > 0) {
        log('warn', 'schema_migrations has recorded-row gaps vs migrations/ on disk', {
          diskCount: diskVersions.size,
          recordedCount: finalApplied.size,
          missingVersions: gap,
          hint: 'Backfill via scripts/backfill-schema-migrations.sql; see docs/plans/schema-migration-reconciliation-2026-04.md',
        });
      } else {
        log('info', 'schema_migrations consistent with migrations/ on disk', {
          diskCount: diskVersions.size,
          recordedCount: finalApplied.size,
        });
      }

      const current = finalApplied.size ? Math.max(...finalApplied) : 0;
      log('info', 'migrations complete', {
        applied: appliedVersions.length,
        current,
        totalRecorded: finalApplied.size,
      });
      const result = { applied: appliedVersions, current, gap };
      _migrationsRan = true; // eslint-disable-line require-atomic-updates
      return result;
    } finally {
      // Always release the advisory lock on the SAME client that acquired
      // it, before that client is returned to the pool. Best-effort: a
      // failed unlock must not mask an in-flight apply error, and the lock
      // is in any case auto-released when the session ends.
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
        log('info', 'migration advisory lock released', { key: String(MIGRATION_ADVISORY_LOCK_KEY) });
      } catch (unlockErr: any) {
        log('warn', 'failed to release migration advisory lock (will auto-release on session end)', {
          key: String(MIGRATION_ADVISORY_LOCK_KEY),
          error: unlockErr && unlockErr.message,
        });
      }
    }
  } finally {
    client.release();
  }
}

/**
 * Wrap `openPlannerDatabase` from `./db/index` so that the first call
 * per-process-per-URL triggers the migration runner, while subsequent
 * calls return immediately. The returned object shape is identical to
 * the underlying `openPlannerDatabase` — at minimum `{ pool }`. The
 * migration work happens asynchronously in the background; the
 * underlying caller (`lib/app-context.js`) awaits pool readiness via
 * its own queries, so a slow migration on boot doesn't block startup
 * of non-DB services. Any migration error is logged loudly and
 * re-thrown on the returned `migrationsReady` promise so callers who
 * want to gate on it can `await result.migrationsReady`.
 *
 * Signature + return shape for the existing `{ pool }` contract are
 * UNCHANGED. We only ADD a `migrationsReady` promise as a non-breaking
 * extension.
 */
function openPlannerDatabase(opts: any = {}) {
  const result = openPlannerDatabaseRaw(opts);
  const pool = result && result.pool;
  const databaseUrl = opts.databaseUrl || process.env.DATABASE_URL || '';
  const log = typeof opts.log === 'function' ? opts.log : () => {};

  if (!pool) {
    // Upstream did something unexpected; preserve its return value and
    // don't try to run migrations against a missing pool.
    return result;
  }

  // Only run the migration pipeline (and the startup WARN) once per
  // database URL per process. The task explicitly requires "only logs
  // once per boot (not on every request)".
  // Skip in test mode: test harnesses (tests/*.test.js) load migrations via
  // their own ensureTestSchema() and truncate between tests. Running the
  // startup runner against a test DB re-applies migrations that aren't
  // recorded in schema_migrations and breaks NOT-NULL constraints mid-suite.
  const isTestEnv =
    process.env.NODE_ENV === 'test' || (typeof databaseUrl === 'string' && /_test(\?|$)/.test(databaseUrl));
  if (isTestEnv) {
    return Object.assign(result, {
      migrationsReady: Promise.resolve({ applied: [], current: 0, gap: [] }),
    });
  }

  let migrationsReady = MIGRATED_URLS.get(databaseUrl);
  if (!migrationsReady) {
    migrationsReady = runPostgresMigrations(pool, { log }).catch((err: any) => {
      MIGRATED_URLS.delete(databaseUrl);
      log('error', 'migration runner aborted startup', {
        error: err && err.message,
        version: err && err.migrationVersion,
        file: err && err.migrationFile,
      });
      // Re-throw so awaiting callers see the failure; but do NOT call
      // process.exit here — that's the host app's policy decision.
      throw err;
    });
    migrationsReady.catch(() => {});
    MIGRATED_URLS.set(databaseUrl, migrationsReady);
  }

  // Preserve every existing key on the upstream result object, and add
  // our promise. Using Object.assign rather than spread to keep hidden
  // (non-enumerable) properties attached by pg intact.
  return Object.assign(result, { migrationsReady });
}

// ── Test helpers (not exported) ──────────────────────────────────────────

/**
 * INTERNAL: reset the per-URL migration cache. Exposed as a symbol so
 * the test harness can opt-in without polluting the public API. Not
 * used in production code.
 */
const __resetMigrationCacheForTests = () => {
  MIGRATED_URLS.clear();
  _migrationsRan = false;
};

// ── Public API ───────────────────────────────────────────────────────────
// Re-export everything from ./db/index unchanged, substituting our
// wrapped openPlannerDatabase. All other exports are passed through
// verbatim — no behaviour change for non-migration paths.

export {
  createStores,
  createDbLatencyTracker,
  openPlannerDatabase,
  parseJsonObject,
  serializeJson,
  withTransaction,
  // Newly exposed for tests / ops tooling (non-breaking additions):
  runPostgresMigrations,
  discoverMigrationsOnDisk,
  stripOuterTxBoundaries,
  __resetMigrationCacheForTests,
};
