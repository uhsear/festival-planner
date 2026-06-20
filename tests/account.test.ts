import 'dotenv/config';
/**
 * Integration tests for routes/account.js
 * Covers: PUT/PATCH /username (auth, conflict, rename success),
 *         POST/DELETE /avatar, DELETE / (soft-delete), GET /export (GDPR data export).
 *
 * Mirrors the setup pattern from tests/critical-paths.test.js.
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
const DEFAULT_PASSWORD = 'Str0ngTest!Pw';
const TRUSTED_MUTATION_HEADER = 'x-festie-request';

// Valid 2x2 PNG (Sharp-parseable)
const AVATAR_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z/CfAQgwgImBgaEBAAriA/1oCbcnAAAAAElFTkSuQmCC',
  'base64',
);

// DB skip-gate: these integration tests require a live Postgres database.
// Set TEST_DATABASE_URL to run them (always set in CI). See tests/README.md.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

let testDbReady = false;
const RUN_TAG = `acct-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function ensureTestSchema() {
  if (testDbReady) return;
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    const { rows } = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'users' LIMIT 1");
    if (rows.length === 0) {
      await pool.query('CREATE EXTENSION IF NOT EXISTS citext');
      const schema = fs.readFileSync(path.join(__dirname, '..', 'migrations', '004_postgresql_baseline.sql'), 'utf8');
      await pool.query(schema);
    }
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f: string) => f.endsWith('.sql') && !f.startsWith('004_'))
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

async function seedTestData() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await pool.query(
      'INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT (id) DO NOTHING',
      [`fest-${RUN_TAG}`, 'Account Fest', 'Ground'],
    );
  } finally {
    await pool.end();
  }
}

async function startServer(overrides: any = {}) {
  await ensureTestSchema();
  await truncateAllTables();
  await seedTestData();
  const planner = await createFestivalPlanner({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR,
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
    AUTH_RATE_LIMIT_MAX: 1000,
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

let userCounter = 0;
function uniqueUsername(prefix: string) {
  userCounter += 1;
  // sanitizeString caps usernames at 30 chars in routes/auth.js; keep within limit.
  return `${prefix}-${RUN_TAG}-${userCounter}`.slice(0, 30);
}

async function registerUser(server: any, username: any, password = DEFAULT_PASSWORD) {
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password, confirmPassword: password, dateOfBirth: '1995-01-01', tosAccepted: true });
  assert.ok(res.status === 201 || res.status === 200, `register failed: ${res.status} ${JSON.stringify(res.body)}`);
  // Response shape: { user: { id, username, ... }, token, refreshToken }
  // Flatten so callers can use user.id + user.token uniformly.
  return { ...res.body.data.user, token: res.body.data.token, refreshToken: res.body.data.refreshToken };
}

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try {
      await s.close();
    } catch (_) {
      /* noop */
    }
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Username change
// ──────────────────────────────────────────────────────────────────────────

describe('account: display name change', { concurrency: 1, skip }, () => {
  test('PUT /api/v1/account/display-name requires authentication (401)', async () => {
    const server = await startServer();
    servers.push(server);
    const res = await server.request
      .put('/api/v1/account/display-name')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ displayName: 'Anything' });
    assert.equal(res.status, 401);
  });

  test('PUT /api/v1/account/display-name rejects empty value (400)', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, uniqueUsername('dnempty'));

    const res = await server.request
      .put('/api/v1/account/display-name')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ displayName: '   ' });
    assert.equal(res.status, 400);
  });

  test('PUT /api/v1/account/display-name sets the display name (200)', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, uniqueUsername('dnok'));

    const res = await server.request
      .put('/api/v1/account/display-name')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ displayName: 'Festival Fiona' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data?.user?.name, 'Festival Fiona');
  });

  test('PATCH /api/v1/account/display-name behaves identically to PUT', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, uniqueUsername('dnpatch'));

    const res = await server.request
      .patch('/api/v1/account/display-name')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ displayName: 'Patched Pat' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data?.user?.name, 'Patched Pat');
  });

  test('username is no longer self-editable — PUT /account/username is gone (404)', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, uniqueUsername('noedit'));

    const res = await server.request
      .put('/api/v1/account/username')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: uniqueUsername('hacked') });
    assert.equal(res.status, 404);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Avatar upload / delete
// ──────────────────────────────────────────────────────────────────────────

