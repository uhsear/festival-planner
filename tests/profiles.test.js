require('dotenv').config();
/**
 * Profiles Route Tests (Agent 5)
 * Covers: join-festival flow, pick set priority transitions,
 *         ETag optimistic concurrency (If-Match → 409),
 *         admin soft-delete of profiles.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { afterEach, describe, test } = require('node:test');
const request = require('supertest');
const { Pool } = require('pg');
const { createFestivalPlanner } = require('../server');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_PASSWORD = 'password123';
const TRUSTED_MUTATION_HEADER = 'x-festie-request';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  console.error('ERROR: TEST_DATABASE_URL env var required. Set it in .env.');
  process.exit(1);
}
if (!TEST_DATABASE_URL.includes('_test')) {
  console.error('SAFETY: TEST_DATABASE_URL must contain "_test" in the database name.');
  process.exit(1);
}

let testDbReady = false;

// Unique fixture per run so we can DELETE BY EXACT ID
const RUN_ID = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
function makeFestivalFixture() {
  const festId = `fest-prof-${RUN_ID}`;
  return {
    id: festId,
    name: 'Profiles Test Fest',
    location: 'TestLand',
    stages: [
      { id: `stg-main-${RUN_ID}`, name: 'Main', color: '#ff3366' },
      { id: `stg-forest-${RUN_ID}`, name: 'Forest', color: '#00e8d0' },
    ],
    days: [
      {
        label: 'Friday',
        date: '2026-06-05',
        sets: [
          { id: `set-a-${RUN_ID}`, artist: 'Alpha', stageId: `stg-main-${RUN_ID}`, startTime: '10:00', endTime: '11:00' },
          { id: `set-b-${RUN_ID}`, artist: 'Beta', stageId: `stg-forest-${RUN_ID}`, startTime: '10:30', endTime: '11:30' },
          { id: `set-c-${RUN_ID}`, artist: 'Gamma', stageId: `stg-main-${RUN_ID}`, startTime: '12:00', endTime: '13:00' },
        ],
      },
    ],
  };
}

async function ensureTestSchema() {
  if (testDbReady) return;
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    const { rows } = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'users' LIMIT 1"
    );
    if (rows.length === 0) {
      await pool.query('CREATE EXTENSION IF NOT EXISTS citext');
      const schema = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', '004_postgresql_baseline.sql'),
        'utf8'
      );
      await pool.query(schema);
    }
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql') && !f.startsWith('004_'))
      .sort();
    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql).catch(() => {});
    }
    testDbReady = true;
  } finally {
    await pool.end();
  }
}

async function seedFestival(festival) {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await pool.query(
      'INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT (id) DO NOTHING',
      [festival.id, festival.name, festival.location]
    );
    for (let si = 0; si < festival.stages.length; si++) {
      const st = festival.stages[si];
      await pool.query(
        'INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [festival.id, st.id, st.name, st.color, si]
      );
    }
    for (let di = 0; di < festival.days.length; di++) {
      const day = festival.days[di];
      await pool.query(
        'INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [festival.id, di, day.label, day.date]
      );
      for (let sei = 0; sei < day.sets.length; sei++) {
        const s = day.sets[sei];
        await pool.query(
          'INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
          [s.id, festival.id, di, s.artist, s.stageId, s.startTime, s.endTime, sei]
        );
      }
    }
  } finally {
    await pool.end();
  }
}

const createdUserIds = [];
const createdFestivalIds = new Set();

async function cleanupCreated() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    if (createdUserIds.length > 0) {
      await pool.query(
        'DELETE FROM festival_profile_picks WHERE profile_id IN (SELECT id FROM festival_profiles WHERE user_id = ANY($1))',
        [createdUserIds]
      );
      await pool.query('DELETE FROM festival_profiles WHERE user_id = ANY($1)', [createdUserIds]);
      await pool.query('DELETE FROM user_sessions WHERE user_id = ANY($1)', [createdUserIds]);
      await pool.query('DELETE FROM user_roles WHERE user_id = ANY($1)', [createdUserIds]);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
    }
    for (const fid of createdFestivalIds) {
      // Delete BY EXACT ID
      await pool.query('DELETE FROM festival_sets WHERE festival_id = $1', [fid]);
      await pool.query('DELETE FROM festival_days WHERE festival_id = $1', [fid]);
      await pool.query('DELETE FROM festival_stages WHERE festival_id = $1', [fid]);
      await pool.query('DELETE FROM festivals WHERE id = $1', [fid]);
    }
  } finally {
    await pool.end();
    createdUserIds.length = 0;
    createdFestivalIds.clear();
  }
}

async function startServer(overrides = {}) {
  await ensureTestSchema();
  const festival = makeFestivalFixture();
  await seedFestival(festival);
  createdFestivalIds.add(festival.id);

  const planner = await createFestivalPlanner({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR,
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
    AUTH_RATE_LIMIT_MAX: 1000,
    ...overrides,
  });
  return {
    planner,
    festival,
    request: request(planner.app),
    async close() {
      if (typeof planner.close === 'function') await planner.close();
      else if (planner.server) await new Promise(r => planner.server.close(r));
    },
  };
}

async function registerUser(server, username, password = DEFAULT_PASSWORD) {
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password, confirmPassword: password, tosAccepted: true });
  assert.ok(res.status === 201 || res.status === 200, `register failed: ${res.status}`);
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
    if (rows.length) createdUserIds.push(rows[0].id);
  } finally {
    await pool.end();
  }
  return res.body.data;
}

async function joinFestival(server, token, festivalId) {
  const res = await server.request
    .post('/api/v1/profiles')
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ festivalId });
  assert.equal(res.status, 200, `join failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function grantAdminTo(username) {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
       SELECT u.id, r.id, NULL, NOW()
         FROM users u, roles r
        WHERE u.username = $1 AND r.name = 'admin'
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [username]
    );
  } finally {
    await pool.end();
  }
}

const servers = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try { await s.close(); } catch (_) { /* noop */ }
  }
  await cleanupCreated();
});

