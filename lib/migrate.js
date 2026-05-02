// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * Run pending migrations in order (legacy — not used by the live PostgreSQL app).
 * PostgreSQL schema management is handled by openPlannerDatabase() in lib/planner-db-pg.js.
 * This file is retained for use by scripts/migrate-sqlite-to-pg.js only.
 *
 * Hardening (2026-04-14 audit fix):
 *   - Each migration is applied inside its OWN transaction alongside the
 *     INSERT INTO schema_migrations row, so either BOTH land or NEITHER does.
 *     This prevents schema_migrations from drifting out of sync with the DB
 *     when the SQL succeeds but the bookkeeping INSERT fails (or vice versa).
 *   - Before each migration we re-check `SELECT 1 FROM schema_migrations
 *     WHERE version = ?` to guarantee we never double-apply, even if the
 *     pre-scan missed a row (e.g. concurrent runner).
 *   - On ANY failure we log loudly with the filename + error AND call
 *     process.exit(1) so deploy pipelines abort instead of marching on to
 *     the next migration with a broken schema.
 *   - On success we log version + name + duration.
 *   - If a migration file already contains its own BEGIN/COMMIT (some
 *     Postgres dumps do), we detect and strip the outermost pair so we
 *     don't nest transactions. better-sqlite3 refuses nested BEGIN.
 *
 * @param {object} db - better-sqlite3 Database instance
 * @param {object} [opts]
 * @param {Function} [opts.log] - Logger function (receives level, message, meta)
 * @param {boolean} [opts.exitOnError=true] - Call process.exit(1) on failure
 * @returns {{ applied: number[], current: number }}
 */
function runMigrations(db, opts = {}) {
  const log = opts.log || (() => {});
  const exitOnError = opts.exitOnError !== false;

  // Ensure the tracking table exists (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      applied_at TEXT NOT NULL
    );
  `);

  // Upgrade legacy table that may lack the 'name' column
  const cols = db.prepare('PRAGMA table_info(schema_migrations)').all();
  if (!cols.some((c) => c.name === 'name')) {
    db.exec("ALTER TABLE schema_migrations ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }

  // Read already-applied versions (pre-scan)
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all()
      .map((row) => row.version),
  );

  // Discover migration files
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
    return { applied: [], current: applied.size ? Math.max(...applied) : 0 };
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3,4}_.*\.sql$/.test(f))
    .sort();

  const pending = [];
  for (const file of files) {
    const version = parseInt(file.split('_')[0], 10);
    if (!applied.has(version)) {
      pending.push({ version, file });
    }
  }

  if (pending.length === 0) {
    const current = applied.size ? Math.max(...applied) : 0;
    log('info', 'migrations up to date', { current, totalApplied: applied.size });
    return { applied: [], current };
  }

  // Prepared statements reused across pending migrations
  const checkStmt = db.prepare('SELECT 1 AS ok FROM schema_migrations WHERE version = ?');
  const insertStmt = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  const appliedVersions = [];

  for (const { version, file } of pending) {
    // Re-check right before applying — guards against races and missed pre-scan rows
    const already = checkStmt.get(version);
    if (already && already.ok) {
      log('info', 'skipping already-applied migration', { version, file });
      continue;
    }

    const fullPath = path.join(MIGRATIONS_DIR, file);
    let sql;
    try {
      sql = fs.readFileSync(fullPath, 'utf8');
    } catch (err) {
      log('error', 'failed to read migration file', { version, file, error: err.message });
      if (exitOnError) process.exit(1);
      throw err;
    }

    // If the migration already wraps itself in BEGIN/COMMIT, strip the
    // outermost pair. SQLite (and `db.transaction()`) cannot nest.
    // Equivalent in spirit to psql --single-transaction where the outer
    // runner owns the transaction boundary.
    const cleaned = stripOuterTxBoundaries(sql);

    const started = Date.now();

    // SINGLE TRANSACTION: apply SQL + INSERT schema_migrations row atomically.
    // better-sqlite3's db.transaction() handles BEGIN/COMMIT/ROLLBACK for us —
    // if the callback throws, the entire thing rolls back.
    const applyOne = db.transaction(() => {
      db.exec(cleaned);
      insertStmt.run(version, file, new Date().toISOString());
    });

    try {
      log('info', 'applying migration', { version, file });
      applyOne();
      const durationMs = Date.now() - started;
      appliedVersions.push(version);
      log('info', 'migration applied', { version, name: file, durationMs });
    } catch (err) {
      const durationMs = Date.now() - started;
      // Log LOUDLY — migration failures are deploy-blocking.
      log('error', 'MIGRATION FAILED — rolling back and aborting', {
        version,
        file,
        durationMs,
        error: err && err.message,
        stack: err && err.stack,
      });
      if (exitOnError) {
        // Abort the deploy pipeline. Do NOT continue to the next migration.
        process.exit(1);
      }
      throw err;
    }
  }

  const current = Math.max(...[...applied, ...appliedVersions, 0]);
  log('info', 'migrations complete', { applied: appliedVersions.length, current });
  return { applied: appliedVersions, current };
}

/**
 * Remove an outermost BEGIN ... COMMIT pair from a SQL script, if present.
 * Leaves inner SAVEPOINT/BEGIN (inside PL/pgSQL bodies) alone by only
 * stripping the first leading BEGIN; and final trailing COMMIT.
 * Case-insensitive, tolerant of whitespace and trailing semicolons.
 *
 * @param {string} sql
 * @returns {string}
 */
function stripOuterTxBoundaries(sql) {
  if (!sql || typeof sql !== 'string') return sql;
  let out = sql;

  // Strip a leading `BEGIN;` or `BEGIN TRANSACTION;` (optionally preceded by
  // comments / blank lines).
  out = out.replace(
    /^(\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*)BEGIN(?:\s+TRANSACTION)?\s*;\s*/i,
    '$1',
  );

  // Strip a trailing `COMMIT;` (optionally followed by comments / whitespace).
  out = out.replace(
    /;?\s*COMMIT\s*;?\s*(?:(?:--[^\n]*|\/\*[\s\S]*?\*\/)\s*)*$/i,
    ';',
  );

  return out;
}

/**
 * Get the current SQLite schema version (legacy).
 * @param {object} db - better-sqlite3 Database instance
 * @returns {number}
 */
function getCurrentVersion(db) {
  try {
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
    return row?.v || 0;
  } catch {
    return 0;
  }
}

module.exports = { runMigrations, getCurrentVersion };
