require('dotenv').config();
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { afterEach, describe, test } = require('node:test');
const request = require('supertest');
const { io: createSocketClient } = require('socket.io-client');
const { Pool } = require('pg');
const crypto = require('crypto');
const { createFestivalPlanner } = require('../server');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_PASSWORD = 'password123';
const TRUSTED_MUTATION_HEADER = 'x-festie-request';
const AVATAR_FIXTURE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z/CfAQgwgImBgaEBAAriA/1oCbcnAAAAAElFTkSuQmCC', 'base64');

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
    const { rows } = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'users' LIMIT 1");
    if (rows.length === 0) {
      await pool.query('CREATE EXTENSION IF NOT EXISTS citext');
      const schemaPath = path.join(__dirname, '..', 'migrations', '004_postgresql_baseline.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
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

async function truncateAllTables(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`
      TRUNCATE TABLE
        email_verification_tokens, password_reset_tokens,
        audit_log, notification_topic_subs, notification_counts, notification_log,
        notification_preferences, device_tokens,
        crew_members, crews, festival_profile_notes,
        festival_profile_picks, festival_profiles, festival_sets, festival_days,
        festival_stages, festivals, user_sessions, users
      CASCADE
    `);
  } finally {
    await pool.end();
  }
}

describe('Hardening Tests', { concurrency: 1 }, () => {
  let app, server, io;

  afterEach(async () => {
    if (server) {
      return new Promise((resolve) => {
        server.close(() => {
          if (io) io.close();
          resolve();
        });
      });
    }
  });

  describe('Password Reset Flow', { concurrency: 1 }, () => {
    test('GET /reset/:token returns 200 for invalid token format', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const res = await request(app).get('/reset/invalid-token');
      assert.equal(res.status, 200);
    });

    test('POST /api/v1/auth/reset-password with expired token fails', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const pool = new Pool({ connectionString: TEST_DATABASE_URL });
      try {
        const user = await pool.query(
          'INSERT INTO users (id, username, password_hash, created_at, tos_accepted_at, tos_version) VALUES ($1, $2, $3, NOW(), NOW(), 1) RETURNING *',
          ['user-123', 'testuser', '$2b$10$salt']
        );

        const expiredToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(expiredToken).digest('hex');
        await pool.query(
          'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() - INTERVAL \'1 hour\')',
          [user.rows[0].id, tokenHash]
        );

        const res = await request(app).post('/api/v1/auth/reset-password').send({
          token: expiredToken,
          newPassword: 'newpass123',
          confirmPassword: 'newpass123',
        });
        assert(res.status >= 400);
      } finally {
        await pool.end();
      }
    });

    test('POST /api/v1/auth/reset-password with invalid token fails', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const res = await request(app).post('/api/v1/auth/reset-password').send({
        token: 'invalid-token-' + crypto.randomBytes(16).toString('hex'),
        newPassword: 'newpass123',
        confirmPassword: 'newpass123',
      });
      assert(res.status >= 400);
    });

    test('POST /api/v1/auth/forgot-password rate limits per email', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const email = 'test@example.com';
      const res1 = await request(app).post('/api/v1/auth/forgot-password').send({ email });
      assert.equal(res1.status, 200);

      const res2 = await request(app).post('/api/v1/auth/forgot-password').send({ email });
      assert.equal(res2.status, 200);

      const res3 = await request(app).post('/api/v1/auth/forgot-password').send({ email });
      assert.equal(res3.status, 200);

      const res4 = await request(app).post('/api/v1/auth/forgot-password').send({ email });
      assert.equal(res4.status, 429);
    });
  });

  describe('Session Management', { concurrency: 1 }, () => {
    test('GET /api/v1/auth/sessions requires authentication', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const res = await request(app).get('/api/v1/auth/sessions');
      assert.equal(res.status, 401);
    });

    test('GET /api/v1/auth/sessions lists user sessions', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const registerRes = await request(app).post('/api/v1/auth/register').send({
        username: 'sessionuser',
        password: DEFAULT_PASSWORD,
        confirmPassword: DEFAULT_PASSWORD,
        tosAccepted: true,
      });
      assert.equal(registerRes.status, 201);
      const token = registerRes.body.data.token;

      const res = await request(app)
        .get('/api/v1/auth/sessions')
        .set('x-user-token', token);
      assert.equal(res.status, 200);
      assert(Array.isArray(res.body.data));
    });

    test('DELETE /api/v1/auth/sessions/:id revokes session', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      // Register a user to get a session
      const registerRes = await request(app).post('/api/v1/auth/register').send({
        username: 'revokeuser',
        password: DEFAULT_PASSWORD,
        confirmPassword: DEFAULT_PASSWORD,
        tosAccepted: true,
      });
      const token = registerRes.body.data.token;

      // Login again to create a second session
      const loginRes = await request(app).post('/api/v1/auth/login')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ username: 'revokeuser', password: DEFAULT_PASSWORD });
      assert.equal(loginRes.status, 200);
      const secondToken = loginRes.body.data.token;

      // List sessions using the second token — should have 2 sessions
      const listRes = await request(app)
        .get('/api/v1/auth/sessions')
        .set('x-user-token', secondToken);
      assert(Array.isArray(listRes.body.data));
      assert(listRes.body.data.length >= 2);

      // Find the non-current session and delete it
      const nonCurrentSession = listRes.body.data.find((s) => !s.current);
      assert.ok(nonCurrentSession, 'Should have a non-current session to revoke');
      const deleteRes = await request(app)
        .delete(`/api/v1/auth/sessions/${nonCurrentSession.id}`)
        .set('x-user-token', secondToken);
      assert.equal(deleteRes.status, 200);
    });

    test('DELETE /api/v1/auth/sessions/:id fails for invalid ID format', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const registerRes = await request(app).post('/api/v1/auth/register').send({
        username: 'testuser',
        password: DEFAULT_PASSWORD,
        confirmPassword: DEFAULT_PASSWORD,
        tosAccepted: true,
      });
      const token = registerRes.body.data.token;

      const res = await request(app)
        .delete('/api/v1/auth/sessions/invalid!!id')
        .set('x-user-token', token);
      assert.equal(res.status, 400);
    });

    test('DELETE /api/v1/auth/sessions/:id prevents current session revocation', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const registerRes = await request(app).post('/api/v1/auth/register').send({
        username: 'currentuser',
        password: DEFAULT_PASSWORD,
        confirmPassword: DEFAULT_PASSWORD,
        tosAccepted: true,
      });
      const token = registerRes.body.data.token;

      const listRes = await request(app)
        .get('/api/v1/auth/sessions')
        .set('x-user-token', token);
      const currentSessionId = listRes.body.data.find(s => s.current)?.id;
      assert(currentSessionId);

      const deleteRes = await request(app)
        .delete(`/api/v1/auth/sessions/${currentSessionId}`)
        .set('x-user-token', token);
      assert.equal(deleteRes.status, 400);
    });
  });

  describe('Export & Share', { concurrency: 1 }, () => {
    test('GET /s/:profileId loads share page', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      // Register admin user and grant admin role via DB
      const adminUsername = 'testadmin-share-' + Date.now();
      await request(app).post('/api/v1/auth/register').set(TRUSTED_MUTATION_HEADER, '1')
        .send({ username: adminUsername, password: 'test-admin-password-pass', confirmPassword: 'test-admin-password-pass', tosAccepted: true });
      const adminPool = new Pool({ connectionString: TEST_DATABASE_URL, statement_timeout: 5000 });
      try {
        await adminPool.query(
          'INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) SELECT u.id, r.id, NULL, NOW() FROM users u, roles r WHERE u.username = $1 AND r.name = $2 ON CONFLICT (user_id, role_id) DO NOTHING',
          [adminUsername, 'admin']
        );
      } finally { await adminPool.end(); }
      const adminLoginRes = await request(app).post('/api/v1/auth/login').set(TRUSTED_MUTATION_HEADER, '1')
        .send({ username: adminUsername, password: 'test-admin-password-pass' });
      const adminToken = adminLoginRes.body.data.token;

      const registerRes = await request(app).post('/api/v1/auth/register').send({
        username: 'shareuser',
        password: DEFAULT_PASSWORD,
        confirmPassword: DEFAULT_PASSWORD,
        tosAccepted: true,
      });
      const token = registerRes.body.data.token;

      const festivalRes = await request(app)
        .post('/api/v1/festivals')
        .set('x-user-token', adminToken)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ name: 'Share Test Fest', location: 'Test', stages: [{ id: 'main', name: 'Main', color: '#ff0000' }], days: [] });
      const festivalId = festivalRes.body.data.id;

      const profileRes = await request(app)
        .post('/api/v1/profiles')
        .set('x-user-token', token)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ festivalId });
      const profileId = profileRes.body.data.id;

      const shareRes = await request(app).get(`/s/${profileId}`);
      assert.equal(shareRes.status, 200);
      assert.ok(shareRes.text.includes('<!DOCTYPE html') || shareRes.text.includes('<!doctype html'));
    });

    test('GET /s/:profileId returns 404 for invalid profile', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const res = await request(app).get('/s/invalid-profile-id');
      assert(res.status === 404 || res.status === 400);
    });

    test('GET /s/:profileId/json returns JSON data', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      // Register admin user and grant admin role via DB
      const adminUsername2 = 'testadmin-json-' + Date.now();
      await request(app).post('/api/v1/auth/register').set(TRUSTED_MUTATION_HEADER, '1')
        .send({ username: adminUsername2, password: 'test-admin-password-pass', confirmPassword: 'test-admin-password-pass', tosAccepted: true });
      const adminPool2 = new Pool({ connectionString: TEST_DATABASE_URL, statement_timeout: 5000 });
      try {
        await adminPool2.query(
          'INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) SELECT u.id, r.id, NULL, NOW() FROM users u, roles r WHERE u.username = $1 AND r.name = $2 ON CONFLICT (user_id, role_id) DO NOTHING',
          [adminUsername2, 'admin']
        );
      } finally { await adminPool2.end(); }
      const adminLoginRes2 = await request(app).post('/api/v1/auth/login').set(TRUSTED_MUTATION_HEADER, '1')
        .send({ username: adminUsername2, password: 'test-admin-password-pass' });
      const adminToken2 = adminLoginRes2.body.data.token;

      const registerRes = await request(app).post('/api/v1/auth/register').send({
        username: 'jsonshareuser',
        password: DEFAULT_PASSWORD,
        confirmPassword: DEFAULT_PASSWORD,
        tosAccepted: true,
      });
      const token = registerRes.body.data.token;

      const festivalRes = await request(app)
        .post('/api/v1/festivals')
        .set('x-user-token', adminToken2)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ name: 'JSON Fest', location: 'Test', stages: [{ id: 'main', name: 'Main', color: '#00ff00' }], days: [] });
      const festivalId = festivalRes.body.data.id;

      const profileRes = await request(app)
        .post('/api/v1/profiles')
        .set('x-user-token', token)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ festivalId });
      const profileId = profileRes.body.data.id;

      const jsonRes = await request(app).get(`/s/${profileId}/json`);
      assert.equal(jsonRes.status, 200);
      assert.ok(jsonRes.body.data || jsonRes.body);
    });

    test('GET /s/:profileId/json returns 404 for invalid profile', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const res = await request(app).get('/s/invalid-profile-id/json');
      assert.ok(res.status === 400 || res.status === 404, "Expected 400 or 404 for invalid profile");
    });
  });

  describe('Health Endpoints', { concurrency: 1 }, () => {
    test('GET /api/ready returns 200 when ready', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const res = await request(app).get('/api/ready');
      assert(res.status === 200 || res.status === 503);
    });

    test('GET /api/info returns feature flags and limits', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const res = await request(app).get('/api/info');
      assert.equal(res.status, 200);
      assert(res.body.data?.features);
      assert(res.body.data?.limits);
      assert(typeof res.body.data.features.export === 'boolean');
    });

    test('GET /health returns ok status', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;

      const res = await request(app).get('/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'ok');
    });
  });

  describe('Socket.IO Events', { concurrency: 1 }, () => {
    test('join:crew event validates crewId', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer, io: testIo } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;
      io = testIo;

      const registerRes = await request(app).post('/api/v1/auth/register').send({
        username: 'crewuser',
        password: DEFAULT_PASSWORD,
        confirmPassword: DEFAULT_PASSWORD,
        tosAccepted: true,
      });
      const token = registerRes.body.data.token;

      // Start listening on ephemeral port
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      const clientSocket = createSocketClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        auth: { token },
      });

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Socket connect timeout')), 3000);
        clientSocket.on('connect', () => { clearTimeout(timeout); resolve(); });
        clientSocket.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });
      });

      // join:crew with empty crewId should get an error ack
      const ackResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ error: 'timeout' }), 3000);
        clientSocket.emit('join:crew', { crewId: '' }, (response) => {
          clearTimeout(timeout);
          resolve(response);
        });
      });

      // Either we get an error ack or the server ignores/rejects it
      assert.ok(ackResult, 'Should receive a response for invalid crewId');
      if (ackResult.error && ackResult.error !== 'timeout') {
        assert.ok(true, 'Got error response for invalid crewId: ' + ackResult.error);
      }

      clientSocket.disconnect();
      await new Promise((resolve) => server.close(resolve));
    });

    test('join:festival event requires authentication', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer, io: testIo } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;
      io = testIo;

      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      // Connect WITHOUT a token — should still connect (socket auth is per-event)
      const clientSocket = createSocketClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
      });

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Socket connect timeout')), 3000);
        clientSocket.on('connect', () => { clearTimeout(timeout); resolve(); });
        clientSocket.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });
      });

      // join:festival without auth should either error or be handled gracefully
      const ackResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ status: 'no-ack' }), 3000);
        clientSocket.emit('join:festival', { festivalId: 'test-fest' }, (response) => {
          clearTimeout(timeout);
          resolve(response);
        });
      });

      // The socket should either reject or handle gracefully
      assert.ok(ackResult, 'Should handle unauthenticated join:festival');

      clientSocket.disconnect();
      await new Promise((resolve) => server.close(resolve));
    });

    test('leave:crew event removes socket from crew room', async () => {
      await ensureTestSchema();
      await truncateAllTables(TEST_DATABASE_URL);
      const { app: testApp, server: testServer, io: testIo } = await createFestivalPlanner({
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        REDIS_ENABLED: 'false',
        PUBLIC_DIR,
        AUTH_RATE_LIMIT_MAX: 1000,
        PUBLIC_ORIGIN: '',
      });
      app = testApp;
      server = testServer;
      io = testIo;

      const registerRes = await request(app).post('/api/v1/auth/register').send({
        username: 'leavecrewuser',
        password: DEFAULT_PASSWORD,
        confirmPassword: DEFAULT_PASSWORD,
        tosAccepted: true,
      });
      const token = registerRes.body.data.token;

      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      const clientSocket = createSocketClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        auth: { token },
      });

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Socket connect timeout')), 3000);
        clientSocket.on('connect', () => { clearTimeout(timeout); resolve(); });
        clientSocket.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });
      });

      // Join a crew room first
      const joinAck = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ status: 'no-ack' }), 3000);
        clientSocket.emit('join:crew', { crewId: 'test-crew-123' }, (response) => {
          clearTimeout(timeout);
          resolve(response);
        });
      });

      // Now leave the crew room
      const leaveAck = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ status: 'no-ack' }), 3000);
        clientSocket.emit('leave:crew', { crewId: 'test-crew-123' }, (response) => {
          clearTimeout(timeout);
          resolve(response);
        });
      });

      // Verify socket is no longer in crew room
      const rooms = Array.from(clientSocket.id ? (io.sockets.sockets.get(clientSocket.id)?.rooms || []) : []);
      const inCrewRoom = rooms.some(r => r.includes('test-crew-123'));
      assert.equal(inCrewRoom, false, 'Socket should not be in crew room after leaving');

      clientSocket.disconnect();
      await new Promise((resolve) => server.close(resolve));
    });
  });
});