// ──────────────────────────────────────────────────────────────────────────
// Join festival
// ──────────────────────────────────────────────────────────────────────────

describe('profiles: join festival', { concurrency: 1 }, () => {
  test('requires authentication', async () => {
    const server = await startServer();
    servers.push(server);
    const res = await server.request
      .post('/api/v1/profiles')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ festivalId: server.festival.id });
    assert.equal(res.status, 401);
  });

  test('returns 404 for unknown festival', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, `pj-unknown-${Date.now()}`);
    const res = await server.request
      .post('/api/v1/profiles')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ festivalId: 'does-not-exist-zzz' });
    assert.equal(res.status, 404);
  });

  test('creates new profile on first join', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, `pj-new-${Date.now()}`);
    const profile = await joinFestival(server, user.token, server.festival.id);
    assert.ok(profile.id);
    assert.equal(profile.festivalId, server.festival.id);
  });

  test('returns existing profile on repeated join (idempotent)', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, `pj-idem-${Date.now()}`);
    const a = await joinFestival(server, user.token, server.festival.id);
    const b = await joinFestival(server, user.token, server.festival.id);
    assert.equal(a.id, b.id);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Pick priority transitions
// ──────────────────────────────────────────────────────────────────────────

describe('profiles: pick priority transitions', { concurrency: 1 }, () => {
  test('sets a pick to "must"', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, `pk-must-${Date.now()}`);
    const profile = await joinFestival(server, user.token, server.festival.id);
    const setId = server.festival.days[0].sets[0].id;

    const res = await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { [setId]: 'must' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.picks[setId], 'must');
  });

  test('transitions pick must → maybe → removed', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, `pk-trans-${Date.now()}`);
    const profile = await joinFestival(server, user.token, server.festival.id);
    const setId = server.festival.days[0].sets[1].id;

    const url = `/api/v1/profiles/${profile.id}`;

    const r1 = await server.request.put(url)
      .set('x-user-token', user.token).set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { [setId]: 'must' } });
    assert.equal(r1.body.data.picks[setId], 'must');

    const r2 = await server.request.put(url)
      .set('x-user-token', user.token).set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { [setId]: 'maybe' } });
    assert.equal(r2.body.data.picks[setId], 'maybe');

    const r3 = await server.request.put(url)
      .set('x-user-token', user.token).set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: {} });
    assert.ok(!r3.body.data.picks || !r3.body.data.picks[setId]);
  });

  test('rejects pick for unknown set id with 400', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, `pk-bad-${Date.now()}`);
    const profile = await joinFestival(server, user.token, server.festival.id);

    const res = await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-doesnt-exist': 'must' } });
    assert.equal(res.status, 400);
  });

  test('rejects updates to other users profiles with 403', async () => {
    const server = await startServer();
    servers.push(server);
    const ts = Date.now();
    const userA = await registerUser(server, `pk-a-${ts}`);
    const userB = await registerUser(server, `pk-b-${ts}`);
    const profileA = await joinFestival(server, userA.token, server.festival.id);
    await joinFestival(server, userB.token, server.festival.id);

    const res = await server.request
      .put(`/api/v1/profiles/${profileA.id}`)
      .set('x-user-token', userB.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { [server.festival.days[0].sets[0].id]: 'must' } });
    assert.equal(res.status, 403);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// ETag optimistic concurrency
// ──────────────────────────────────────────────────────────────────────────

describe('profiles: ETag optimistic concurrency', { concurrency: 1 }, () => {
  test('successful update returns an ETag header', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, `etag-hdr-${Date.now()}`);
    const profile = await joinFestival(server, user.token, server.festival.id);

    const res = await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { [server.festival.days[0].sets[0].id]: 'must' } });
    assert.equal(res.status, 200);
    // ETag is set when updatedAt is populated
    assert.ok(res.headers.etag || res.headers.ETag, 'expected ETag header on successful update');
  });

  test('If-Match with wrong etag returns 409 (version mismatch)', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, `etag-bad-${Date.now()}`);
    const profile = await joinFestival(server, user.token, server.festival.id);

    // First update establishes updatedAt
    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { [server.festival.days[0].sets[0].id]: 'must' } })
      .expect(200);

    // Now try with an obviously wrong If-Match
    const conflict = await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .set('If-Match', '"1970-01-01T00:00:00.000Z"')
      .send({ picks: { [server.festival.days[0].sets[1].id]: 'maybe' } });
    // Route sends 409 with VERSION_MISMATCH
    assert.equal(conflict.status, 409);
  });

  test('If-Match with correct etag succeeds', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, `etag-ok-${Date.now()}`);
    const profile = await joinFestival(server, user.token, server.festival.id);

    const first = await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { [server.festival.days[0].sets[0].id]: 'must' } });
    assert.equal(first.status, 200);
    const etag = first.headers.etag || first.headers.ETag;
    assert.ok(etag);

    const second = await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .set('If-Match', etag)
      .send({ picks: { [server.festival.days[0].sets[1].id]: 'maybe' } });
    assert.equal(second.status, 200);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Admin profile delete (soft-delete)
