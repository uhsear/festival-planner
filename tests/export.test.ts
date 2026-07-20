import 'dotenv/config';
/**
 * Integration tests for export routes (routes/export.js).
 * Covers: HTML export, ICS export, calendar JSON API, picks-card PNG, auth gating,
 *         rate-limit cooldown (SSE/429 fallback trigger).
 *
 * Skip-gate on TEST_DATABASE_URL. DELETE BY EXACT ID on teardown.
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { after, afterEach, describe, test, mock } from 'node:test';
import request from 'supertest';
import express from 'express';
import { Pool } from 'pg';
import { createFestivalPlanner } from '../server';
import { serializeExportCrewProfile } from '../lib/helpers/export-utils.js';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DB skip-gate: these integration tests require a live Postgres database.
// Set TEST_DATABASE_URL to run them (always set in CI). See tests/README.md.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TRUSTED_MUTATION_HEADER = 'x-festie-request';
const DEFAULT_PASSWORD = 'Str0ngTest!Pw';

// Unique timestamped IDs — prevents collision across parallel test runs.
const RUN_ID = `ex${Date.now().toString(36)}`;
const FEST_ID = `fest-${RUN_ID}`;
const STAGE_MAIN = `main-${RUN_ID}`;
const STAGE_FOREST = `forest-${RUN_ID}`;
const SET_A = `set-a-${RUN_ID}`;
const SET_B = `set-b-${RUN_ID}`;

function fixtureFestival() {
  return {
    id: FEST_ID,
    name: 'Export Test Fest',
    location: 'Testville',
    stages: [
      { id: STAGE_MAIN, name: 'Main Stage', color: '#ff3366' },
      { id: STAGE_FOREST, name: 'Forest', color: '#00e8d0' },
    ],
    days: [
      {
        label: 'Friday',
        date: '2026-06-05',
        sets: [
          { id: SET_A, artist: 'Alpha', stageId: STAGE_MAIN, startTime: '10:00', endTime: '11:00' },
          { id: SET_B, artist: 'Beta', stageId: STAGE_FOREST, startTime: '12:00', endTime: '13:00' },
        ],
      },
    ],
  };
}

async function seedFestival(pool: any) {
  const f = fixtureFestival();
  await pool.query(
    `INSERT INTO festivals (id, name, location, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [f.id, f.name, f.location]
  );
  for (let i = 0; i < f.stages.length; i++) {
    const s = f.stages[i]!;
    await pool.query(
      `INSERT INTO festival_stages (festival_id, id, name, color, sort_order)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [f.id, s.id, s.name, s.color, i]
    );
  }
  for (let di = 0; di < f.days.length; di++) {
    const d = f.days[di]!;
    await pool.query(
      `INSERT INTO festival_days (festival_id, day_index, label, date)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [f.id, di, d.label, d.date]
    );
    for (let si = 0; si < d.sets.length; si++) {
      const s = d.sets[si]!;
      await pool.query(
        `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [s.id, f.id, di, s.artist, s.stageId, s.startTime, s.endTime, si]
      );
    }
  }
}

async function cleanupById(pool: any) {
  // DELETE BY EXACT ID — never truncate, never wipe unrelated data.
  await pool.query(`DELETE FROM festival_profile_picks WHERE profile_id IN (SELECT id FROM festival_profiles WHERE festival_id = $1)`, [FEST_ID]);
  await pool.query(`DELETE FROM festival_profiles WHERE festival_id = $1`, [FEST_ID]);
  await pool.query(`DELETE FROM festival_sets WHERE festival_id = $1`, [FEST_ID]);
  await pool.query(`DELETE FROM festival_days WHERE festival_id = $1`, [FEST_ID]);
  await pool.query(`DELETE FROM festival_stages WHERE festival_id = $1`, [FEST_ID]);
  await pool.query(`DELETE FROM festivals WHERE id = $1`, [FEST_ID]);
  // Child tables referencing users (FK changed to RESTRICT in migration 031)
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [`export-${RUN_ID}%`]);
  await pool.query(`DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [`export-${RUN_ID}%`]);
  await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`export-${RUN_ID}%`]);
}

async function startServer() {
  if (!createFestivalPlanner) return;
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await seedFestival(pool);
  } finally {
    await pool.end();
  }
  const planner = await (createFestivalPlanner as any)({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR: fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : path.join(__dirname, '..'),
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
    EXPORT_COOLDOWN_MS: 10, // tight cooldown so back-to-back tests don't 429
  });
  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  return {
    planner,
    request: request(planner.app),
    async close() { await planner.close(); },
  };
}

async function registerUser(server: any, suffix: any) {
  const username = `export-${RUN_ID}-${suffix}`;
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true })
    .expect(201);
  return res.body.data;
}

async function joinFestival(server: any, userToken: any) {
  const res = await server.request
    .post('/api/v1/profiles')
    .set('x-user-token', userToken)
    .send({ festivalId: FEST_ID })
    .expect(200);
  return res.body.data;
}

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try { await s.close(); } catch (_) { /* best-effort */ }
  }
});

