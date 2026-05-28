import 'dotenv/config';
/**
 * Shared setup for integration-*.test.ts files (split from tests/integration.test.js).
 * Behavior must remain byte-identical to the original integration.test.js helpers.
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { Pool } from 'pg';

import { createFestivalPlanner } from '../server';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_PASSWORD = 'password123';
const TRUSTED_MUTATION_HEADER = 'x-festie-request';
const AVATAR_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z/CfAQgwgImBgaEBAAriA/1oCbcnAAAAAElFTkSuQmCC',
  'base64'
);

// SAFETY: Only use TEST_DATABASE_URL — never fall back to DATABASE_URL to protect production data
const TEST_DATABASE_URL: string = process.env.TEST_DATABASE_URL!;
if (!TEST_DATABASE_URL) { console.error('ERROR: TEST_DATABASE_URL env var required. Set it in .env. (Never falls back to DATABASE_URL to protect production data.)'); process.exit(1); }
if (!TEST_DATABASE_URL.includes('_test')) { console.error('SAFETY: TEST_DATABASE_URL must contain "_test" in the database name to prevent accidental production wipe.'); process.exit(1); }

let testDbReady = false;

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
          sets: [
            { id: 'set-d', artist: 'Delta', stageId: 'forest', startTime: '14:00', endTime: '15:00' },
          ],
        },
      ],
      createdAt: '2026-03-09T00:00:00.000Z',
      updatedAt: '2026-03-09T00:00:00.000Z',
    },
  ];
}

// Ensure test schema exists (run once per test suite)
async function ensureTestSchema() {
  if (testDbReady) return;
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    // Check if schema already exists by looking for the users table
    const { rows } = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'users' LIMIT 1");
    if (rows.length === 0) {
      await pool.query('CREATE EXTENSION IF NOT EXISTS citext');
      const schemaPath = path.join(__dirname, '..', 'migrations', '004_postgresql_baseline.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schema);
    }
    // Apply incremental migrations (005+) idempotently
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter((f: string) => f.endsWith('.sql') && !f.startsWith('004_'))
      .sort();
    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql).catch(() => {}); // Idempotent — IF NOT EXISTS used in all migrations
    }
    testDbReady = true;
  } finally {
    await pool.end();
  }
}

// Truncate all data tables (fast — ~5ms vs ~500ms for CREATE DATABASE)
async function truncateAllTables(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`
      TRUNCATE TABLE
        email_verification_tokens, password_reset_tokens,
        audit_log, notification_topic_subs, notification_counts, notification_log,
        notification_preferences, device_tokens,
        crew_members, crews, festival_profile_notes,
        festival_profile_picks, festival_profiles, festival_sets, festival_days,
        festival_stages, festivals, user_sessions, users,
        install_events, set_ratings, calendar_tokens,
        crew_expenses, crew_polls, crew_poll_votes,
        crew_meeting_points, crew_activity
      CASCADE
    `);
  } finally {
    await pool.end();
  }
}

async function seedTestData(databaseUrl: string, festivals: any[] = createFestivalFixture()) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const festival of festivals) {
      await pool.query(
        'INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
        [festival.id, festival.name, festival.location, festival.createdAt || new Date().toISOString(), festival.updatedAt || new Date().toISOString()]
      );
      for (let si = 0; si < (festival.stages || []).length; si++) {
        const stage = festival.stages[si];
        await pool.query(
          'INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, $3, $4, $5)',
          [festival.id, stage.id, stage.name, stage.color, si]
        );
      }
      for (let di = 0; di < (festival.days || []).length; di++) {
        const day = festival.days[di];
        await pool.query(
          'INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, $2, $3, $4)',
          [festival.id, di, day.label, day.date]
        );
        for (let sei = 0; sei < (day.sets || []).length; sei++) {
          const set = day.sets[sei];
          await pool.query(
            'INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [set.id, festival.id, di, set.artist, set.stageId, set.startTime, set.endTime, sei]
          );
        }
      }
    }
  } finally {
    await pool.end();
  }
}

async function startServer(overrides: Record<string, any> = {}) {
  await ensureTestSchema();
  await truncateAllTables(TEST_DATABASE_URL as string);
  await seedTestData(TEST_DATABASE_URL as string);

  const planner = await createFestivalPlanner({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR,
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
    ...overrides,
  });

  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  const address = planner.server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    databaseUrl: TEST_DATABASE_URL as string,
    planner,
    request: request(planner.app),
    async close() {
      await planner.close();
    },
  };
}

async function registerUser(server: any, username: string, password: string = DEFAULT_PASSWORD) {
  const response = await server.request
    .post('/api/v1/auth/register')
    .send({ username, password, confirmPassword: password, tosAccepted: true })
    .expect(201);
  return response.body.data;
}

async function loginUser(server: any, username: string, password: string = DEFAULT_PASSWORD) {
  const response = await server.request
    .post('/api/v1/auth/login')
    .send({ username, password })
    .expect(200);
  return response.body.data;
}

async function joinFestivalProfile(server: any, userToken: string, festivalId: string = 'fest-1') {
  const response = await server.request
    .post('/api/v1/profiles')
    .set('x-user-token', userToken)
    .send({ festivalId })
    .expect(200);
  return response.body.data;
}

async function loginAdmin(server: any) {
  const adminUsername = 'testadmin-' + Date.now();
  await server.request
    .post('/api/v1/auth/register')
    .send({ username: adminUsername, password: 'test-admin-password', confirmPassword: 'test-admin-password', tosAccepted: true })
    .expect(201);

  // Grant admin role via DB
  const pool = new Pool({ connectionString: server.databaseUrl, statement_timeout: 5000 });
  try {
    await pool.query(
      'INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) SELECT u.id, r.id, NULL, NOW() FROM users u, roles r WHERE u.username = $1 AND r.name = $2 ON CONFLICT (user_id, role_id) DO NOTHING',
      [adminUsername, 'admin']
    );
  } finally {
    await pool.end();
  }

  // Login as admin user
  const loginRes = await server.request
    .post('/api/v1/auth/login')
    .send({ username: adminUsername, password: 'test-admin-password' })
    .expect(200);
  return loginRes.body.data.token;
}

function waitForEvent(emitter: any, event: string, predicate: (payload: any) => boolean = () => true, timeoutMs: number = 4_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function handler(payload: any) {
      if (!predicate(payload)) return;
      cleanup();
      resolve(payload);
    }

    function cleanup() {
      clearTimeout(timeout);
      emitter.off(event, handler);
    }

    emitter.on(event, handler);
  });
}

function connectSocket(baseUrl: string, options: Record<string, any> = {}): Socket {
  return createSocketClient(baseUrl, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    ...options,
  });
}

function markTrustedMutation(requestBuilder: any) {
  return requestBuilder.set(TRUSTED_MUTATION_HEADER, '1');
}

async function uploadAvatar(server: any, token: string) {
  const res = await server.request
    .post("/api/v1/account/avatar")
    .set("x-user-token", token)
    .attach("avatar", AVATAR_FIXTURE, { filename: "avatar.png", contentType: "image/png" })
    .expect(200);
  return res.body.data;
}

export {
  // constants
  PUBLIC_DIR,
  DEFAULT_PASSWORD,
  TRUSTED_MUTATION_HEADER,
  AVATAR_FIXTURE,
  TEST_DATABASE_URL,
  // deps re-exported so split files can mirror original imports
  assert,
  request,
  Pool,
  createFestivalPlanner,
  // fixtures + setup
  createFestivalFixture,
  ensureTestSchema,
  truncateAllTables,
  seedTestData,
  startServer,
  // auth + profile helpers
  registerUser,
  loginUser,
  joinFestivalProfile,
  loginAdmin,
  uploadAvatar,
  // socket + request helpers
  waitForEvent,
  connectSocket,
  markTrustedMutation,
};
