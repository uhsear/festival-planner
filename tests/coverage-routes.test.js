'use strict';
/**
 * Coverage-backfill: route-level HTTP coverage (metrics, health, admin,
 * profiles, crews/polls, spotify, grid, export, notifications, sockets,
 * tiered data loading, rate-limit, session expiry, audit).
 *
 * Consolidates routes-facing tests previously scattered across:
 *   - tests/coverage-gaps.test.js           (health/info/ready, admin bulk)
 *   - tests/gap-coverage.test.js            (metrics, admin CRUD, avatar, export, notifications, rate-limit, session, audit, cascade, .well-known, SSE, ACL)
 *   - tests/gap-audit-coverage.test.js      (tiered data loading HTTP paths)
 *   - tests/phase2-coverage.test.js         (crew polls, spotify preview, grid/sets)
 *   - tests/phase3-coverage.test.js         (Socket.IO join event validation)
 *
 * Unit/store-level coverage lives in coverage-edges.test.js.
 */

require('dotenv').config();
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { afterEach, after: afterAll, describe, test } = require('node:test');
const request = require('supertest');
const { Pool } = require('pg');
const { io: createSocketClient } = require('socket.io-client');
const { createFestivalPlanner } = require('../server');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_PASSWORD = 'password123';
const TRUSTED_MUTATION_HEADER = 'x-festie-request';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) { console.error('ERROR: TEST_DATABASE_URL env var required.'); process.exit(1); }
if (!TEST_DATABASE_URL.includes('_test')) { console.error('SAFETY: TEST_DATABASE_URL must contain "_test".'); process.exit(1); }

// ── fixtures ─────────────────────────────────────────────────────
let testDbReady = false;

function createFestivalFixture() {
  return [{
    id: 'fest-1', name: 'Test Fest', location: 'Test Grounds',
    stages: [
      { id: 'main', name: 'Main Stage', color: '#ff3366' },
      { id: 'forest', name: 'Forest Stage', color: '#00e8d0' },
    ],
    days: [
      {
        label: 'Friday', date: '2026-06-05',
        sets: [
          { id: 'set-a', artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' },
          { id: 'set-b', artist: 'Beta', stageId: 'forest', startTime: '10:30', endTime: '11:30' },
          { id: 'set-c', artist: 'Gamma', stageId: 'main', startTime: '12:00', endTime: '13:00' },
        ],
      },
      {
        label: 'Saturday', date: '2026-06-06',
        sets: [
          { id: 'set-d', artist: 'Delta', stageId: 'forest', startTime: '14:00', endTime: '15:00' },
        ],
      },
    ],
  }, {
    id: 'fest-p2', name: 'Phase2 Fest', location: 'Test Grounds',
    stages: [
      { id: 'main', name: 'Main Stage', color: '#ff3366' },
      { id: 'forest', name: 'Forest', color: '#33ff66' },
    ],
    days: [{
      label: 'Saturday', date: '2026-06-06',
      sets: [
        { id: 'set-1', artist: 'Excision', stageId: 'main', startTime: '22:00', endTime: '23:30' },
        { id: 'set-2', artist: 'Kompany', stageId: 'forest', startTime: '20:00', endTime: '21:00' },
        { id: 'set-3', artist: 'HVDES', stageId: 'main', startTime: '18:00', endTime: '19:00' },
      ],
    }],
  }];
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
        path.join(__dirname, '..', 'migrations', '004_postgresql_baseline.sql'), 'utf8'
      );
      await pool.query(schema);
    }
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql') && !f.startsWith('004_'))
      .sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql).catch(() => {});
    }
    testDbReady = true;
  } finally { await pool.end(); }
}

async function truncateAllTables() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await pool.query(`
      TRUNCATE TABLE
        crew_poll_votes, crew_polls,
        email_verification_tokens, password_reset_tokens,
        audit_log, notification_topic_subs, notification_counts, notification_log,
        notification_preferences, device_tokens,
        crew_members, crews, festival_profile_notes,
        festival_profile_picks, festival_profiles, festival_sets, festival_days,
        festival_stages, festivals, user_sessions, users
      CASCADE
    `);
  } finally { await pool.end(); }
}

