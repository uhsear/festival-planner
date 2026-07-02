import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { test as base, expect } from '@playwright/test';
import { Pool } from 'pg';

import { createFestivalPlanner } from '../../server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'test-admin-password';
const DEFAULT_PASSWORD = 'Str0ngTest!Pw';

// The functional E2E server is Postgres-backed (Festie has no JSON data layer —
// see lib/app-context). The e2e-web.yml CI job provides a `festie_test` database
// via the postgres service and runs the migrations before Playwright starts, so
// the schema already exists here; we connect with the SAME DATABASE_URL the
// in-process server resolves, then TRUNCATE + seed a deterministic two-festival
// fixture (mirrors tests/_integration-helpers.ts). The fixture data — fest-1
// "Test Fest" (Alpha/Beta/Gamma/Delta) and fest-2 "Campfire Fest" (Omega) — is
// what every assertion in festival-planner.spec.ts reads back through the SPA.
function createFestivalFixture() {
  return [
    {
      id: 'fest-1',
      name: 'Test Fest',
      location: 'Test Grounds',
      stages: [
        { id: 'main', name: 'Main Stage', color: '#ff3366' },
        { id: 'forest', name: 'Forest Stage', color: '#00e8d0' },
      ],
      days: [
        {
          label: 'Friday',
          date: '2026-06-05',
          sets: [
            { id: 'set-a', artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' },
            { id: 'set-b', artist: 'Beta', stageId: 'forest', startTime: '10:30', endTime: '11:30' },
            { id: 'set-c', artist: 'Gamma', stageId: 'main', startTime: '12:00', endTime: '13:00' },
          ],
        },
        {
          label: 'Saturday',
          date: '2026-06-06',
          sets: [{ id: 'set-d', artist: 'Delta', stageId: 'forest', startTime: '14:00', endTime: '15:00' }],
        },
      ],
      createdAt: '2026-03-09T00:00:00.000Z',
      updatedAt: '2026-03-09T00:00:00.000Z',
    },
    {
      id: 'fest-2',
      name: 'Campfire Fest',
      location: 'Lakeside',
      stages: [{ id: 'ember', name: 'Ember Stage', color: '#ff8c00' }],
      days: [
        {
          label: 'Sunday',
          date: '2026-06-07',
          sets: [{ id: 'set-o', artist: 'Omega', stageId: 'ember', startTime: '16:00', endTime: '17:00' }],
        },
      ],
      createdAt: '2026-03-09T00:00:00.000Z',
      updatedAt: '2026-03-09T00:00:00.000Z',
    },
  ];
}

// Resolve the database the in-process server will use. Prefer the same env the
// CI server step + migration step use (DATABASE_URL). A SAFETY guard refuses to
// truncate anything that isn't an obvious test database so this can never wipe a
// real environment if someone runs the suite locally with prod creds in .env.
function resolveTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || '';
  if (!url) {
    throw new Error(
      'festival-planner E2E requires DATABASE_URL (a Postgres test DB). CI provides one via the postgres service.',
    );
  }
  if (!/_test|festie_test|localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(
      'SAFETY: refusing to seed/truncate — DATABASE_URL does not look like a test database (expected "_test"/localhost). ' +
        'Point DATABASE_URL at a disposable Postgres test DB.',
    );
  }
  return url;
}

async function truncateAllTables(pool: InstanceType<typeof Pool>) {
  // CASCADE drops dependent rows (profiles/picks/crews/etc.) so each test run
  // starts from a clean slate. Wrapped in a try so a missing table (older
  // schema) doesn't abort the whole run.
  await pool.query(`
    TRUNCATE TABLE
      festival_profile_notes, festival_profile_picks, festival_profiles,
      festival_sets, festival_days, festival_stages, festivals,
      crew_members, crews,
      user_sessions, users
    RESTART IDENTITY CASCADE
  `);
}

async function seedFestivals(pool: InstanceType<typeof Pool>, festivals = createFestivalFixture()) {
  for (const festival of festivals) {
    await pool.query(
      'INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
      [festival.id, festival.name, festival.location, festival.createdAt, festival.updatedAt],
    );
    for (let si = 0; si < festival.stages.length; si++) {
      const stage = festival.stages[si]!;
      await pool.query(
        'INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, $3, $4, $5)',
        [festival.id, stage.id, stage.name, stage.color, si],
      );
    }
    for (let di = 0; di < festival.days.length; di++) {
      const day = festival.days[di]!;
      await pool.query('INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, $2, $3, $4)', [
        festival.id,
        di,
        day.label,
        day.date,
      ]);
      for (let sei = 0; sei < day.sets.length; sei++) {
        const set = day.sets[sei]!;
        await pool.query(
          'INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [set.id, festival.id, di, set.artist, set.stageId, set.startTime, set.endTime, sei],
        );
      }
    }
  }
}

async function startServer() {
  const databaseUrl = resolveTestDatabaseUrl();

  // Seed BEFORE the server boots so the very first GET /festivals (fired by the
  // SPA's useFestivalLoader on page load) already sees the fixture.
  const seedPool = new Pool({ connectionString: databaseUrl });
  try {
    await truncateAllTables(seedPool);
    await seedFestivals(seedPool);
  } finally {
    await seedPool.end();
  }

  const planner = await createFestivalPlanner({
    ADMIN_USER,
    ADMIN_PASSWORD,
    DATABASE_URL: databaseUrl,
    PUBLIC_DIR,
    NODE_ENV: 'test',
    // Redis is optional for the functional suite; disable so a missing/locked
    // Redis can't fail server boot (presence/rate-limit fall back to memory).
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
  });

  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  const address = planner.server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    databaseUrl,
    planner,
    async close() {
      await planner.close();
    },
  };
}

// Sanity-check that the React SPA build exists where routes/pages.ts looks for
// it. Without it the server serves the public/ fallback stub (empty #root) and
// every test would mysteriously time out waiting for #app. Surfacing this as a
// clear error beats a wall of unexplained timeouts.
function assertSpaBuilt() {
  const reactIndex = path.join(PUBLIC_DIR, '..', 'packages', 'web', 'dist', 'index.html');
  if (!fs.existsSync(reactIndex)) {
    throw new Error(
      `React SPA build missing at ${reactIndex}. Run \`pnpm --filter @festie/web build\` before the E2E suite ` +
        '(the e2e-web.yml CI job does this in the "Build web frontend" step).',
    );
  }
}

export const test = base.extend<{ app: Awaited<ReturnType<typeof startServer>> }>({
  app: async ({}, use) => {
    assertSpaBuilt();
    const app = await startServer();
    await use(app);
    await app.close();
  },
  // The first-run onboarding modal (Onboarding.tsx, aria-modal) overlays the
  // whole page and intercepts every pointer event, timing out any test that
  // clicks the app. Pre-mark it completed so specs exercise the real flows;
  // onboarding itself gets dedicated coverage by clearing this key.
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('festie_onboarding_completed', 'true');
      } catch {
        /* storage unavailable — onboarding will just show */
      }
    });
    await use(page);
  },
});

export { expect, ADMIN_USER, ADMIN_PASSWORD, DEFAULT_PASSWORD };
