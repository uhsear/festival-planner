import 'dotenv/config';
/**
 * Integration tests for routes/crew-features.js
 * Covers: crew polls (create/list/vote/close) + meeting points (create/list/update/delete/home-base).
 *
 * NOTE: The actual routes/crew-features.js does NOT expose any expense routes.
 * Expense test blocks from the old parked file were removed to match real routes.
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
const DEFAULT_PASSWORD = 'password123';
const TRUSTED_MUTATION_HEADER = 'x-festie-request';

// DB skip-gate: these integration tests require a live Postgres database.
// Set TEST_DATABASE_URL to run them (always set in CI). See tests/README.md.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

let testDbReady = false;
const RUN_TAG = `cf${Date.now().toString(36)}`;

function createFestivalFixture() {
  return [{
    id: `fest-${RUN_TAG}`,
    name: 'Crew Features Fest',
    location: 'Ground',
    stages: [{ id: 'main', name: 'Main Stage', color: '#ff3366' }],
    days: [{
      label: 'Friday',
      date: '2026-06-05',
      sets: [
        { id: `set-${RUN_TAG}`, artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' },
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

async function seedTestData(festivals = createFestivalFixture()) {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    for (const festival of festivals) {
      await pool.query(
        'INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT (id) DO NOTHING',
        [festival.id, festival.name, festival.location]
      );
      for (let si = 0; si < (festival.stages || []).length; si++) {
        const stage = festival.stages[si]!;
        await pool.query(
          'INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
          [festival.id, stage.id, stage.name, stage.color, si]
        );
      }
      for (let di = 0; di < (festival.days || []).length; di++) {
        const day = festival.days[di]!;
        await pool.query(
          'INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [festival.id, di, day.label, day.date]
        );
        for (let sei = 0; sei < (day.sets || []).length; sei++) {
          const set = day.sets[sei]!;
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
    ...overrides,
  });
  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  return {
    planner,
    databaseUrl: TEST_DATABASE_URL,
    festivalId: `fest-${RUN_TAG}`,
    request: request(planner.app),
    async close() { await planner.close(); },
  };
}

let userCounter = 0;
function uniqueUsername(prefix: string) {
  userCounter += 1;
  return `${prefix}-${RUN_TAG}-${userCounter}`;
}

async function registerUser(server: any, username: any) {
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, tosAccepted: true })
    .expect(201);
  return res.body.data;
}

async function joinFestival(server: any, token: any) {
  const res = await server.request
    .post('/api/v1/profiles')
    .set('x-user-token', token)
    .send({ festivalId: server.festivalId })
    .expect(200);
  return res.body.data;
}

async function createMember(server: any, prefix = 'user') {
  const user = await registerUser(server, uniqueUsername(prefix));
  await joinFestival(server, user.token);
  return user;
}

async function createCrew(server: any, token: any) {
  const res = await server.request
    .post('/api/v1/crews')
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ name: `Crew ${Date.now()}`, festivalId: server.festivalId })
    .expect(201);
  return res.body.data;
}

async function joinCrew(server: any, token: any, inviteCode: any) {
  const res = await server.request
    .post('/api/v1/crews/join')
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ inviteCode })
    .expect(200);
  return res.body.data;
}

// poll.id may be camelCase or snake_case depending on store layer
function pollIdOf(poll: any) {
  if (!poll) return null;
  return poll.id || poll.pollId || poll.poll_id || null;
}

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try { await s.close(); } catch (_) { /* noop */ }
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// Polls
// ════════════════════════════════════════════════════════════════════════════════