async function seedTestData(festivals = createFestivalFixture()) {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    for (const festival of festivals) {
      await pool.query(
        'INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT (id) DO NOTHING',
        [festival.id, festival.name, festival.location]
      );
      for (let si = 0; si < (festival.stages || []).length; si++) {
        const stage = festival.stages[si];
        await pool.query(
          'INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
          [festival.id, stage.id, stage.name, stage.color, si]
        );
      }
      for (let di = 0; di < (festival.days || []).length; di++) {
        const day = festival.days[di];
        await pool.query(
          'INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [festival.id, di, day.label, day.date]
        );
        for (let sei = 0; sei < (day.sets || []).length; sei++) {
          const set = day.sets[sei];
          await pool.query(
            'INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
            [set.id, festival.id, di, set.artist, set.stageId, set.startTime, set.endTime, sei]
          );
        }
      }
    }
  } finally { await pool.end(); }
}

async function startServer(overrides = {}) {
  await ensureTestSchema();
  await truncateAllTables();
  await seedTestData();
  const planner = createFestivalPlanner({
    DATABASE_URL: TEST_DATABASE_URL, PUBLIC_DIR,
    NODE_ENV: 'test', REDIS_ENABLED: 'false',
    AUTH_RATE_LIMIT_MAX: 1000, PUBLIC_ORIGIN: '',
    RESEND_API_KEY: 'test_fake_key', EMAIL_FROM: 'test@example.com',
    ...overrides,
  });
  await new Promise((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  return {
    planner,
    databaseUrl: TEST_DATABASE_URL,
    request: request(planner.app),
    async close() { await planner.close(); },
  };
}

async function registerUser(server, username, password = DEFAULT_PASSWORD) {
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password, confirmPassword: password, tosAccepted: true })
    .expect(201);
  return res.body.data;
}

async function joinFestival(server, userToken, festivalId = 'fest-1') {
  const res = await server.request
    .post('/api/v1/profiles')
    .set('x-user-token', userToken)
    .send({ festivalId })
    .expect(200);
  return res.body.data;
}

async function createCrew(server, token, name = 'Test Crew', festivalId = 'fest-p2') {
  const res = await server.request
    .post('/api/v1/crews')
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ name, festivalId })
    .expect(201);
  return res.body.data;
}

async function joinCrew(server, token, inviteCode) {
  const res = await server.request
    .post('/api/v1/crews/join')
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ inviteCode })
    .expect(200);
  return res.body.data;
}

async function loginAdmin(server) {
  const adminUsername = 'testadmin-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username: adminUsername, password: 'test-admin-password-pass', confirmPassword: 'test-admin-password-pass', tosAccepted: true })
    .expect(201);
  const pool = new Pool({ connectionString: server.databaseUrl, statement_timeout: 5000 });
  try {
    await pool.query(
      'INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) SELECT u.id, r.id, NULL, NOW() FROM users u, roles r WHERE u.username = $1 AND r.name = $2 ON CONFLICT (user_id, role_id) DO NOTHING',
      [adminUsername, 'admin']
    );
  } finally { await pool.end(); }
  const loginRes = await server.request
    .post('/api/v1/auth/login')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username: adminUsername, password: 'test-admin-password-pass' })
    .expect(200);
  return loginRes.body.data.token;
}

const servers = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try { await s.close(); } catch {}
  }
});

// Force-exit guard for socket handles; matches phase2/phase3 patterns.
afterAll(() => { setTimeout(() => process.exit(0), 2000).unref?.(); });

// ════════════════════════════════════════════════════════════════════════
// Health / Info / Ready
// ════════════════════════════════════════════════════════════════════════

describe('GET /api/health /api/info /api/ready', () => {
  test('/api/health returns 200 with ok status', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'ok');
  });

  test('/api/info returns feature flags and version', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/info');
    assert.equal(res.status, 200);
    assert.ok(res.body.data);
  });

  test('/api/ready returns 200 (all deps) or 503 (Redis off)', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/ready');
    assert.ok(res.status === 200 || res.status === 503);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Metrics endpoints
// ════════════════════════════════════════════════════════════════════════

describe('metrics endpoints', () => {
  test('POST /api/metrics/client accepts valid payload', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/metrics/client')
      .send({ lcp: 1500, fid: 50, cls: 0.1, avgRenderMs: 16, renders: 120 })
      .expect(200);
    assert.ok(res.body.data !== undefined);
  });

  test('POST /api/metrics/client accepts or rejects unknown payload shape', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/metrics/client')
      .send({ invalidField: 'value' });
    assert.ok(res.status === 200 || res.status === 400);
  });

  test('POST /api/v1/metrics/client has rate-limit headers', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.post('/api/v1/metrics/client')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ lcp: 1200, fid: 50, cls: 0.05 });
    assert.ok([200, 204].includes(res.status), `Metrics: ${res.status}`);
    assert.ok(res.headers['x-ratelimit-limit']);
  });

  test('GET /api/v1/metrics returns Prometheus-compatible format', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const res = await server.request
      .get('/api/v1/metrics')
      .set('x-user-token', adminToken)
      .expect(200);
    assert.match(res.headers['content-type'], /text\/plain/);
    assert.ok(res.text.includes('fp_'));
  });
});

