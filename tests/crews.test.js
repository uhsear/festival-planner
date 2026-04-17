require('dotenv').config();
/**
 * Integration tests for routes/crews.js
 * Covers: crew create/get, invite-code join & rotation, membership queries,
 *         expired invite, delete behavior, error paths.
 *
 * Response shape (verified against routes/crews.js::serializeCrewWithMembers):
 *   { id, festivalId, name, createdBy, maxMembers, createdAt, updatedAt,
 *     role, joinedAt, inviteCode, inviteExpiresAt,          // invite* only for owner
 *     members: [{ userId, username, avatarKey, avatarVersion, role, joinedAt }],
 *     memberCount }
 *
 * Invite regen response: { inviteCode, inviteExpiresAt } (no crew body)
 *
 * Note: The production crews store's `delete(crewId)` is a HARD delete, not a
 * soft-delete. Post-delete the crew is gone from listByUser and getById → 404.
 *
 * Mirrors the setup pattern from tests/critical-paths.test.js.
 */
'use strict';

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
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

let testDbReady = false;
const RUN_TAG = `crews-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function createFestivalFixture() {
  return [{
    id: `fest-${RUN_TAG}`,
    name: 'Crew Test Fest',
    location: 'Test Grounds',
    stages: [{ id: 'main', name: 'Main Stage', color: '#ff3366' }],
    days: [{
      label: 'Friday',
      date: '2026-06-05',
      sets: [
        { id: `set-${RUN_TAG}-a`, artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' },
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
        path.join(__dirname, '..', 'migrations', '004_postgresql_baseline.sql'),
        'utf8'
      );
      await pool.query(schema);
    }
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') && !f.startsWith('004_'))
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
  } finally {
    await pool.end();
  }
}

async function startServer(overrides = {}) {
  await ensureTestSchema();
  await truncateAllTables();
  await seedTestData();
  const planner = createFestivalPlanner({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR,
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
    ...overrides,
  });
  await new Promise((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  return {
    planner,
    databaseUrl: TEST_DATABASE_URL,
    festivalId: `fest-${RUN_TAG}`,
    request: request(planner.app),
    async close() { await planner.close(); },
  };
}

let userCounter = 0;
function uniqueUsername(prefix) {
  userCounter += 1;
  return `${prefix}-${RUN_TAG}-${userCounter}`.slice(0, 30);
}

async function registerUser(server, username) {
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, tosAccepted: true })
    .expect(201);
  // Response shape: { user: { id, username, ... }, token, refreshToken }
  // Flatten so callers can use user.id + user.token uniformly.
  return { ...res.body.data.user, token: res.body.data.token, refreshToken: res.body.data.refreshToken };
}

async function joinFestival(server, userToken, festivalId = server.festivalId) {
  const res = await server.request
    .post('/api/v1/profiles')
    .set('x-user-token', userToken)
    .send({ festivalId })
    .expect(200);
  return res.body.data;
}

async function createMember(server, prefix = 'user') {
  const user = await registerUser(server, uniqueUsername(prefix));
  await joinFestival(server, user.token);
  return user;
}

async function createCrew(server, token, name = `Crew ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`) {
  const res = await server.request
    .post('/api/v1/crews')
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ name, festivalId: server.festivalId })
    .expect(201);
  return res.body.data;
}

const servers = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try { await s.close(); } catch (_) { /* noop */ }
  }
});

describe('crews routes', { concurrency: 1, skip }, () => {
  test('POST /api/v1/crews creates a crew for a festival member', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await createMember(server, 'owner');

    const res = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ name: 'Sunset Crew', festivalId: server.festivalId })
      .expect(201);

    assert.equal(res.body.data.name, 'Sunset Crew');
    assert.equal(res.body.data.festivalId, server.festivalId);
    assert.equal(res.body.data.role, 'owner');
    assert.ok(res.body.data.id, 'crew id returned');
    assert.ok(res.body.data.inviteCode, 'owner should see invite code');
    assert.ok(Array.isArray(res.body.data.members));
    assert.equal(res.body.data.members.length, 1);
    assert.equal(res.body.data.memberCount, 1);
    assert.equal(res.body.data.members[0].userId, user.id);
    // Member shape (avatarKey/avatarVersion also present but nullable)
    assert.equal(res.body.data.members[0].role, 'owner');
    assert.equal(typeof res.body.data.members[0].username, 'string');
    assert.ok(res.body.data.members[0].joinedAt);
  });

  test('POST /api/v1/crews rejects missing name with 400', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await createMember(server);

    const res = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ festivalId: server.festivalId });
    assert.equal(res.status, 400);
  });

  test('POST /api/v1/crews rejects non-festival-member with 403', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, uniqueUsername('noprofile'));

    const res = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ name: 'NoProfile', festivalId: server.festivalId });
    assert.equal(res.status, 403);
  });

  test('GET /api/v1/crews/:crewId returns the crew for a member', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await createMember(server, 'owner');
    const crew = await createCrew(server, user.token);

    const res = await server.request
      .get(`/api/v1/crews/${crew.id}`)
      .set('x-user-token', user.token)
      .expect(200);

    assert.equal(res.body.data.id, crew.id);
    assert.equal(res.body.data.role, 'owner');
    assert.ok(Array.isArray(res.body.data.members));
    assert.equal(res.body.data.memberCount, 1);
  });

  test('GET /api/v1/crews/:crewId returns 404 for unknown crew', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await createMember(server);

    const res = await server.request
      .get('/api/v1/crews/nonexistent-crew-id')
      .set('x-user-token', user.token);
    assert.equal(res.status, 404);
  });

  test('GET /api/v1/crews/:crewId returns 403 for non-members', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const outsider = await createMember(server, 'outsider');
    const crew = await createCrew(server, owner.token);

    const res = await server.request
      .get(`/api/v1/crews/${crew.id}`)
      .set('x-user-token', outsider.token);
    assert.equal(res.status, 403);
  });

  test('GET /api/v1/crews/:crewId exposes members with userId/username/role/joinedAt', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const member = await createMember(server, 'member');
    const crew = await createCrew(server, owner.token);

    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', member.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ inviteCode: crew.inviteCode })
      .expect(200);

    const res = await server.request
      .get(`/api/v1/crews/${crew.id}`)
      .set('x-user-token', owner.token)
      .expect(200);

    assert.equal(res.body.data.memberCount, 2);
    const mRow = res.body.data.members.find((m) => m.userId === member.id);
    assert.ok(mRow, 'member row present');
    assert.equal(mRow.role, 'member');
    assert.ok(mRow.joinedAt, 'joinedAt present');
    assert.equal(typeof mRow.username, 'string');
  });

  test('DELETE /api/v1/crews/:crewId as owner removes crew', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const crew = await createCrew(server, owner.token);

    await server.request
      .delete(`/api/v1/crews/${crew.id}`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    // Hard-deleted — should no longer appear in owner's list
    const listRes = await server.request
      .get('/api/v1/crews')
      .set('x-user-token', owner.token)
      .expect(200);
    assert.ok(!listRes.body.data.some((c) => c.id === crew.id),
      'deleted crew should not appear in list');

    // Direct fetch should be 404 (getById returns null after hard delete)
    const getRes = await server.request
      .get(`/api/v1/crews/${crew.id}`)
      .set('x-user-token', owner.token);
    assert.equal(getRes.status, 404);
  });

  test('DELETE /api/v1/crews/:crewId rejects non-owners (403)', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const member = await createMember(server, 'member');
    const crew = await createCrew(server, owner.token);

    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', member.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ inviteCode: crew.inviteCode })
      .expect(200);

    const res = await server.request
      .delete(`/api/v1/crews/${crew.id}`)
      .set('x-user-token', member.token)
      .set(TRUSTED_MUTATION_HEADER, '1');
    assert.equal(res.status, 403);
  });

  test('POST /api/v1/crews/join accepts a valid invite code', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const joiner = await createMember(server, 'joiner');
    const crew = await createCrew(server, owner.token);

    const res = await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', joiner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ inviteCode: crew.inviteCode })
      .expect(200);

    assert.equal(res.body.data.id, crew.id);
    assert.equal(res.body.data.role, 'member');
    // Non-owner should not receive invite code (serializeCrew gates on role).
    assert.equal(res.body.data.inviteCode, undefined);
  });

  test('POST /api/v1/crews/join rejects unknown codes with 404', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await createMember(server);

    const res = await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ inviteCode: 'ZZZZZZ' });
    assert.equal(res.status, 404);
  });

  test('POST /api/v1/crews/join rejects duplicate join (owner re-joining own crew) with 400', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const crew = await createCrew(server, owner.token);

    const res = await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ inviteCode: crew.inviteCode });
    assert.equal(res.status, 400);
  });

  test('expired invite code returns 410 Gone', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const joiner = await createMember(server, 'joiner');
    const crew = await createCrew(server, owner.token);

    const pool = new Pool({ connectionString: server.databaseUrl });
    try {
      await pool.query(
        "UPDATE crews SET invite_expires_at = NOW() - INTERVAL '1 day' WHERE id = $1",
        [crew.id],
      );
    } finally {
      await pool.end();
    }

    const res = await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', joiner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ inviteCode: crew.inviteCode });
    assert.equal(res.status, 410);
  });

  test('POST /:crewId/invite rotates code — old invalid, new works', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const joiner = await createMember(server, 'joiner');
    const crew = await createCrew(server, owner.token);
    const oldCode = crew.inviteCode;

    const rotateRes = await server.request
      .post(`/api/v1/crews/${crew.id}/invite`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    // Invite regen response shape is { inviteCode, inviteExpiresAt } — NOT a full
    // crew body.
    const newCode = rotateRes.body.data.inviteCode;
    assert.ok(newCode, 'new invite code returned');
    assert.notEqual(newCode, oldCode);
    assert.ok(rotateRes.body.data.inviteExpiresAt, 'inviteExpiresAt returned');

    // Old code no longer works.
    const oldRes = await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', joiner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ inviteCode: oldCode });
    assert.equal(oldRes.status, 404);

    // New code works.
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', joiner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ inviteCode: newCode })
      .expect(200);
  });
});