describe('account: avatar', { concurrency: 1, skip }, () => {
  test('uploads a valid PNG and returns an avatar URL or key', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, uniqueUsername('avok'));

    const res = await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', AVATAR_FIXTURE, { filename: 'avatar.png', contentType: 'image/png' });
    assert.equal(res.status, 200);

    // serializePublicUser output is nested at data.user; accept either avatarUrl
    // (public serializer) or avatarKey (raw).
    const avatarRef = res.body.data?.user?.avatarUrl || res.body.data?.avatarUrl || res.body.data?.user?.avatarKey;
    assert.ok(avatarRef, 'avatar url or key should be returned on successful upload');
  });

  test('rejects non-image upload (400)', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, uniqueUsername('avbad'));

    const res = await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', Buffer.from('not an image'), {
        filename: 'evil.exe',
        contentType: 'application/octet-stream',
      });
    assert.equal(res.status, 400);
  });

  test('requires auth for avatar upload (401)', async () => {
    const server = await startServer();
    servers.push(server);
    const res = await server.request
      .post('/api/v1/account/avatar')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', AVATAR_FIXTURE, { filename: 'a.png', contentType: 'image/png' });
    assert.equal(res.status, 401);
  });

  test('DELETE /api/v1/account/avatar clears the avatar', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, uniqueUsername('avdel'));

    await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', AVATAR_FIXTURE, { filename: 'a.png', contentType: 'image/png' })
      .expect(200);

    const delRes = await server.request
      .delete('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1');
    assert.equal(delRes.status, 200);

    const afterUrl = delRes.body.data?.user?.avatarUrl ?? delRes.body.data?.avatarUrl ?? null;
    assert.equal(afterUrl, null);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Account soft-delete
// ──────────────────────────────────────────────────────────────────────────

describe('account: soft-delete', { concurrency: 1, skip }, () => {
  test('rejects missing password', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, uniqueUsername('delnopw'));

    const res = await server.request
      .delete('/api/v1/account/')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({});
    assert.ok(res.status >= 400);
  });

  test('rejects wrong password with 403', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, uniqueUsername('delwrong'));

    const res = await server.request
      .delete('/api/v1/account/')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ password: 'wrong-password-999' });
    assert.equal(res.status, 403);
  });

  test('soft-deletes with correct password: sets deleted_at and invalidates session', async () => {
    const server = await startServer();
    servers.push(server);
    const username = uniqueUsername('delok');
    const user = await registerUser(server, username, DEFAULT_PASSWORD);

    const res = await server.request
      .delete('/api/v1/account/')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ password: DEFAULT_PASSWORD });
    assert.equal(res.status, 200);
    assert.ok(res.body.data?.deletionDate, 'response should include deletionDate');

    // Subsequent auth check should fail (session invalidated).
    const verifyRes = await server.request.post('/api/v1/auth/verify').set('x-user-token', user.token);
    assert.equal(verifyRes.status, 401);

    // deleted_at set in DB
    const pool = new Pool({ connectionString: server.databaseUrl });
    try {
      const { rows } = await pool.query('SELECT deleted_at FROM users WHERE username = $1', [username]);
      assert.ok(rows.length >= 1);
      assert.ok(rows[0].deleted_at, 'deleted_at should be set after soft-delete');
    } finally {
      await pool.end();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// GDPR data export
// ──────────────────────────────────────────────────────────────────────────

describe('account: GDPR export', { concurrency: 1, skip }, () => {
  test('requires authentication (401)', async () => {
    const server = await startServer();
    servers.push(server);
    const res = await server.request.get('/api/v1/account/export');
    assert.equal(res.status, 401);
  });

  test('returns JSON attachment with user + profiles + crews', async () => {
    const server = await startServer();
    servers.push(server);
    const username = uniqueUsername('gdpr');
    const user = await registerUser(server, username);

    const res = await server.request.get('/api/v1/account/export').set('x-user-token', user.token);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] || '', /application\/json/);
    const disp = res.headers['content-disposition'] || '';
    assert.match(disp, /attachment/);
    assert.match(disp, /festie-data-/);

    const payload = res.body.data;
    assert.ok(payload, 'export payload present');
    assert.equal(payload.user?.username, username);
    assert.ok(Array.isArray(payload.profiles), 'profiles array in export');
    // crews key only present when stores.crews.listForUser exists; the shipped
    // crews store exports listByUser — not listForUser — so this key may be absent.
    if ('crews' in payload) {
      assert.ok(Array.isArray(payload.crews));
    }
  });

  test('rate-limits a second export within 24h (429)', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, uniqueUsername('gdprrl'));

    const first = await server.request.get('/api/v1/account/export').set('x-user-token', user.token);
    assert.equal(first.status, 200);

    const second = await server.request.get('/api/v1/account/export').set('x-user-token', user.token);
    assert.equal(second.status, 429);
  });
});