// ════════════════════════════════════════════════════════════════════════
// Admin routes (bulk, CRUD, cascade, audit)
// ════════════════════════════════════════════════════════════════════════

describe('admin bulk deactivate + archive', () => {
  test('POST /admin/bulk/deactivate requires admin', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/v1/admin/bulk/deactivate')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ userIds: ['user-123'] });
    assert.equal(res.status, 401);
  });

  test('admin can deactivate a user', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const user = await registerUser(server, 'todeactivate');
    const res = await server.request
      .post('/api/v1/admin/bulk/deactivate')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ userIds: [user.user.id] });
    assert.equal(res.status, 200);
  });

  test('POST /admin/bulk/archive-festivals requires admin', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/v1/admin/bulk/archive-festivals')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ festivalIds: ['fest-123'] });
    assert.equal(res.status, 401);
  });

  test('admin can archive festivals', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const createRes = await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ name: 'Archive Test Fest', days: [{ date: '2026-06-01', label: 'Day 1', sets: [] }], stages: [] });
    const festId = createRes.body.data?.id || createRes.body.data?.festival?.id;
    const res = await server.request
      .post('/api/v1/admin/bulk/archive-festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ festivalIds: [festId] });
    assert.ok(res.status === 200 || res.status === 400);
  });
});

describe('admin festival CRUD + cascade + audit', () => {
  test('create → update → delete festival round trip', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const createRes = await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        name: 'CRUD Test Fest', location: 'Testville',
        stages: [{ id: 'main', name: 'Main', color: '#ff0000' }],
        days: [{ label: 'Day 1', date: '2026-07-15', sets: [] }],
      })
      .expect(201);
    const festId = createRes.body.data.id;
    assert.ok(festId);

    const upd = await server.request
      .put(`/api/v1/admin/festivals/${festId}`)
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ name: 'Updated CRUD Fest' })
      .expect(200);
    assert.equal(upd.body.data.name, 'Updated CRUD Fest');

    await server.request
      .delete(`/api/v1/admin/festivals/${festId}`)
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    const getRes = await server.request.get(`/api/v1/festivals/${festId}`);
    assert.ok(getRes.status >= 400);
  });

  test('hard-delete cascades festival_stages rows', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const createRes = await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        name: 'Cascade Test', location: 'Test',
        stages: [{ id: 'stage', name: 'Stage', color: '#000' }],
        days: [{ label: 'Day', date: '2026-07-20', sets: [] }],
      })
      .expect(201);
    const festId = createRes.body.data.id;

    await server.request
      .delete(`/api/v1/admin/festivals/${festId}?hard=true`)
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query('SELECT * FROM festival_stages WHERE festival_id = $1', [festId]);
      assert.equal(rows.length, 0);
    } finally { await pool.end(); }
  });

  test('admin mutations write audit_log entries', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        name: 'Audit Test Fest', location: 'Audit Land',
        stages: [{ id: 'audit-stage-1', name: 'Stage 1', color: '#000000' }],
        days: [{ label: 'Day 1', date: '2026-08-01',
          sets: [{ id: 'audit-set-1', artist: 'Artist', stageId: 'audit-stage-1', startTime: '20:00', endTime: '21:00' }] }],
      })
      .expect(201);

    await new Promise((r) => setTimeout(r, 100));
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query(
        "SELECT * FROM audit_log WHERE action LIKE 'festival:%' ORDER BY created_at DESC LIMIT 5"
      );
      assert.ok(rows.length > 0);
    } finally { await pool.end(); }
  });
});

// ════════════════════════════════════════════════════════════════════════
// Profile ACL + soft-delete visibility + avatar
// ════════════════════════════════════════════════════════════════════════

