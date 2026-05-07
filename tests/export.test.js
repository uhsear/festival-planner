require('dotenv').config();
/**
 * Integration tests for export routes (routes/export.js).
 * Covers: HTML export, ICS export, calendar JSON API, picks-card PNG, auth gating,
 *         rate-limit cooldown (SSE/429 fallback trigger).
 *
 * Skip-gate on TEST_DATABASE_URL. DELETE BY EXACT ID on teardown.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { after, afterEach, before, describe, test } = require('node:test');
const request = require('supertest');
const { Pool } = require('pg');

// DB skip-gate: these integration tests require a live Postgres database.
// Set TEST_DATABASE_URL to run them (always set in CI). See tests/README.md.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

// Guard require so the test file still loads in environments without the app installed.
let createFestivalPlanner = null;
if (!skip) {
  try {
    ({ createFestivalPlanner } = require('../server'));
  } catch (err) {
    // Leave createFestivalPlanner null — individual tests will skip.
  }
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TRUSTED_MUTATION_HEADER = 'x-festie-request';
const DEFAULT_PASSWORD = 'password123';

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

async function seedFestival(pool) {
  const f = fixtureFestival();
  await pool.query(
    `INSERT INTO festivals (id, name, location, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [f.id, f.name, f.location]
  );
  for (let i = 0; i < f.stages.length; i++) {
    const s = f.stages[i];
    await pool.query(
      `INSERT INTO festival_stages (festival_id, id, name, color, sort_order)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [f.id, s.id, s.name, s.color, i]
    );
  }
  for (let di = 0; di < f.days.length; di++) {
    const d = f.days[di];
    await pool.query(
      `INSERT INTO festival_days (festival_id, day_index, label, date)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [f.id, di, d.label, d.date]
    );
    for (let si = 0; si < d.sets.length; si++) {
      const s = d.sets[si];
      await pool.query(
        `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [s.id, f.id, di, s.artist, s.stageId, s.startTime, s.endTime, si]
      );
    }
  }
}

async function cleanupById(pool) {
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
  if (!createFestivalPlanner) throw new Error('server module unavailable');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await seedFestival(pool);
  } finally {
    await pool.end();
  }
  const planner = createFestivalPlanner({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR: fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : path.join(__dirname, '..'),
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
    EXPORT_COOLDOWN_MS: 10, // tight cooldown so back-to-back tests don't 429
  });
  await new Promise((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  return {
    planner,
    request: request(planner.app),
    async close() { await planner.close(); },
  };
}

async function registerUser(server, suffix) {
  const username = `export-${RUN_ID}-${suffix}`;
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, tosAccepted: true })
    .expect(201);
  return res.body.data;
}

async function joinFestival(server, userToken) {
  const res = await server.request
    .post('/api/v1/profiles')
    .set('x-user-token', userToken)
    .send({ festivalId: FEST_ID })
    .expect(200);
  return res.body.data;
}

const servers = [];
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
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'html');
    const profile = await joinFestival(server, user.token);

    const res = await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}`)
      .set('x-user-token', user.token)
      .expect(200);

    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /<!DOCTYPE html>/i);
    assert.match(res.headers['content-disposition'] || '', /attachment/);
  });

  test('HTML export sets strict security headers (CSP, nosniff, frame DENY)', async () => {
    if (!createFestivalPlanner) return;
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'headers');
    const profile = await joinFestival(server, user.token);

    const res = await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}`)
      .set('x-user-token', user.token)
      .expect(200);

    assert.ok(res.headers['content-security-policy'], 'CSP header required');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
  });

  test('ICS export returns RFC-5545-compliant VCALENDAR with picked sets', async () => {
    if (!createFestivalPlanner) return;
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'ics');
    const profile = await joinFestival(server, user.token);

    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { [SET_A]: 'must' } })
      .expect(200);

    const res = await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}/calendar`)
      .set('x-user-token', user.token)
      .expect(200);

    assert.match(res.headers['content-type'], /text\/calendar/);
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
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'icsempty');
    const profile = await joinFestival(server, user.token);

    const res = await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}/calendar`)
      .set('x-user-token', user.token)
      .expect(200);

    assert.match(res.text, /BEGIN:VCALENDAR/);
    assert.match(res.text, /END:VCALENDAR/);
    assert.ok(!res.text.includes('BEGIN:VEVENT'), 'no picks → no VEVENT blocks');
  });

  test('calendar JSON API returns envelope {data, error:null} with events array', async () => {
    if (!createFestivalPlanner) return;
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'json');
    const profile = await joinFestival(server, user.token);

    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { [SET_A]: 'must', [SET_B]: 'want-to-see' } })
      .expect(200);

    const res = await server.request
      .get(`/api/v1/festivals/${FEST_ID}/calendar`)
      .set('x-user-token', user.token)
      .expect(200);

    // Envelope shape
    assert.ok(res.body.data, 'envelope has data');
    assert.equal(res.body.error ?? null, null, 'envelope error is null');
    assert.equal(res.body.data.festival.id, FEST_ID);
    assert.ok(Array.isArray(res.body.data.events));
    assert.equal(res.body.data.events.length, 2);
    const evt = res.body.data.events.find((e) => e.id === SET_A);
    assert.ok(evt);
    assert.equal(evt.priority, 'must');
    // Internal fields must not leak
    assert.equal(evt.user_id, undefined);
    assert.equal(evt.deleted_at, undefined);
  });

  test('export requires auth — unauth returns 401 for HTML, ICS, calendar JSON', async () => {
    if (!createFestivalPlanner) return;
    const server = await startServer();
    servers.push(server);

    await server.request.get(`/api/v1/export/${FEST_ID}/anyprof`).expect(401);
    await server.request.get(`/api/v1/export/${FEST_ID}/anyprof/calendar`).expect(401);
    await server.request.get(`/api/v1/festivals/${FEST_ID}/calendar`).expect(401);
  });

  test('export rejects cross-user profile access with 403', async () => {
    if (!createFestivalPlanner) return;
    const server = await startServer();
    servers.push(server);
    const owner = await registerUser(server, 'owner');
    const intruder = await registerUser(server, 'intruder');
    const profile = await joinFestival(server, owner.token);

    await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}`)
      .set('x-user-token', intruder.token)
      .expect(403);
  });

  test('export returns 404 for unknown festival or profile', async () => {
    if (!createFestivalPlanner) return;
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'nf');

    await server.request
      .get(`/api/v1/export/does-not-exist-${RUN_ID}/prof-x`)
      .set('x-user-token', user.token)
      .expect(404);

    await server.request
      .get(`/api/v1/export/${FEST_ID}/prof-does-not-exist`)
      .set('x-user-token', user.token)
      .expect(404);
  });

  test('rate-limit cooldown: second HTML export within window returns 429 (SSE-style fallback trigger)', async () => {
    if (!createFestivalPlanner) return;
    // Use a long cooldown so the second call is definitively rate-limited.
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try { await seedFestival(pool); } finally { await pool.end(); }
    const planner = createFestivalPlanner({
      DATABASE_URL: TEST_DATABASE_URL,
      PUBLIC_DIR: fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : path.join(__dirname, '..'),
      NODE_ENV: 'test',
      REDIS_ENABLED: 'false',
      PUBLIC_ORIGIN: '',
      EXPORT_COOLDOWN_MS: 60_000,
    });
    await new Promise((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
    const server = { planner, request: request(planner.app), close: () => planner.close() };
    servers.push(server);

    const user = await registerUser(server, 'cooldown');
    const profile = await joinFestival(server, user.token);

    await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}`)
      .set('x-user-token', user.token)
      .expect(200);

    const res = await server.request
      .get(`/api/v1/export/${FEST_ID}/${profile.id}`)
      .set('x-user-token', user.token)
      .expect(429);

    assert.ok(res.body.error, '429 returns error envelope');
  });
});