// ──────────────────────────────────────────────────────────────────────────

describe('profiles: admin soft-delete', { concurrency: 1 }, () => {
  test('non-admin cannot delete a profile', async () => {
    const server = await startServer();
    servers.push(server);
    const ts = Date.now();
    const user = await registerUser(server, `sd-user-${ts}`);
    const profile = await joinFestival(server, user.token, server.festival.id);

    const res = await server.request
      .delete(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1');
    assert.equal(res.status, 403);
  });

  test('admin can soft-delete a profile', async () => {
    const server = await startServer();
    servers.push(server);
    const ts = Date.now();
    const user = await registerUser(server, `sd-owner-${ts}`);
    const adminName = `sd-admin-${ts}`;
    const admin = await registerUser(server, adminName, 'test-admin-password-pass');
    await grantAdminTo(adminName);

    // Re-login admin after role grant (some codepaths cache token claims)
    const loginRes = await server.request
      .post('/api/v1/auth/login')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: adminName, password: 'test-admin-password-pass' });
    const adminToken = loginRes.body.data?.token || admin.token;

    const profile = await joinFestival(server, user.token, server.festival.id);

    const res = await server.request
      .delete(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1');
    assert.equal(res.status, 200);
    assert.equal(res.body.data?.success, true);
  });

  test('admin delete on unknown profile returns 404', async () => {
    const server = await startServer();
    servers.push(server);
    const ts = Date.now();
    const adminName = `sd-admin2-${ts}`;
    const admin = await registerUser(server, adminName, 'test-admin-password-pass');
    await grantAdminTo(adminName);
    const loginRes = await server.request
      .post('/api/v1/auth/login')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: adminName, password: 'test-admin-password-pass' });
    const adminToken = loginRes.body.data?.token || admin.token;

    const res = await server.request
      .delete('/api/v1/profiles/prof-nonexistent-zzz')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1');
    assert.equal(res.status, 404);
  });
});
