// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
//
// Production migration runner (P13).
//
// Applies every `migrations/*.sql` file that is NOT yet recorded in the
// `schema_migrations` tracking table, in filename order, each inside its own
// transaction. Prints a plan before doing anything.
//
// Usage:
//   node scripts/migrate.mjs            apply all unapplied migrations
//   node scripts/migrate.mjs --dry-run  print the plan, change nothing
//   node scripts/migrate.mjs --baseline record ALL current files as applied
//                                        WITHOUT executing them (first prod run)
//
// Connection: reads DATABASE_URL from the environment (same var the app uses,
// see lib/config.ts). The app's migrations are written to be additive +
// idempotent, but this runner still tracks them so we know what the live DB is
// on and never re-runs a recorded file.
//
// IMPORTANT — first production run MUST be `--baseline`:
//   On a long-lived prod DB every existing migration is "unapplied" by this
//   table's reckoning but is ALREADY present in the schema. Running them blind
//   would re-execute 52 files. They are idempotent, but baselining is the
//   correct, auditable path: it records every current file as applied without
//   touching the schema, so only genuinely-new migrations run thereafter.
//   See docs/runbooks/deploy.md.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const BASELINE = args.has('--baseline');

if (DRY_RUN && BASELINE) {
  console.error('Error: --dry-run and --baseline are mutually exclusive.');
  process.exit(2);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is required.');
  process.exit(2);
}

async function listMigrationFiles() {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

const CREATE_TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

async function main() {
  const allFiles = await listMigrationFiles();

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    // The tracking table itself is created outside the per-migration loop so a
    // fresh DB can record migrations. CREATE TABLE IF NOT EXISTS is safe to run
    // even on --dry-run (it's a no-op once the table exists), but to keep
    // --dry-run truly side-effect-free we only create it when actually working.
    if (!DRY_RUN) {
      await client.query(CREATE_TRACKING_TABLE);
    }

    let applied = new Set();
    try {
      const { rows } = await client.query('SELECT filename FROM schema_migrations');
      applied = new Set(rows.map((r) => r.filename));
    } catch (err) {
      // Table doesn't exist yet (dry-run on a never-migrated DB) — treat all as
      // unapplied so the plan is accurate.
      if (err && err.code === '42P01') {
        applied = new Set();
      } else {
        throw err;
      }
    }

    const pending = allFiles.filter((f) => !applied.has(f));

    // ---- Plan ----
    console.log(`Migration runner — ${MIGRATIONS_DIR}`);
    console.log(`  total files:      ${allFiles.length}`);
    console.log(`  already applied:  ${applied.size}`);
    console.log(`  pending:          ${pending.length}`);
    if (BASELINE) console.log('  mode:             BASELINE (record only, no SQL executed)');
    else if (DRY_RUN) console.log('  mode:             DRY RUN (no changes)');
    else console.log('  mode:             APPLY');
    console.log('');

    if (pending.length === 0) {
      console.log('Nothing to do — schema is up to date.');
      return;
    }

    console.log('Plan:');
    for (const f of pending) console.log(`  - ${f}`);
    console.log('');

    if (DRY_RUN) {
      console.log('Dry run — no migrations applied.');
      return;
    }

    if (BASELINE) {
      // Record every pending file as applied WITHOUT executing its SQL. One
      // transaction for the whole batch — it's pure bookkeeping.
      await client.query('BEGIN');
      try {
        for (const f of pending) {
          await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
            [f],
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      console.log(`Baselined ${pending.length} migration(s) — recorded as applied, no SQL executed.`);
      return;
    }

    // ---- Apply ----
    for (const f of pending) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, f), 'utf8');
      process.stdout.write(`Applying ${f} ... `);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
          [f],
        );
        await client.query('COMMIT');
        console.log('ok');
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        console.error(`\nMigration ${f} failed and was rolled back:\n${err.message}`);
        throw err;
      }
    }

    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