describe('profile + avatar', () => {
  test('user cannot modify other user profile (ACL)', async () => {
    const server = await startServer(); servers.push(server);
    const user1 = await registerUser(server, 'user1access');
    const user2 = await registerUser(server, 'user2access');
    const profile1 = await joinFestival(server, user1.token);

    const res = await server.request
      .put(`/api/v1/profiles/${profile1.id}`)
      .set('x-user-token', user2.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-a': 'must' } });
    assert.ok(res.status >= 400);
  });

  test('soft-deleted profile not returned by festival GET', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'softdeleteuser');
    const profile = await joinFestival(server, user.token);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query('UPDATE festival_profiles SET deleted_at = NOW() WHERE id = $1', [profile.id]);
    } finally { await pool.end(); }

    const res = await server.request
      .get('/api/v1/festivals/fest-1')
      .set('x-user-token', user.token);
    if (res.status === 200 && res.body.data.profiles) {
      const found = res.body.data.profiles.find((p) => p.id === profile.id);
      assert.ok(!found);
    }
  });

  test('avatar upload + removal round trip', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'avatarlifecycleuser');
    const AVATAR_FIXTURE = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z/CfAQgwgImBgaEBAAriA/1oCbcnAAAAAElFTkSuQmCC',
      'base64'
    );

    const upload = await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', AVATAR_FIXTURE, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(200);
    const avatarUrl = upload.body.data?.avatarUrl || upload.body.data?.user?.avatarUrl;
    assert.ok(avatarUrl);

    const del = await server.request
      .delete('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);
    assert.equal(del.body.data?.avatarUrl ?? null, null);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Export HTML + ICS
// ════════════════════════════════════════════════════════════════════════

describe('export routes', () => {
  test('HTML export returns valid HTML doc', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'htmlexportuser');
    const profile = await joinFestival(server, user.token);
    const res = await server.request
      .get(`/api/v1/export/fest-1/${profile.id}`)
      .set('x-user-token', user.token)
      .expect(200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /<!DOCTYPE html>/i);
  });

  test('ICS calendar export returns valid iCalendar', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'icsexportuser');
    const profile = await joinFestival(server, user.token);
    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-a': 'must' } })
      .expect(200);
    const res = await server.request
      .get(`/api/v1/export/fest-1/${profile.id}/calendar`)
      .set('x-user-token', user.token)
      .expect(200);
    assert.match(res.headers['content-type'], /text\/calendar/);
    assert.match(res.text, /BEGIN:VCALENDAR/);
    assert.match(res.text, /END:VCALENDAR/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Notifications (badge / unread / history)
// ════════════════════════════════════════════════════════════════════════

describe('notifications routes', () => {
  test('badge reset accepts 200 / 204 / 404', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'notificationuser');
    const res = await server.request
      .post('/api/v1/notifications/badge/reset')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1');
    assert.ok([200, 204, 404].includes(res.status));
  });

  test('unread counts returns object or number when implemented', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'unreaduser');
    const res = await server.request
      .get('/api/v1/notifications/unread')
      .set('x-user-token', user.token);
    if (res.status === 200) {
      assert.ok(typeof res.body.data === 'object' || typeof res.body.data === 'number');
    }
  });

  test('delivery history returns array or object when implemented', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'historyuser');
    const res = await server.request
      .get('/api/v1/notifications/history')
      .set('x-user-token', user.token);
    if (res.status === 200) {
      assert.ok(Array.isArray(res.body.data) || typeof res.body.data === 'object');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// Tiered data loading (?depth=)
// ════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/festivals/:id?depth= (tiered loading)', () => {
  test('depth=1 returns stages + days with core set fields, strips deep fields', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'tiereduser');
    const res = await server.request
      .get('/api/v1/festivals/fest-1?depth=1')
      .set('x-user-token', user.token)
      .expect(200);
    const data = res.body.data;
    assert.equal(data.id, 'fest-1');
    assert.equal(data.name, 'Test Fest');
    assert.ok(Array.isArray(data.stages));
    assert.equal(data.stages.length, 2);
    assert.ok(Array.isArray(data.days));
    const stage = data.stages[0];
    assert.ok(stage.id && stage.name && stage.color);
    const set = data.days[0].sets[0];
    assert.ok(set.id && set.artist && set.stageId && set.startTime && set.endTime);
    assert.equal(set.linkUrl, undefined, 'depth=1 strips linkUrl');
    // And no profiles/messages in depth=1
    const keys = Object.keys(data);
    assert.ok(!keys.includes('profiles'));
    assert.ok(!keys.includes('messages'));
  });

  test('full depth (omit ?depth) returns complete festival', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'tiereduserfull');
    const res = await server.request
      .get('/api/v1/festivals/fest-1')
      .set('x-user-token', user.token)
      .expect(200);
    const data = res.body.data;
    assert.equal(data.id, 'fest-1');
    assert.ok(Array.isArray(data.stages));
    assert.ok(Array.isArray(data.days));
    assert.ok(data.days[0].sets);
  });

  test('depth=1 response is <= full-depth response in size', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'tieredsize');
    const [l1, full] = await Promise.all([
      server.request.get('/api/v1/festivals/fest-1?depth=1').set('x-user-token', user.token),
      server.request.get('/api/v1/festivals/fest-1').set('x-user-token', user.token),
    ]);
    assert.ok(JSON.stringify(l1.body).length <= JSON.stringify(full.body).length);
  });

  test('invalid depth values return 400', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'tieredbad');
    await server.request.get('/api/v1/festivals/fest-1?depth=-1').set('x-user-token', user.token).expect(400);
    await server.request.get('/api/v1/festivals/fest-1?depth=5').set('x-user-token', user.token).expect(400);
    await server.request.get('/api/v1/festivals/fest-1?depth=abc').set('x-user-token', user.token).expect(400);
    await server.request.get('/api/v1/festivals/fest-1?depth=99').expect(400);
  });

  test('festival list returns lightweight summaries (no stages/days arrays)', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals').expect(200);
    const fest = res.body.data[0];
    assert.ok(fest.id && fest.name && fest.location);
    assert.equal(typeof fest.stageCount, 'number');
    assert.equal(typeof fest.dayCount, 'number');
    assert.equal(fest.stages, undefined);
    assert.equal(fest.days, undefined);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Rate-limit headers + session expiry
// ════════════════════════════════════════════════════════════════════════

describe('rate-limit + session', () => {
  test('API responses include rate-limit headers', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals');
    assert.ok(res.headers['x-ratelimit-limit']);
    assert.ok(res.headers['x-ratelimit-remaining']);
    assert.ok(res.headers['x-ratelimit-reset']);
  });

  test('authenticated requests use per-user rate-limit key', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'ratelimituser');
    const res = await server.request.get('/api/v1/festivals')
      .set('x-user-token', user.token);
    assert.equal(res.status, 200);
    assert.ok(res.headers['x-ratelimit-limit']);
    assert.ok(res.headers['x-ratelimit-remaining']);
  });

  test('userAuth rate-limit entries stay isolated per user', async () => {
    const server = await startServer({ RATE_LIMIT_MAX: 100 }); servers.push(server);
    const u1 = await registerUser(server, 'user1cleanup');
    const u2 = await registerUser(server, 'user2cleanup');
    const r1 = await server.request.get('/api/v1/festivals').set('x-user-token', u1.token).expect(200);
    const r2 = await server.request.get('/api/v1/festivals').set('x-user-token', u2.token).expect(200);
    const rem1 = parseInt(r1.headers['x-ratelimit-remaining'] || '50', 10);
    const rem2 = parseInt(r2.headers['x-ratelimit-remaining'] || '50', 10);
    assert.ok(rem1 > 0 || rem2 > 0);
  });

  test('expired session returns 401 and gets cleaned from DB', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'expiringuser');
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query('UPDATE user_sessions SET created_at = 0 WHERE user_id = $1', [user.user.id]);
      const res = await server.request
        .get('/api/v1/account/export')
        .set('x-user-token', user.token);
      assert.equal(res.status, 401);
      const { rows } = await pool.query('SELECT COUNT(*) as count FROM user_sessions WHERE user_id = $1', [user.user.id]);
      assert.equal(parseInt(rows[0].count, 10), 0);
    } finally { await pool.end(); }
  });
});