describe('crew polls', { concurrency: 1, skip }, () => {
  test('POST /:crewId/polls creates a poll with 2+ options', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const crew = await createCrew(server, owner.token);

    const res = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        question: 'Where to meet for the headliner?',
        options: ['Main Stage', 'Food Trucks'],
      });
    assert.ok([200, 201].includes(res.status),
      `expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.data.poll, 'poll object should be returned');
    assert.ok(pollIdOf(res.body.data.poll), 'poll should have an id');
  });

  test('POST /:crewId/polls rejects non-members with 403', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const outsider = await createMember(server, 'outsider');
    const crew = await createCrew(server, owner.token);

    const res = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', outsider.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Hack?', options: ['yes', 'no'] });
    assert.equal(res.status, 403);
  });

  test('POST /:crewId/polls rejects fewer than 2 options', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const crew = await createCrew(server, owner.token);

    const res = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Bad poll', options: ['only one'] });
    assert.equal(res.status, 400);
  });

  test('GET /:crewId/polls lists polls for a member', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const crew = await createCrew(server, owner.token);

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Food?', options: ['A', 'B'] });

    const res = await server.request
      .get(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', owner.token)
      .expect(200);
    assert.ok(Array.isArray(res.body.data.polls));
    assert.ok(res.body.data.polls.length >= 1);
  });

  test('GET /:crewId/polls rejects non-members with 403', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const outsider = await createMember(server, 'outsider');
    const crew = await createCrew(server, owner.token);

    const res = await server.request
      .get(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', outsider.token);
    assert.equal(res.status, 403);
  });

  test('POST /:crewId/polls/:pollId/vote records a vote from a member', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const member = await createMember(server, 'member');
    const crew = await createCrew(server, owner.token);
    await joinCrew(server, member.token, crew.inviteCode);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Stage?', options: ['Main', 'Forest', 'Dome'] });
    assert.ok([200, 201].includes(createRes.status));
    const pollId = pollIdOf(createRes.body.data.poll);
    assert.ok(pollId, 'poll id required to vote');

    const voteRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', member.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 1 })
      .expect(200);
    assert.equal(voteRes.body.data.voted, true);
  });

  test('POST /:crewId/polls/:pollId/vote rejects out-of-range optionIndex with 400', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const crew = await createCrew(server, owner.token);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Stage?', options: ['Main', 'Forest'] });
    const pollId = pollIdOf(createRes.body.data.poll);
    assert.ok(pollId);

    const res = await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 99 });
    assert.equal(res.status, 400);
  });

  test('DELETE /:crewId/polls/:pollId closes a poll (creator)', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const crew = await createCrew(server, owner.token);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Close me', options: ['yes', 'no'] });
    const pollId = pollIdOf(createRes.body.data.poll);
    assert.ok(pollId);

    const closeRes = await server.request
      .delete(`/api/v1/crews/${crew.id}/polls/${pollId}`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);
    assert.ok('closed' in closeRes.body.data);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Meeting points
// ════════════════════════════════════════════════════════════════════════════════

describe('crew meeting points', { concurrency: 1, skip }, () => {
  test('POST /:crewId/meeting-points creates a meeting point for a member', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const crew = await createCrew(server, owner.token);

    const res = await server.request
      .post(`/api/v1/crews/${crew.id}/meeting-points`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        label: 'The big tree',
        location: 'North of the Forest Stage',
        type: 'during',
      });
    // Route uses sendSuccess(res, ..., 201)
    assert.ok([200, 201].includes(res.status),
      `unexpected status ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.data.meetingPoint);
    assert.ok(res.body.data.meetingPoint.id);
    assert.equal(res.body.data.meetingPoint.label, 'The big tree');
  });

  test('POST /:crewId/meeting-points rejects non-members with 403', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const outsider = await createMember(server, 'outsider');
    const crew = await createCrew(server, owner.token);

    const res = await server.request
      .post(`/api/v1/crews/${crew.id}/meeting-points`)
      .set('x-user-token', outsider.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ label: 'Bad', location: 'Nowhere', type: 'during' });
    assert.equal(res.status, 403);
  });

  test('GET /:crewId/meeting-points returns the list for a member', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const crew = await createCrew(server, owner.token);

    await server.request
      .post(`/api/v1/crews/${crew.id}/meeting-points`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ label: 'Pin A', location: 'Here', type: 'during' });

    const res = await server.request
      .get(`/api/v1/crews/${crew.id}/meeting-points`)
      .set('x-user-token', owner.token)
      .expect(200);
    assert.ok(Array.isArray(res.body.data.meetingPoints));
    assert.ok(res.body.data.meetingPoints.length >= 1);
  });

  test('PUT /:crewId/meeting-points/:mpId updates a point (creator)', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const crew = await createCrew(server, owner.token);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/meeting-points`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ label: 'Orig', location: 'A', type: 'during' });
    assert.ok([200, 201].includes(createRes.status));
    const mpId = createRes.body.data.meetingPoint.id;

    const updateRes = await server.request
      .put(`/api/v1/crews/${crew.id}/meeting-points/${mpId}`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ label: 'Updated', location: 'B', type: 'during' })
      .expect(200);

    assert.ok(updateRes.body.data.meetingPoint);
    assert.equal(updateRes.body.data.meetingPoint.label, 'Updated');
  });

  test('PUT /:crewId/meeting-points/:mpId rejects non-creator non-owner with 403', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const member = await createMember(server, 'member');
    const crew = await createCrew(server, owner.token);
    await joinCrew(server, member.token, crew.inviteCode);

    // Member creates a meeting point.
    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/meeting-points`)
      .set('x-user-token', member.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ label: 'Mine', location: 'X', type: 'during' });
    assert.ok([200, 201].includes(createRes.status));
    const mpId = createRes.body.data.meetingPoint.id;

    const other = await createMember(server, 'other');
    await joinCrew(server, other.token, crew.inviteCode);

    const res = await server.request
      .put(`/api/v1/crews/${crew.id}/meeting-points/${mpId}`)
      .set('x-user-token', other.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ label: 'Hack', location: 'Y', type: 'during' });
    assert.equal(res.status, 403);
  });

  test('DELETE /:crewId/meeting-points/:mpId removes (creator) then 404 on subsequent edit', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const crew = await createCrew(server, owner.token);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/meeting-points`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ label: 'To remove', location: 'Z', type: 'during' });
    const mpId = createRes.body.data.meetingPoint.id;

    await server.request
      .delete(`/api/v1/crews/${crew.id}/meeting-points/${mpId}`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    const again = await server.request
      .put(`/api/v1/crews/${crew.id}/meeting-points/${mpId}`)
      .set('x-user-token', owner.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ label: 'nope', location: 'Z', type: 'during' });
    assert.equal(again.status, 404);
  });

  test('DELETE /:crewId/meeting-points/:mpId rejects non-creator non-owner with 403', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const member = await createMember(server, 'member');
    const crew = await createCrew(server, owner.token);
    await joinCrew(server, member.token, crew.inviteCode);

    // Member creates a point
    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/meeting-points`)
      .set('x-user-token', member.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ label: 'MemberMP', location: 'Q', type: 'during' });
    const mpId = createRes.body.data.meetingPoint.id;

    // Another plain member tries to delete it
    const other = await createMember(server, 'other');
    await joinCrew(server, other.token, crew.inviteCode);

    const res = await server.request
      .delete(`/api/v1/crews/${crew.id}/meeting-points/${mpId}`)
      .set('x-user-token', other.token)
      .set(TRUSTED_MUTATION_HEADER, '1');
    assert.equal(res.status, 403);
  });

  test('PUT /:crewId/home-base requires owner (non-owner 403)', async () => {
    const server = await startServer();
    servers.push(server);
    const owner = await createMember(server, 'owner');
    const member = await createMember(server, 'member');
    const crew = await createCrew(server, owner.token);
    await joinCrew(server, member.token, crew.inviteCode);

    const res = await server.request
      .put(`/api/v1/crews/${crew.id}/home-base`)
      .set('x-user-token', member.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ location: 'Fountain', time: '18:00' });
    assert.equal(res.status, 403);
  });
});

// NOTE: Expense routes skipped — routes/crew-features.js does not implement any
// expense endpoints. (Old parked tests referenced nonexistent expense APIs.)