after(async () => {
  if (skip) return;
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try { await cleanupById(pool); } finally { await pool.end(); }
});

describe('export routes', { skip, concurrency: 1 }, () => {
  test('HTML export returns text/html with DOCTYPE', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const user = await registerUser(server, 'html');
    const profile = await joinFestival(server, user.token!);

    const res = await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}`)
      .set('x-user-token', user.token!)
      .expect(200);

    assert.match(res.headers['content-type']!, /text\/html/);
    assert.match(res.text, /<!DOCTYPE html>/i);
    assert.match(res.headers['content-disposition'] || '', /attachment/);
  });

  test('HTML export sets strict security headers (CSP, nosniff, frame DENY)', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const user = await registerUser(server, 'headers');
    const profile = await joinFestival(server, user.token!);

    const res = await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}`)
      .set('x-user-token', user.token!)
      .expect(200);

    assert.ok(res.headers['content-security-policy'], 'CSP header required');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
  });

  test('ICS export returns RFC-5545-compliant VCALENDAR with picked sets', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const user = await registerUser(server, 'ics');
    const profile = await joinFestival(server, user.token!);

    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token!)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { [SET_A]: 'must' } })
      .expect(200);

    const res = await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}/calendar`)
      .set('x-user-token', user.token!)
      .expect(200);

    assert.match(res.headers['content-type']!, /text\/calendar/);
    assert.match(res.text, /^BEGIN:VCALENDAR/);
    assert.match(res.text, /VERSION:2\.0/);
    assert.match(res.text, /PRODID:-\/\/FestivalPlanner\/\/EN/);
    assert.match(res.text, /BEGIN:VEVENT/);
    assert.match(res.text, /SUMMARY:Alpha/);
    assert.match(res.text, /END:VEVENT/);
    assert.match(res.text, /END:VCALENDAR$/);
    // RFC 5545: lines use CRLF
    assert.ok(res.text.includes('\r\n'), 'ICS must use CRLF line endings');
  });

  test('ICS export with no picks still produces valid empty VCALENDAR', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const user = await registerUser(server, 'icsempty');
    const profile = await joinFestival(server, user.token!);

    const res = await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}/calendar`)
      .set('x-user-token', user.token!)
      .expect(200);

    assert.match(res.text, /BEGIN:VCALENDAR/);
    assert.match(res.text, /END:VCALENDAR/);
    assert.ok(!res.text.includes('BEGIN:VEVENT'), 'no picks → no VEVENT blocks');
  });

  test('calendar JSON API returns envelope {data, error:null} with events array', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const user = await registerUser(server, 'json');
    const profile = await joinFestival(server, user.token!);

    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token!)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { [SET_A]: 'must', [SET_B]: 'want-to-see' } })
      .expect(200);

    const res = await server.request
      .get(`/api/v1/festivals/${FEST_ID}/calendar`)
      .set('x-user-token', user.token!)
      .expect(200);

    // Envelope shape
    assert.ok(res.body.data, 'envelope has data');
    assert.equal(res.body.error ?? null, null, 'envelope error is null');
    assert.equal(res.body.data.festival.id, FEST_ID);
    assert.ok(Array.isArray(res.body.data.events));
    assert.equal(res.body.data.events.length, 2);
    const evt = res.body.data.events.find((e: any) => e.id === SET_A);
    assert.ok(evt);
    assert.equal(evt.priority, 'must');
    // Internal fields must not leak
    assert.equal(evt.user_id, undefined);
    assert.equal(evt.deleted_at, undefined);
  });

  test('export requires auth — unauth returns 401 for HTML, ICS, calendar JSON', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);

    await server.request.get(`/api/v1/export/${FEST_ID}/anyprof`).expect(401);
    await server.request.get(`/api/v1/export/${FEST_ID}/anyprof/calendar`).expect(401);
    await server.request.get(`/api/v1/festivals/${FEST_ID}/calendar`).expect(401);
  });

  test('export rejects cross-user profile access with 403', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const owner = await registerUser(server, 'owner');
    const intruder = await registerUser(server, 'intruder');
    const profile = await joinFestival(server, owner.token!);

    await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}`)
      .set('x-user-token', intruder.token!)
      .expect(403);
  });

  test('export returns 404 for unknown festival or profile', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const user = await registerUser(server, 'nf');

    await server.request
      .get(`/api/v1/export/does-not-exist-${RUN_ID}/prof-x`)
      .set('x-user-token', user.token!)
      .expect(404);

    await server.request
      .get(`/api/v1/export/${FEST_ID}/prof-does-not-exist`)
      .set('x-user-token', user.token!)
      .expect(404);
  });

  test('rate-limit cooldown: second HTML export within window returns 429 (SSE-style fallback trigger)', async () => {
    if (!createFestivalPlanner) return;
    // Use a long cooldown so the second call is definitively rate-limited.
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try { await seedFestival(pool); } finally { await pool.end(); }
    const planner = await (createFestivalPlanner as any)({
      DATABASE_URL: TEST_DATABASE_URL,
      PUBLIC_DIR: fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : path.join(__dirname, '..'),
      NODE_ENV: 'test',
      REDIS_ENABLED: 'false',
      PUBLIC_ORIGIN: '',
      EXPORT_COOLDOWN_MS: 60_000,
    });
    await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
    const server = { planner, request: request(planner.app), close: () => planner.close() };
    servers.push(server);

    const user = await registerUser(server, 'cooldown');
    const profile = await joinFestival(server, user.token!);

    await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}`)
      .set('x-user-token', user.token!)
      .expect(200);

    const res = await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}`)
      .set('x-user-token', user.token!)
      .expect(429);

    assert.ok(res.body.error, '429 returns error envelope');
  });
});

// Finding #6: Crew Schedules must be scoped to the exporter's actual crew
// members, not every profile ever created for the festival. Mocked-deps route
// test (no live DB) — drives routes/export.js directly so the crew-vs-
// festival-wide scoping is provable without a live Postgres instance.
describe('GET /export/:festivalId/:profileId — crew scoping (Finding #6)', () => {
  function makeExportDeps(overrides: any = {}) {
    return {
      express,
      log: { info() {}, warn() {}, error() {}, debug() {} },
      config: {
        PUBLIC_DIR: __dirname, // no export-template.html here -> falls back to the built-in template
        MAX_CONCURRENT_EXPORTS: -1, // POOL_SIZE=-1 -> pool init loop never runs -> deterministic inline export path
        EXPORT_COOLDOWN_MS: 0,
      },
      userAuth: (req: any, _res: any, next: any) => {
        req.user = { userId: 'user-1' };
        next();
      },
      setNoStore: () => {},
      getFestivalById: mock.fn(async (id: any) =>
        id === 'f1'
          ? {
              id: 'f1',
              name: 'Scope Test Fest',
              location: 'TN',
              stages: [{ id: 'st1', name: 'Main Stage', color: '#ff3366' }],
              days: [
                {
                  date: '2026-06-10',
                  label: 'Day 1',
                  sets: [{ id: 's1', artist: 'DJ Test', stageId: 'st1', startTime: '14:00', endTime: '15:00' }],
                },
              ],
            }
          : null,
      ),
      getProfiles: mock.fn(async () => []),
      getUserFestivalProfile: mock.fn(async () => null),
      getUserById: mock.fn(async (id: any) => ({ id, username: 'exporter' })),
      serializeOwnProfile: (profile: any, user: any) => ({ ...profile, username: user?.username }),
      // Real fn, not a stub — a stub that strips `picks` would hide the leak this test proves.
      serializeExportCrewProfile,
      sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
      sendError: (res: any, status: any, msg: any, code: any) =>
        res.status(status).json({ data: null, error: { message: msg, status, code } }),
      ErrorCodes: {
        INVALID_INPUT: 'INVALID_INPUT',
        NOT_FOUND: 'NOT_FOUND',
        FORBIDDEN: 'FORBIDDEN',
        RATE_LIMITED: 'RATE_LIMITED',
        INTERNAL_ERROR: 'INTERNAL_ERROR',
      },
      sanitizeIdentifier: (s: any) => (s ? String(s).trim() : null),
      rateLimit: () => (_req: any, _res: any, next: any) => next(),
      schemas: { festivalIdParams: {} },
      validateParams: () => (req: any, _res: any, next: any) => {
        req.validatedParams = req.params;
        next();
      },
      exportContentSecurityPolicy: "default-src 'self'",
      encodeContentDispositionFilename: (f: any) => encodeURIComponent(f),
      stores: {
        profiles: {
          getById: mock.fn(async (id: any) =>
            id === 'p1'
              ? { id: 'p1', userId: 'user-1', festivalId: 'f1', name: 'MyProfile', picks: { s1: 'must' }, notes: {} }
              : null,
          ),
          // Festival-wide store: still contains a totally unrelated stranger (user-999)
          // who also joined f1 and picked set s1 — this is what the bug leaks.
          getByFestival: mock.fn(async (fid: any) =>
            fid === 'f1'
              ? [
                  { id: 'p1', userId: 'user-1', festivalId: 'f1', name: 'MyProfile', picks: { s1: 'must' }, notes: {} },
                  { id: 'p2', userId: 'user-999', festivalId: 'f1', name: 'StrangerName', picks: { s1: 'want-to-see' }, notes: {} },
                ]
              : [],
          ),
        },
        crews: {
          // Exporting user (user-1) belongs to NO crew for festival f1.
          listByUserAndFestival: mock.fn(async () => []),
          getMembersForCrews: mock.fn(async () => new Map()),
        },
      },
      ...overrides,
    };
  }

  test("only shows actual crew members, not every festival profile", async () => {
    const { default: createExportRoutes } = await import('../routes/export.js');
    const deps = makeExportDeps();
    const router = createExportRoutes(deps);
    const app = express();
    app.use(router);

    const res = await request(app).get('/export/f1/p1').expect(200);
    assert.ok(!res.text.includes('StrangerName'), "export leaked a non-crewmate's name into the Crew Schedules section");
    assert.ok(res.text.includes('DJ Test'), "sanity: the exporter's own picks must still render");
  });
});