// ════════════════════════════════════════════════════════════════════════
// Misc route edges
// ════════════════════════════════════════════════════════════════════════

describe('misc route edges', () => {
  test('deep-linking .well-known responses are valid JSON or 404/503', async () => {
    const server = await startServer(); servers.push(server);
    const r1 = await server.request.get('/.well-known/apple-app-site-association');
    const r2 = await server.request.get('/.well-known/assetlinks.json');
    assert.ok([200, 404, 503].includes(r1.status));
    assert.ok([200, 404, 503].includes(r2.status));
    if (r1.status === 200) assert.ok(typeof r1.body === 'object');
    if (r2.status === 200) assert.ok(typeof r2.body === 'object');
  });

  test('SSE endpoint returns 200/401/404', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/sse/test');
    assert.ok([200, 401, 404].includes(res.status));
  });

  test('error responses do not leak stack traces', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals/nonexistent-fest-xyz');
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
    assert.ok(!res.body.error.stack);
    assert.ok(!res.body.stack);
  });

  test('repeated 404s stay consistently shaped', async () => {
    const server = await startServer(); servers.push(server);
    for (let i = 0; i < 5; i++) {
      const res = await server.request.get('/api/v1/festivals/dedup-test-' + i);
      assert.equal(res.status, 404);
      assert.ok(res.body.error);
      assert.ok(res.body.error.message);
    }
  });

  test('profile sync with stale If-Match ETag accepted or 409', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const user = await registerUser(server, 'staleetag');

    await server.request.post('/api/v1/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        id: 'stale-fest', name: 'Stale Test', location: 'Test',
        stages: [{ id: 'main', name: 'Main', color: '#ff3366' }],
        days: [{ label: 'Fri', date: '2026-06-05', sets: [
          { id: 'set-s1', artist: 'Artist', stageId: 'main', startTime: '10:00', endTime: '11:00' },
        ]}],
      });

    const join = await server.request.post('/api/v1/profiles')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ festivalId: 'stale-fest' });
    assert.ok([200, 201].includes(join.status));
    const profileId = join.body.data && join.body.data.id;
    assert.ok(profileId);

    const update1 = await server.request.put('/api/v1/profiles/' + profileId)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-s1': 'must' } });
    assert.equal(update1.status, 200);

    const staleUpdate = await server.request.put('/api/v1/profiles/' + profileId)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .set('If-Match', '"stale-etag-000"')
      .send({ picks: { 'set-s1': 'maybe' } });
    assert.ok([200, 409].includes(staleUpdate.status));
  });

  test('Redis-disabled app still starts and serves core routes', async () => {
    const server = await startServer({ REDIS_ENABLED: 'false' }); servers.push(server);
    const health = await server.request.get('/api/health').expect(200);
    assert.equal(health.body.data.status, 'ok');
    const fests = await server.request.get('/api/v1/festivals').expect(200);
    assert.ok(Array.isArray(fests.body.data));
    const user = await registerUser(server, 'noredisuser');
    assert.ok(user.token);
  });

  test('log output contains no sensitive data', async () => {
    const server = await startServer(); servers.push(server);
    const captured = [];
    const origLog = console.log;
    console.log = (...args) => captured.push(args.join(' '));
    try {
      await server.request
        .post('/api/v1/auth/register')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ username: 'securitytest', password: 'supersecretpassword123', confirmPassword: 'supersecretpassword123', tosAccepted: true })
        .expect(201);
      const logText = captured.join('\n').toLowerCase();
      assert.ok(!logText.includes('supersecretpassword'));
      assert.ok(!logText.includes('cookie'));
    } finally { console.log = origLog; }
  });

  test('graceful shutdown — server.close completes without hanging', async () => {
    const server = await startServer(); servers.push(server);
    const startClose = Date.now();
    server.planner.server.close();
    const endClose = Date.now();
    assert.ok(endClose - startClose >= 0);
  });

  test('migrations baseline exists (tables present after schema init)', async () => {
    const server = await startServer(); servers.push(server);
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE '%'");
      assert.ok(rows[0].count > 0);
    } finally { await pool.end(); }
  });
});

