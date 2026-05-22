import 'dotenv/config';
/**
 * Critical Path Integration Tests
 * Covers: Admin festival CRUD, avatar lifecycle, HTML/ICS export,
 *         Redis-unavailable fallback, Prometheus metrics format,
 *         session expiration mid-use
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { afterEach, describe, test } from 'node:test';
import request from 'supertest';
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
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
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
    },
  ];
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
    // Apply incremental migrations (005+) idempotently
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql') && !f.startsWith('004_'))
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

async function truncateAllTables() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await pool.query(`
      TRUNCATE TABLE
        email_verification_tokens, password_reset_tokens,
        audit_log, notification_topic_subs, notification_counts, notification_log,
        notification_preferences, device_tokens,
        crew_members, crews, festival_profile_notes,
        festival_profile_picks, festival_profiles, festival_sets, festival_days,
        festival_stages, festivals, user_sessions, user_roles, users
      CASCADE
    `);
  } finally {
    await pool.end();
  }
}

async function seedTestData(festivals: any[] = createFestivalFixture()) {
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
  } finally {
    await pool.end();
  }
}

async function startServer(overrides: Record<string, any> = {}) {
  await ensureTestSchema();
  await truncateAllTables();
  await seedTestData();
  const planner = await createFestivalPlanner({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR,
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
    ...overrides,
  });
  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  return {
    planner,
    databaseUrl: TEST_DATABASE_URL,
    request: request(planner.app),
    async close() {
      await planner.close();
    },
  };
}

async function registerUser(server: any, username: string, password: string = DEFAULT_PASSWORD) {
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password, confirmPassword: password, tosAccepted: true })
    .expect(201);
  return res.body.data;
}

async function loginUser(server: any, username: string, password: string = DEFAULT_PASSWORD) {
  const res = await server.request
    .post('/api/v1/auth/login')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password })
    .expect(200);
  return res.body.data;
}

async function joinFestival(server: any, userToken: string, festivalId: string = 'fest-1') {
  const res = await server.request
    .post('/api/v1/profiles')
    .set('x-user-token', userToken)
    .send({ festivalId })
    .expect(200);
  return res.body.data;
}

async function loginAdmin(server: any) {
  const adminUsername = 'testadmin-' + Date.now();
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
  } finally {
    await pool.end();
  }
  
  const loginRes = await server.request
    .post('/api/v1/auth/login')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username: adminUsername, password: 'test-admin-password-pass' })
    .expect(200);
  return loginRes.body.data.token;
}


const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    await s.close();
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// 1. Admin Festival CRUD
// ════════════════════════════════════════════════════════════════════════════════

describe('admin festival CRUD', { concurrency: 1 }, () => {
  test('admin can create a festival', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    const festivalPayload = {
      name: 'New Fest 2026',
      location: 'Miami',
      stages: [{ id: 'main-new', name: 'Main', color: '#ff0000' }],
      days: [
        {
          label: 'Day 1',
          date: '2026-07-01',
          sets: [{ id: 'set-new-1', artist: 'TestDJ', stageId: 'main-new', startTime: '20:00', endTime: '21:00' }],
        },
      ],
    };

    const res = await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send(festivalPayload)
      .expect(201);

    assert.equal(res.body.data.name, 'New Fest 2026');
    assert.equal(res.body.data.location, 'Miami');
    assert.ok(res.body.data.id, 'Created festival should have an id');
    assert.ok(res.body.data.stages.length >= 1);
    assert.ok(res.body.data.days.length >= 1);
  });

  test('admin can update a festival', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    const res = await server.request
      .put('/api/v1/admin/festivals/fest-1')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        name: 'Updated Fest',
        location: 'New Location',
        stages: [{ id: 'big', name: 'Big Stage', color: '#00ff00' }],
        days: [
          {
            label: 'Friday',
            date: '2026-06-05',
            sets: [{ id: 'set-upd-1', artist: 'NewArtist', stageId: 'big', startTime: '10:00', endTime: '11:00' }],
          },
        ],
      })
      .expect(200);

    assert.equal(res.body.data.name, 'Updated Fest');
    assert.equal(res.body.data.location, 'New Location');

    // Verify the update persisted
    const getRes = await server.request.get('/api/v1/festivals/fest-1').expect(200);
    assert.equal(getRes.body.data.name, 'Updated Fest');
  });

  test('admin can soft-delete a festival', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    await server.request
      .delete('/api/v1/admin/festivals/fest-1')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    // Festival should no longer appear in list
    const listRes = await server.request.get('/api/v1/festivals').expect(200);
    const ids = listRes.body.data.map((f: any) => f.id);
    assert.ok(!ids.includes('fest-1'), 'Soft-deleted festival should not appear in list');
  });

  test('admin can hard-delete a festival', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    await server.request
      .delete('/api/v1/admin/festivals/fest-1?hard=true')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    // Festival detail should 404
    await server.request.get('/api/v1/festivals/fest-1').expect(404);
  });

  test('non-admin cannot create a festival', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'regularuser');

    await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ name: 'Hack Fest', location: 'Nowhere', stages: [], days: [] })
      .expect(403);
  });

  test('delete nonexistent festival returns 404', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    await server.request
      .delete('/api/v1/admin/festivals/nonexistent-fest')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 2. Admin User Management
// ════════════════════════════════════════════════════════════════════════════════

describe('admin user management', { concurrency: 1 }, () => {
  test('admin can list users with profile counts', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    // Create a user and join a festival
    const user = await registerUser(server, 'alice');
    await joinFestival(server, user.token);

    const res = await server.request
      .get('/api/v1/admin/users')
      .set('x-user-token', adminToken)
      .expect(200);

    assert.ok(Array.isArray(res.body.data));
    const alice = res.body.data.find((u: any) => u.username === 'alice');
    assert.ok(alice, 'alice should appear in user list');
    assert.equal(alice.profileCount, 1);
  });

  test('admin can reset a user password', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);
    await registerUser(server, 'bob');

    // Get bob's user id
    const usersRes = await server.request
      .get('/api/v1/admin/users')
      .set('x-user-token', adminToken)
      .expect(200);
    const bob = usersRes.body.data.find((u: any) => u.username === 'bob');

    await server.request
      .put(`/api/v1/admin/users/${bob.id}/reset-password`)
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ newPassword: 'newpassword999' })
      .expect(200);

    // Old password should fail
    await server.request
      .post('/api/v1/auth/login')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: 'bob', password: DEFAULT_PASSWORD })
      .expect(401);

    // New password should work
    await server.request
      .post('/api/v1/auth/login')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: 'bob', password: 'newpassword999' })
      .expect(200);
  });

  test('admin can delete a user and cascade cleans up', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    const user = await registerUser(server, 'doomed');
    await joinFestival(server, user.token);

    const usersRes = await server.request
      .get('/api/v1/admin/users')
      .set('x-user-token', adminToken)
      .expect(200);
    const doomed = usersRes.body.data.find((u: any) => u.username === 'doomed');

    await server.request
      .delete(`/api/v1/admin/users/${doomed.id}`)
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    // User should no longer appear
    const afterRes = await server.request
      .get('/api/v1/admin/users')
      .set('x-user-token', adminToken)
      .expect(200);
    const found = afterRes.body.data.find((u: any) => u.username === 'doomed');
    assert.ok(!found, 'Deleted user should not appear in list');

    // Token should be invalid
    await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', user.token)
      .expect(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 3. Avatar Upload & Removal Lifecycle
// ════════════════════════════════════════════════════════════════════════════════

describe('avatar lifecycle', { concurrency: 1 }, () => {
  test('upload avatar, verify URL, then delete', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'avataruser');

    // Upload avatar
    const uploadRes = await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', AVATAR_FIXTURE, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(200);

    // Response may be nested as data.user.avatarUrl or data.avatarUrl
    const avatarUrl = uploadRes.body.data?.avatarUrl || uploadRes.body.data?.user?.avatarUrl;
    assert.ok(avatarUrl, 'Should return avatar URL');

    // Verify avatar URL is served
    if (avatarUrl && avatarUrl.startsWith('/')) {
      await server.request.get(avatarUrl).expect(200);
    }

    // Delete avatar
    const deleteRes = await server.request
      .delete('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    const deletedAvatarUrl = deleteRes.body.data?.avatarUrl ?? deleteRes.body.data?.user?.avatarUrl ?? null;
    assert.equal(deletedAvatarUrl, null);
  });

  test('rejects non-image upload', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'badupload');

    await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', Buffer.from('not an image at all'), {
        filename: 'malicious.exe',
        contentType: 'application/octet-stream',
      })
      .expect(400);
  });

  test('rejects oversized upload', async () => {
    const server = await startServer({ AVATAR_MAX_UPLOAD_BYTES: 100 });
    servers.push(server);
    const user = await registerUser(server, 'bigupload');

    // 200 bytes > 100 byte limit
    await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', Buffer.alloc(200), { filename: 'big.png', contentType: 'image/png' })
      .expect(400);
  });

  test('requires auth for avatar upload', async () => {
    const server = await startServer();
    servers.push(server);

    await server.request
      .post('/api/v1/account/avatar')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', AVATAR_FIXTURE, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 4. HTML & ICS Export
// ════════════════════════════════════════════════════════════════════════════════

describe('export', { concurrency: 1 }, () => {
  test('HTML export returns valid HTML with festival data', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'exporter');
    const profile = await joinFestival(server, user.token);

    const res = await server.request
      .get(`/api/v1/export/fest-1/${profile.id}`)
      .set('x-user-token', user.token)
      .expect(200);

    assert.match(res.headers['content-type']!, /text\/html/);
    assert.match(res.text, /<!DOCTYPE html>/i);
  });

  test('ICS export returns valid iCalendar with picks', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'icsuser');
    const profile = await joinFestival(server, user.token);

    // Save a pick first
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

    assert.match(res.headers['content-type']!, /text\/calendar/);
    assert.match(res.text, /BEGIN:VCALENDAR/);
    assert.match(res.text, /BEGIN:VEVENT/);
    assert.match(res.text, /END:VCALENDAR/);
  });

  test('export requires auth', async () => {
    const server = await startServer();
    servers.push(server);

    await server.request.get('/api/v1/export/fake-fest/fake-profile').expect(401);
    await server.request.get('/api/v1/export/fake-fest/fake-profile/calendar').expect(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 5. Prometheus Metrics Format
// ════════════════════════════════════════════════════════════════════════════════

describe('observability', { concurrency: 1 }, () => {
  test('GET /metrics returns Prometheus-compatible format', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    // Metrics is mounted on the health router at /metrics, which is at /api/v1/metrics
    const res = await server.request
      .get('/api/v1/metrics')
      .set('x-user-token', adminToken)
      .expect(200);

    assert.match(res.headers['content-type']!, /text\/plain/);
    assert.match(res.text, /fp_uptime_seconds \d+/);
    assert.match(res.text, /fp_users_total \d+/);
    assert.match(res.text, /fp_festivals_total \d+/);
  });

  test('health endpoint returns status ok', async () => {
    const server = await startServer();
    servers.push(server);

    const res = await server.request.get('/api/health').expect(200);
    assert.equal(res.body.data.status, 'ok');
    assert.ok(typeof res.body.data.uptime === 'number');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 6. Redis-Unavailable Fallback
// ════════════════════════════════════════════════════════════════════════════════

describe('redis unavailable fallback', { concurrency: 1 }, () => {
  test('app starts and serves requests without Redis', async () => {
    const server = await startServer({ REDIS_ENABLED: 'false' });
    servers.push(server);

    // Core endpoints should work
    const healthRes = await server.request.get('/api/health').expect(200);
    assert.equal(healthRes.body.data.status, 'ok');

    const festivalsRes = await server.request.get('/api/v1/festivals').expect(200);
    assert.ok(Array.isArray(festivalsRes.body.data));

    // Auth should work
    const user = await registerUser(server, 'redisless');
    assert.ok(user.token);

    // Profile CRUD should work
    const profile = await joinFestival(server, user.token);
    assert.ok(profile.id);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 7. Session Expiration Mid-Use
// ════════════════════════════════════════════════════════════════════════════════

describe('session invalidation', { concurrency: 1 }, () => {
  test('logged out session returns 401 on subsequent requests', async () => {
    const server = await startServer();
    servers.push(server);

    const user = await registerUser(server, 'loggedout');

    // Verify token works
    await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', user.token)
      .expect(200);

    // Logout
    await server.request
      .post('/api/v1/auth/logout')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    // Token should now be invalid
    await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', user.token)
      .expect(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 8. Festival Tiered Data Loading
// ════════════════════════════════════════════════════════════════════════════════

describe('tiered data loading', { concurrency: 1 }, () => {
  test('depth=1 returns structural data without profiles', async () => {
    const server = await startServer();
    servers.push(server);

    const res = await server.request.get('/api/v1/festivals/fest-1?depth=1').expect(200);

    assert.equal(res.body.data.name, 'Test Fest');
    assert.ok(Array.isArray(res.body.data.stages));
    assert.ok(Array.isArray(res.body.data.days));
    assert.equal(res.body.data.stages.length, 2);
    assert.equal(res.body.data.days.length, 2);
    // Sets should be present in depth=1
    assert.ok(res.body.data.days[0].sets.length > 0);
  });

  test('invalid depth returns 400', async () => {
    const server = await startServer();
    servers.push(server);

    await server.request.get('/api/v1/festivals/fest-1?depth=5').expect(400);
    await server.request.get('/api/v1/festivals/fest-1?depth=-1').expect(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 9. Audit Logging
// ════════════════════════════════════════════════════════════════════════════════

describe('audit logging', { concurrency: 1 }, () => {
  test('admin festival mutations write audit log entries', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    // Create a festival
    await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        name: 'Audited Fest',
        location: 'Audit Land',
        stages: [{ id: 'audit-stage', name: 'Stage 1', color: '#000000' }],
        days: [
          {
            label: 'Day 1',
            date: '2026-08-01',
            sets: [{ id: 'set-audit-1', artist: 'AuditDJ', stageId: 'audit-stage', startTime: '22:00', endTime: '23:00' }],
          },
        ],
      })
      .expect(201);

    // Allow async audit log write to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Query audit log directly
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query(
        "SELECT * FROM audit_log WHERE action = 'festival:create' ORDER BY created_at DESC LIMIT 1"
      );
      assert.ok(rows.length > 0, 'Audit log should contain festival:create entry');
      assert.ok(['admin', 'user'].includes(rows[0].actor_type), 'actor_type should be admin or user');
      assert.equal(rows[0].target_type, 'festival');
    } finally {
      await pool.end();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 10. Shareable Pick Links
// ════════════════════════════════════════════════════════════════════════════════

describe('shareable pick links', { concurrency: 1 }, () => {
  test('public share page renders HTML with picks', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'sharer');
    const profile = await joinFestival(server, user.token);

    // Save some picks
    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-a': 'must', 'set-b': 'want-to-see' } })
      .expect(200);

    // Access share page without auth
    const res = await server.request.get(`/s/${profile.id}`).expect(200);
    assert.match(res.headers['content-type']!, /text\/html/);
    assert.match(res.text, /sharer/); // username in page
    assert.match(res.text, /Test Fest/); // festival name
    assert.match(res.text, /Alpha/); // picked artist name
    assert.match(res.text, /Must See/); // priority label
  });

  test('share JSON endpoint returns structured data', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'jsonsharer');
    const profile = await joinFestival(server, user.token);

    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-c': 'maybe' } })
      .expect(200);

    const res = await server.request.get(`/s/${profile.id}/json`).expect(200);
    assert.equal(res.body.data.username, 'jsonsharer');
    assert.equal(res.body.data.festivalName, 'Test Fest');
    assert.equal(res.body.data.picks['set-c'], 'maybe');
    assert.ok(res.body.data.festival.stages);
    assert.ok(res.body.data.festival.days);
  });

  test('share page returns 404 for nonexistent profile', async () => {
    const server = await startServer();
    servers.push(server);
    await server.request.get('/s/nonexistent-profile-id').expect(404);
  });

  test('share page rejects invalid profile IDs', async () => {
    const server = await startServer();
    servers.push(server);
    // Spaces and special chars should be rejected by the regex filter
    const res = await server.request.get('/s/prof%20with%20spaces');
    assert.ok([400, 404].includes(res.status), 'Should reject invalid profile ID format');
  });

  test('share page sets cache headers', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'cachesharer');
    const profile = await joinFestival(server, user.token);

    const res = await server.request.get(`/s/${profile.id}`).expect(200);
    assert.match(res.headers['cache-control']!, /max-age=300/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 11. Per-User Rate Limiting
// ════════════════════════════════════════════════════════════════════════════════

describe('per-user rate limiting', { concurrency: 1 }, () => {
  test('authenticated requests rate limit by user token, not IP', async () => {
    // Use a higher limit to account for setup requests (register/login/join consume quota)
    // The key behavior: two different tokens get separate rate limit buckets
    const server = await startServer({ RATE_LIMIT_MAX: 50 });
    servers.push(server);

    const user1 = await registerUser(server, 'ratelimit1');
    const user2 = await registerUser(server, 'ratelimit2');

    // Both users make authenticated requests — check that rate limit headers
    // show independent counters (remaining should be similar for both users)
    const res1 = await server.request
      .get('/api/v1/festivals')
      .set('x-user-token', user1.token)
      .expect(200);

    const res2 = await server.request
      .get('/api/v1/festivals')
      .set('x-user-token', user2.token)
      .expect(200);

    // Both users should have high remaining counts (they each get their own 50-request bucket)
    const remaining1 = parseInt(res1.headers['x-ratelimit-remaining']!, 10);
    const remaining2 = parseInt(res2.headers['x-ratelimit-remaining']!, 10);

    // Each user's remaining should be close to 50 (minus their own requests)
    // If they shared an IP bucket, remaining would be much lower due to setup requests
    assert.ok(remaining1 >= 40, `User1 remaining ${remaining1} should be >= 40 (per-token bucket)`);
    assert.ok(remaining2 >= 40, `User2 remaining ${remaining2} should be >= 40 (per-token bucket)`);
  });

  test('unauthenticated requests still rate limit by IP', async () => {
    const server = await startServer({ RATE_LIMIT_MAX: 3 });
    servers.push(server);

    // Unauthenticated requests should rate limit by IP
    for (let i = 0; i < 3; i++) {
      await server.request.get('/api/health').expect(200);
    }

    const limitedRes = await server.request.get('/api/health');
    assert.equal(limitedRes.status, 429);
  });

  test('rate limit headers include correct values', async () => {
    const server = await startServer();
    servers.push(server);

    const res = await server.request
      .get('/api/health')
      .expect(200);

    const limit = parseInt(res.headers['x-ratelimit-limit']!, 10);
    const remaining = parseInt(res.headers['x-ratelimit-remaining']!, 10);
    const reset = parseInt(res.headers['x-ratelimit-reset']!, 10);
    assert.ok(limit > 0, 'X-RateLimit-Limit should be a positive number');
    assert.ok(remaining >= 0 && remaining <= limit, 'X-RateLimit-Remaining should be between 0 and limit');
    assert.ok(reset > Date.now() / 1000 - 60, 'X-RateLimit-Reset should be a recent/future timestamp');
  });
});