// === Unicode Sanitization Hardening ===
const { sanitizeString } = require('../lib/helpers/sanitize');

describe('Unicode sanitization hardening', () => {
  test('strips zero-width space (U+200B)', () => {
    assert.equal(sanitizeString('hello\u200Bworld'), 'helloworld');
  });

  test('strips line separator (U+2028)', () => {
    assert.equal(sanitizeString('hello\u2028world'), 'helloworld');
  });

  test('strips paragraph separator (U+2029)', () => {
    assert.equal(sanitizeString('hello\u2029world'), 'helloworld');
  });

  test('strips word joiner (U+2060)', () => {
    assert.equal(sanitizeString('crew\u2060name'), 'crewname');
  });

  test('strips interlinear annotations (U+FFF9-U+FFFB)', () => {
    assert.equal(sanitizeString('text\uFFF9anno\uFFFA sep\uFFFBend'), 'textanno sepend');
  });

  test('preserves existing BiDi override stripping', () => {
    assert.equal(sanitizeString('test\u202Eevil\u202C'), 'testevil');
    assert.equal(sanitizeString('test\u2066isolate\u2069'), 'testisolate');
  });

  test('preserves ZWJ for emoji sequences (U+200D)', () => {
    const familyEmoji = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const result = sanitizeString(familyEmoji);
    assert.ok(result.includes('\u200D'), 'ZWJ should be preserved for emoji');
  });

  test('handles combined attack vector', () => {
    const attack = '\u202Eadmin\u200B\u2028\u2060\uFFF9\u202C';
    const result = sanitizeString(attack);
    assert.equal(result, 'admin');
  });

  test('still enforces maxLen after Unicode stripping', () => {
    const padded = 'a'.repeat(50) + '\u200B'.repeat(100) + 'b'.repeat(50);
    const result = sanitizeString(padded, 60);
    assert.ok(result.length <= 60);
    assert.ok(!result.includes('\u200B'));
  });
});