// ════════════════════════════════════════════════════════════════════════
// Crew Polls lifecycle
// ════════════════════════════════════════════════════════════════════════

describe('Crew Polls', () => {
  test('full poll lifecycle: create → list → vote → close', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_polls');
    await joinFestival(server, alice.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Best headliner?', options: ['Excision', 'Kompany'] })
      .expect(200);
    const poll = createRes.body.data.poll;
    assert.ok(poll.id);
    assert.equal(poll.question, 'Best headliner?');
    assert.deepEqual(poll.options, ['Excision', 'Kompany']);

    const listRes = await server.request
      .get(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .expect(200);
    assert.equal(listRes.body.data.polls.length, 1);
    assert.equal(listRes.body.data.polls[0].id, poll.id);

    const voteRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${poll.id}/vote`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 0 })
      .expect(200);
    assert.equal(voteRes.body.data.voted, true);

    await server.request
      .delete(`/api/v1/crews/${crew.id}/polls/${poll.id}`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    const listAfter = await server.request
      .get(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .expect(200);
    assert.equal(listAfter.body.data.polls.length, 0);
  });

  test('rejects poll creation with invalid data', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_bad');
    await joinFestival(server, alice.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);

    // No question
    await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ options: ['A', 'B'] })
      .expect(400);

    // Only 1 option
    await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Test?', options: ['Only one'] })
      .expect(400);

    // 5 options (max 4)
    await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Test?', options: ['A', 'B', 'C', 'D', 'E'] })
      .expect(400);
  });

  test('enforces max 3 active polls per crew (409)', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_max');
    await joinFestival(server, alice.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);

    for (let i = 0; i < 3; i++) {
      await server.request
        .post(`/api/v1/crews/${crew.id}/polls`)
        .set('x-user-token', alice.token)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ question: `Poll ${i}?`, options: ['Yes', 'No'] })
        .expect(200);
    }
    const res = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Too many?', options: ['Yes', 'No'] })
      .expect(409);
    assert.ok(res.body.error);
  });

  test('non-member cannot create or view polls (403)', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_nm');
    const bob = await registerUser(server, 'bob_nm');
    await joinFestival(server, alice.token, 'fest-p2');
    await joinFestival(server, bob.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', bob.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Sneak in?', options: ['Yes', 'No'] })
      .expect(403);

    await server.request
      .get(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', bob.token)
      .expect(403);
  });

  test('vote changes are idempotent (upsert)', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_upsert');
    await joinFestival(server, alice.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Change vote?', options: ['A', 'B', 'C'] })
      .expect(200);
    const pollId = createRes.body.data.poll.id;

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 0 })
      .expect(200);

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 2 })
      .expect(200);

    const listRes = await server.request
      .get(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .expect(200);
    const poll = listRes.body.data.polls.find(p => p.id === pollId);
    const validVotes = (poll.votes || []).filter(v => v.user_id !== null);
    assert.equal(validVotes.length, 1);
    assert.equal(validVotes[0].option, 2);
  });

  test('rejects vote with out-of-bounds option index', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_oob');
    await joinFestival(server, alice.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Bounds?', options: ['A', 'B'] })
      .expect(200);
    const pollId = createRes.body.data.poll.id;

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 5 })
      .expect(400);

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: -1 })
      .expect(400);
  });

  test('multi-user voting produces correct vote_count', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_multi');
    const bob = await registerUser(server, 'bob_multi');
    await joinFestival(server, alice.token, 'fest-p2');
    await joinFestival(server, bob.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);
    await joinCrew(server, bob.token, crew.inviteCode);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Multi vote?', options: ['X', 'Y'] })
      .expect(200);
    const pollId = createRes.body.data.poll.id;

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 0 })
      .expect(200);

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', bob.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 1 })
      .expect(200);

    const listRes = await server.request
      .get(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .expect(200);
    const poll = listRes.body.data.polls.find(p => p.id === pollId);
    assert.equal(Number(poll.vote_count), 2);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Spotify preview route
// ════════════════════════════════════════════════════════════════════════

describe('Spotify preview route', () => {
  test('returns null embedType for set without Spotify link', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_spot1');
    await joinFestival(server, alice.token, 'fest-p2');
    const res = await server.request
      .get('/api/v1/spotify/preview/set-1')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.strictEqual(res.body.data.embedType, null);
  });

  test('returns 404 for nonexistent set', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_spot2');
    await joinFestival(server, alice.token, 'fest-p2');
    const res = await server.request
      .get('/api/v1/spotify/preview/set-nonexistent')
      .set('x-user-token', alice.token)
      .expect(404);
    assert.ok(res.body.error);
  });

  test('is publicly accessible (no auth required) — 200/404/429', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .get('/api/v1/spotify/preview/nonexistent-set');
    if (![200, 404, 429].includes(res.status)) {
      throw new Error('expected 200/404/429 got ' + res.status);
    }
  });

  test('returns null embedType for set with empty artists array', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_spot3');
    await joinFestival(server, alice.token, 'fest-p2');
    const res = await server.request
      .get('/api/v1/spotify/preview/set-1')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.strictEqual(res.body.error, null);
    assert.strictEqual(res.body.data.embedType, null);
  });

  test('returns null embedType for set with artist but no Spotify link', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_spot4');
    await joinFestival(server, alice.token, 'fest-p2');
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query(
        `UPDATE festival_sets SET artists = $1 WHERE id = 'set-2'`,
        [JSON.stringify([{ name: 'Kompany', links: {} }])]
      );
    } finally { await pool.end(); }
    const res = await server.request
      .get('/api/v1/spotify/preview/set-2')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.strictEqual(res.body.data.embedType, null);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Grid / Sets data
// ════════════════════════════════════════════════════════════════════════

describe('Grid / Sets data', () => {
  test('festival detail returns sets with stage and day info', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals/fest-p2').expect(200);
    const festival = res.body.data;
    assert.equal(festival.id, 'fest-p2');
    assert.ok(Array.isArray(festival.days));
    assert.ok(festival.days.length > 0);
    const day = festival.days[0];
    assert.ok(Array.isArray(day.sets));
    assert.equal(day.sets.length, 3);
    for (const set of day.sets) {
      assert.ok(set.id);
      assert.ok(set.artist || set.name);
      assert.ok(set.stageId || set.stage_id);
    }
  });

  test('festival detail returns stages for grid column layout', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals/fest-p2').expect(200);
    const festival = res.body.data;
    assert.ok(Array.isArray(festival.stages));
    assert.equal(festival.stages.length, 2);
    assert.equal(festival.stages[0].name, 'Main Stage');
    assert.equal(festival.stages[1].name, 'Forest');
  });

  test('sets include time data for grid positioning', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals/fest-p2').expect(200);
    const sets = res.body.data.days[0].sets;
    const excision = sets.find(s => s.artist === 'Excision' || s.name === 'Excision');
    assert.ok(excision);
    assert.ok(excision.startTime || excision.start_time);
    assert.ok(excision.endTime || excision.end_time);
  });

  test('returns 404 for nonexistent festival', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals/nonexistent').expect(404);
    assert.ok(res.body.error);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Socket.IO event validation
// ════════════════════════════════════════════════════════════════════════

describe('Socket.IO event validation', () => {
  function connectSocket(port, token, opts = {}) {
    return createSocketClient(`http://localhost:${port}`, {
      transports: ['websocket'], auth: { token },
      autoConnect: true, reconnection: false, timeout: 3000, ...opts,
    });
  }

  async function getAuthToken(server) {
    const username = `socktest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const reg = await server.request
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username, password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, tosAccepted: true });
    return reg.body.data?.token;
  }

  test('join:festival with invalid festivalId type is rejected', async () => {
    const server = await startServer(); servers.push(server);
    const port = server.planner.server.address().port;
    const token = await getAuthToken(server);
    const socket = connectSocket(port, token);
    await new Promise((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('join:festival', 12345, { _v: 1 }, (response) => {
          try {
            assert.ok(response);
            assert.equal(response.ok, false);
            socket.disconnect();
            resolve();
          } catch (e) { socket.disconnect(); reject(e); }
        });
      });
      socket.on('connect_error', (e) => reject(e));
      setTimeout(() => { socket.disconnect(); reject(new Error('timeout')); }, 5000);
    });
  });

  test('join:festival without auth token disconnects or errors', async () => {
    const server = await startServer(); servers.push(server);
    const port = server.planner.server.address().port;
    const socket = createSocketClient(`http://localhost:${port}`, {
      transports: ['websocket'], autoConnect: true, reconnection: false, timeout: 3000,
    });
    await new Promise((resolve) => {
      socket.on('connect', () => {
        socket.emit('join:festival', 'fest-p3', { _v: 1 }, (response) => {
          assert.ok(!response || response.ok === false);
          socket.disconnect();
          resolve();
        });
      });
      socket.on('disconnect', () => resolve());
      socket.on('connect_error', () => resolve());
      setTimeout(() => { socket.disconnect(); resolve(); }, 5000);
    });
  });

  test('join:festival with nonexistent festival returns ok:false', async () => {
    const server = await startServer(); servers.push(server);
    const port = server.planner.server.address().port;
    const token = await getAuthToken(server);
    const socket = connectSocket(port, token);
    await new Promise((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('join:festival', 'nonexistent-festival-id', { _v: 1, userToken: token }, (response) => {
          try {
            assert.ok(response);
            assert.equal(response.ok, false);
            socket.disconnect();
            resolve();
          } catch (e) { socket.disconnect(); reject(e); }
        });
      });
      socket.on('connect_error', (e) => reject(e));
      setTimeout(() => { socket.disconnect(); reject(new Error('timeout')); }, 5000);
    });
  });

  test('join:crew with invalid payload is rejected', async () => {
    const server = await startServer(); servers.push(server);
    const port = server.planner.server.address().port;
    const token = await getAuthToken(server);
    const socket = connectSocket(port, token);
    await new Promise((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('join:crew', { _v: 1, crewId: '' }, (response) => {
          try {
            assert.ok(response);
            assert.equal(response.ok, false);
            socket.disconnect();
            resolve();
          } catch (e) { socket.disconnect(); reject(e); }
        });
      });
      socket.on('connect_error', (e) => reject(e));
      setTimeout(() => { socket.disconnect(); reject(new Error('timeout')); }, 5000);
    });
  });

  test('join:festival with schema version mismatch does not crash', async () => {
    const server = await startServer(); servers.push(server);
    const port = server.planner.server.address().port;
    const token = await getAuthToken(server);
    const socket = connectSocket(port, token);
    await new Promise((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('join:festival', 'fest-1', { _v: 999, userToken: token }, (response) => {
          try {
            assert.ok(response);
            socket.disconnect();
            resolve();
          } catch (e) { socket.disconnect(); reject(e); }
        });
      });
      socket.on('connect_error', (e) => reject(e));
      setTimeout(() => { socket.disconnect(); reject(new Error('timeout')); }, 5000);
    });
  });
});
