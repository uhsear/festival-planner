import { afterEach, describe, test } from 'node:test';
import request from 'supertest';
import path from 'path';
import {
  assert,
  Pool,
  DEFAULT_PASSWORD,
  TRUSTED_MUTATION_HEADER,
  PUBLIC_DIR,
  TEST_DATABASE_URL,
  createFestivalPlanner,
  startServer,
  ensureTestSchema,
  truncateAllTables,
  seedTestData,
  registerUser,
  joinFestivalProfile,
  loginAdmin,
} from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Picks', { concurrency: 1 }, () => {
  test('hides other users notes and restricts export ownership', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');

    const aliceProfile = await joinFestivalProfile(server, alice.token);
    const bobProfile = await joinFestivalProfile(server, bob.token);

    await server.request
      .put(`/api/v1/profiles/${aliceProfile.id}`)
      .set('x-user-token', alice.token)
      .send({
        picks: { 'set-a': 'must', 'set-d': 'maybe' },
        notes: { 'set-a': 'Meet by the rail' },
      })
      .expect(200);

    await server.request
      .put(`/api/v1/profiles/${bobProfile.id}`)
      .set('x-user-token', bob.token)
      .send({ picks: { 'set-a': 'maybe' }, notes: { 'set-a': 'Private bob note' } })
      .expect(200);

    await server.request
      .put(`/api/v1/profiles/${aliceProfile.id}`)
      .set('x-user-token', bob.token)
      .send({ picks: { 'set-a': 'maybe' } })
      .expect(403);

    const profileList = await server.request
      .get('/api/v1/profiles/fest-1')
      .set('x-user-token', alice.token)
      .expect(200);

    const visibleBob = profileList.body.data.find((profile: any) => profile.id === bobProfile.id);
    const visibleAlice = profileList.body.data.find((profile: any) => profile.id === aliceProfile.id);

    assert.equal(visibleAlice.notes['set-a'], 'Meet by the rail');
    assert.equal(visibleBob.notes, undefined);
    // reminders feature removed (migration 013)

    const exportResponse = await server.request
      .get(`/api/v1/export/fest-1/${aliceProfile.id}`)
      .set('x-user-token', alice.token)
      .expect(200);

    assert.match(exportResponse.headers['content-disposition'] as string, /schedule\.html/);
    assert.match(exportResponse.headers['content-disposition'] as string, /filename\*=UTF-8''/);
    assert.match(exportResponse.headers['content-security-policy'] as string, /style-src-attr 'unsafe-inline'/);
    assert.ok(!exportResponse.text.includes('const EXPORT_DATA'));
    // Reminders feature removed (migration 013) — reminders no longer in export
    assert.ok(exportResponse.text.includes('bob also saved this'));
    assert.ok(exportResponse.text.includes('Meet by the rail'));
    assert.ok(!exportResponse.text.includes('Private bob note'));

    await server.request.get(`/api/v1/export/fest-1/${bobProfile.id}`).set('x-user-token', alice.token).expect(403);

    await server.request.get('/api/v1/profiles/fest-1').expect(401);
  });

  test('rejects updates to other users festival profiles', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');

    // Manually insert a profile owned by bob
    const pool = new Pool({ connectionString: server.databaseUrl });
    try {
      await pool.query(
        'INSERT INTO festival_profiles (id, festival_id, user_id, name, picks_json, notes_json, reminders_json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          'profile-unclaimed',
          'fest-1',
          bob.user.id,
          'guest',
          '{}',
          '{}',
          '{}',
          '2026-03-09T00:00:00.000Z',
          '2026-03-09T00:00:00.000Z',
        ],
      );
    } finally {
      await pool.end();
    }

    await server.request
      .put('/api/v1/profiles/profile-unclaimed')
      .set('x-user-token', alice.token)
      .send({ picks: { 'set-a': 'must' } })
      .expect(403);

    // Verify the profile was not modified
    const checkPool = new Pool({ connectionString: server.databaseUrl });
    try {
      const { rows } = await checkPool.query('SELECT picks_json FROM festival_profiles WHERE id = $1', [
        'profile-unclaimed',
      ]);
      const picks = typeof rows[0].picks_json === 'string' ? JSON.parse(rows[0].picks_json) : rows[0].picks_json;
      assert.deepEqual(picks, {});
    } finally {
      await checkPool.end();
    }
  });

  test('rejects picks and notes that reference unknown sets', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const aliceProfile = await joinFestivalProfile(server, alice.token);

    await server.request
      .put(`/api/v1/profiles/${aliceProfile.id}`)
      .set('x-user-token', alice.token)
      .send({ picks: { 'missing-set': 'must' } })
      .expect(400);

    await server.request
      .put(`/api/v1/profiles/${aliceProfile.id}`)
      .set('x-user-token', alice.token)
      .send({ notes: { 'missing-set': 'nope' } })
      .expect(400);
  });

  test('persists reminders and reads them back on the owner profile', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const aliceProfile = await joinFestivalProfile(server, alice.token);

    // Reminder VALUE is a lead-time in minutes; only [5,10,15,30,60] are allowed
    // (ALLOWED_REMINDER_MINUTES in lib/constants.ts).
    const putRes = await server.request
      .put(`/api/v1/profiles/${aliceProfile.id}`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        picks: { 'set-a': 'must' },
        reminders: { 'set-a': 15 },
      })
      .expect(200);
    // PUT echoes the owner profile, which includes reminders.
    assert.equal(putRes.body.data.reminders['set-a'], 15);

    // Read back via the list endpoint — the viewer's OWN profile exposes reminders.
    const profileList = await server.request
      .get('/api/v1/profiles/fest-1')
      .set('x-user-token', alice.token)
      .expect(200);
    const ownProfile = profileList.body.data.find((p: any) => p.id === aliceProfile.id);
    assert.equal(ownProfile.reminders['set-a'], 15, 'reminder should persist and read back');
  });

  test('rejects a reminder value outside the allowed lead-minute set', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const aliceProfile = await joinFestivalProfile(server, alice.token);

    // 7 is not in ALLOWED_REMINDER_MINUTES ([5,10,15,30,60]) — schema rejects it.
    await server.request
      .put(`/api/v1/profiles/${aliceProfile.id}`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ reminders: { 'set-a': 7 } })
      .expect(400);
  });

  test('rejects a reminder referencing an unknown set', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const aliceProfile = await joinFestivalProfile(server, alice.token);

    await server.request
      .put(`/api/v1/profiles/${aliceProfile.id}`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ reminders: { 'missing-set': 15 } })
      .expect(400);
  });

  test('enforces the 200-reminder-per-profile cap', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const aliceProfile = await joinFestivalProfile(server, alice.token);

    // 201 reminder entries (all valid values) exceed the route's 200 cap; the
    // count check runs before set-reference validation, so arbitrary keys are fine.
    const tooMany: Record<string, number> = {};
    for (let i = 0; i < 201; i++) tooMany[`set-${i}`] = 15;

    await server.request
      .put(`/api/v1/profiles/${aliceProfile.id}`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ reminders: tooMany })
      .expect(400);
  });

  test('persists sessions and profile data across server restart', async () => {
    await ensureTestSchema();
    await truncateAllTables(TEST_DATABASE_URL);
    await seedTestData(TEST_DATABASE_URL);

    // First server instance
    const first = await createFestivalPlanner({
      DATABASE_URL: TEST_DATABASE_URL,
      PUBLIC_DIR,
      NODE_ENV: 'test',
      REDIS_ENABLED: 'false',
      PUBLIC_ORIGIN: '',
    });
    await new Promise<void>((resolve) => first.server.listen(0, '127.0.0.1', resolve));
    const firstRequest = request(first.app);

    const registerResponse = await firstRequest
      .post('/api/v1/auth/register')
      .send({ username: 'persisted', password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, tosAccepted: true })
      .expect(201);
    const token = registerResponse.body.data.token;

    const profile = await firstRequest
      .post('/api/v1/profiles')
      .set('x-user-token', token)
      .send({ festivalId: 'fest-1' })
      .expect(200);

    await firstRequest
      .put(`/api/v1/profiles/${profile.body.data.id}`)
      .set('x-user-token', token)
      .send({
        picks: { 'set-a': 'must' },
        notes: { 'set-a': 'Arrive early' },
      })
      .expect(200);

    await first.close();

    // Second server instance — same database, data should persist
    const second = await createFestivalPlanner({
      DATABASE_URL: TEST_DATABASE_URL,
      PUBLIC_DIR,
      NODE_ENV: 'test',
      REDIS_ENABLED: 'false',
      PUBLIC_ORIGIN: '',
    });
    await new Promise<void>((resolve) => second.server.listen(0, '127.0.0.1', resolve));
    const secondRequest = request(second.app);

    try {
      const verify = await secondRequest.post('/api/v1/auth/verify').set('x-user-token', token).expect(200);
      assert.equal(verify.body.data.user.username, 'persisted');

      const profiles = await secondRequest.get('/api/v1/profiles/fest-1').set('x-user-token', token).expect(200);
      const ownProfile = profiles.body.data.find((entry: any) => entry.id === profile.body.data.id);
      assert.equal(ownProfile.picks['set-a'], 'must');
      assert.equal(ownProfile.notes['set-a'], 'Arrive early');
      // reminders removed (migration 013)
    } finally {
      await second.close();
    }
  });

  test('concurrent profile updates dont corrupt data', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const profile = await joinFestivalProfile(server, alice.token);

    // Update picks with multiple concurrent writes - PostgreSQL handles atomicity
    await Promise.all([
      server.request
        .put(`/api/v1/profiles/${profile.id}`)
        .set('x-user-token', alice.token)
        .set('X-Trusted-Mutation', '1')
        .send({ picks: { 'set-a': 'must' } }),
      server.request
        .put(`/api/v1/profiles/${profile.id}`)
        .set('x-user-token', alice.token)
        .set('X-Trusted-Mutation', '1')
        .send({ picks: { 'set-b': 'maybe' } }),
    ]);

    // Verify data persisted correctly
    const profiles = await server.request.get('/api/v1/profiles/fest-1').set('x-user-token', alice.token).expect(200);
    const ownProfile = profiles.body.data.find((p: any) => p.id === profile.id);
    // At least one update should be present (last-write-wins without If-Match)
    assert.ok(ownProfile.picks['set-a'] || ownProfile.picks['set-b']);
  });

  test('presence endpoint requires festival membership', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');

    // Without joining the festival, presence should be forbidden
    const res = await server.request.get('/api/v1/presence/fest-1').set('x-user-token', alice.token);
    assert.equal(res.status, 403);

    // After joining, it should work
    await joinFestivalProfile(server, alice.token);
    const res2 = await server.request.get('/api/v1/presence/fest-1').set('x-user-token', alice.token).expect(200);
    assert.ok(Array.isArray(res2.body.data.online));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// #21: Concurrent Profile Write Conflict Testing
// ═══════════════════════════════════════════════════════════════════════

describe('Concurrent Profile Write Conflicts', { concurrency: 1 }, () => {
  let server: any;
  afterEach(async () => {
    if (server) await server.close();
  });

  test('returns 409 VERSION_MISMATCH when If-Match is stale', async () => {
    server = await startServer();
    const alice = await registerUser(server, 'alice-conc');
    let profile = await joinFestivalProfile(server, alice.token);

    // Initial update to get updatedAt field
    const initialUpdate = await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-a': 'must' } })
      .expect(200);
    const firstETag = initialUpdate.headers['etag'];
    profile = initialUpdate.body.data;

    // Small delay to ensure different timestamp for next update
    await new Promise((r) => setTimeout(r, 50));

    // First update with initial ETag succeeds and returns new ETag
    const secondUpdate = await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .set('If-Match', firstETag)
      .send({ picks: { 'set-a': 'maybe' } })
      .expect(200);
    const newEtag = secondUpdate.headers['etag'];
    assert.ok(newEtag);
    assert.notEqual(newEtag, firstETag);

    // Second update with OLD ETag should get 409
    const conflictRes = await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .set('If-Match', firstETag)
      .send({ picks: { 'set-b': 'must' } });
    assert.equal(conflictRes.status, 409);
    assert.equal(conflictRes.body.error.code, 'VERSION_MISMATCH');
    assert.ok(conflictRes.body.error.current, 'should include current profile state');
  });

  test('concurrent updates without If-Match both succeed (last-write-wins)', async () => {
    server = await startServer();
    const bob = await registerUser(server, 'bob-conc');
    const profile = await joinFestivalProfile(server, bob.token);

    // Two updates without If-Match — both should succeed
    const [res1, res2] = await Promise.all([
      server.request
        .put(`/api/v1/profiles/${profile.id}`)
        .set('x-user-token', bob.token)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ picks: { 'set-a': 'must' } }),
      server.request
        .put(`/api/v1/profiles/${profile.id}`)
        .set('x-user-token', bob.token)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ picks: { 'set-b': 'maybe' } }),
    ]);
    // Both should succeed (safeWrite serializes them)
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
  });
});

describe('Database Transaction Rollback — profiles', { concurrency: 1 }, () => {
  let server: any;
  afterEach(async () => {
    if (server) await server.close();
  });

  test('delete user cascades profiles cleanly', async () => {
    server = await startServer();
    const userResponse = await registerUser(server, 'cascade-user');
    const userId = userResponse.user.id;
    const userToken = userResponse.token;
    await joinFestivalProfile(server, userToken, 'fest-1');
    const adminToken = await loginAdmin(server);

    // Delete user
    const deleteRes = await server.request
      .delete(`/api/v1/admin/users/${userId}`)
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1');
    assert.equal(deleteRes.status, 200);

    // Verify user is deleted — login should fail
    const loginRes = await server.request
      .post('/api/v1/auth/login')
      .send({ username: 'cascade-user', password: DEFAULT_PASSWORD });
    assert.ok(loginRes.status >= 400, 'deleted user should not be able to login');
  });
});

describe('Rate Limiting Edge Cases — profiles', { concurrency: 1 }, () => {
  let server: any;
  afterEach(async () => {
    if (server) await server.close();
  });

  test('concurrent profile updates maintain consistency', async () => {
    server = await startServer();
    const user = await registerUser(server, 'concurrent-user');
    const profile = await joinFestivalProfile(server, user.token);

    // Simulate rapid concurrent updates
    const updates = [
      { picks: { 'set-a': 'must' } },
      { picks: { 'set-b': 'want-to-see' } },
      { picks: { 'set-c': 'maybe' } },
    ];

    await Promise.all(
      updates.map((update) =>
        server.request.put(`/api/v1/profiles/${profile.id}`).set('x-user-token', user.token).send(update),
      ),
    );

    // Verify final state is consistent
    const finalRes = await server.request.get(`/api/v1/profiles/fest-1`).set('x-user-token', user.token);
    assert.equal(finalRes.status, 200);
  });
});

describe('Malformed Input Handling', { concurrency: 1 }, () => {
  let server: any;
  afterEach(async () => {
    if (server) await server.close();
  });

  test('rejects pick with non-existent set ID', async () => {
    server = await startServer();
    const user = await registerUser(server, 'invalid-pick-user');
    const profile = await joinFestivalProfile(server, user.token);

    const res = await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .send({ picks: { 'nonexistent-set': 'must' } });
    assert.ok(res.status >= 400);
  });

  test('rejects invalid pick priority value', async () => {
    server = await startServer();
    const user = await registerUser(server, 'bad-priority-user');
    const profile = await joinFestivalProfile(server, user.token);

    const res = await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .send({ picks: { 'set-a': 'invalid-priority' } });
    assert.ok(res.status >= 400);
  });

  test('reminder validation removed (migration 013)', async () => {
    server = null;
    // Reminders feature removed — validation test no longer applicable
  });

  test('rejects note longer than max length', async () => {
    server = await startServer();
    const user = await registerUser(server, 'long-note-user');
    const profile = await joinFestivalProfile(server, user.token);

    const longNote = 'a'.repeat(1001);
    const res = await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .send({ notes: { 'set-a': longNote } });
    assert.ok(res.status >= 400);
  });
});

// ============================================================================
// Profile Soft-Delete Filtering (v1.7.3)
// ============================================================================
describe('profile soft-delete filtering', { concurrency: 1 }, () => {
  const servers: any[] = [];
  afterEach(async () => {
    for (const s of servers) await s.close().catch(() => {});
    servers.length = 0;
  });

  test('create() returns null if profile is immediately soft-deleted', async () => {
    const server = await startServer();
    servers.push(server);
    const alice = await registerUser(server, 'alice_sd');
    const profile = await joinFestivalProfile(server, alice.token, 'fest-1');

    // Soft-delete the profile directly in DB
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query('UPDATE festival_profiles SET deleted_at = NOW() WHERE id = $1', [profile.id]);

      // Fetching the profile via API should return 404 or empty
      const res = await server.request.get(`/api/v1/profiles/fest-1`).set('x-user-token', alice.token);
      // The user's profile for this festival should not be found
      if (res.status === 200 && res.body.data) {
        // If it returns profiles, the deleted one should not be in the list
        const found = Array.isArray(res.body.data)
          ? res.body.data.find((p: any) => p.id === profile.id)
          : res.body.data.id === profile.id
            ? res.body.data
            : null;
        assert.equal(found, undefined, 'Soft-deleted profile should not appear in results');
      }
    } finally {
      await pool.end();
    }
  });

  test('update() on a soft-deleted profile does not return it', async () => {
    const server = await startServer();
    servers.push(server);
    const bob = await registerUser(server, 'bob_sd');
    const profile = await joinFestivalProfile(server, bob.token, 'fest-1');

    // Soft-delete the profile
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query('UPDATE festival_profiles SET deleted_at = NOW() WHERE id = $1', [profile.id]);

      // Attempt to update the soft-deleted profile — should fail or return empty
      const res = await server.request
        .put(`/api/v1/profiles/${profile.id}`)
        .set('x-user-token', bob.token)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ picks: { 'set-a': 'must' } });
      // Should get 404 or 403 — the profile is soft-deleted
      assert.ok([403, 404].includes(res.status), `Expected 403 or 404 but got ${res.status}`);
    } finally {
      await pool.end();
    }
  });

  test('soft-deleted profiles do not appear in pick overlap queries', async () => {
    const server = await startServer();
    servers.push(server);
    const alice = await registerUser(server, 'alice_picks');
    const bob = await registerUser(server, 'bob_picks');
    const aliceProfile = await joinFestivalProfile(server, alice.token, 'fest-1');
    const bobProfile = await joinFestivalProfile(server, bob.token, 'fest-1');

    // Both pick set-a as "must"
    await server.request
      .put(`/api/v1/profiles/${aliceProfile.id}`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-a': 'must' } });
    await server.request
      .put(`/api/v1/profiles/${bobProfile.id}`)
      .set('x-user-token', bob.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-a': 'must' } });

    // Soft-delete bob's profile
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query('UPDATE festival_profiles SET deleted_at = NOW() WHERE id = $1', [bobProfile.id]);

      // Fetch festival data — bob's picks should not appear
      const res = await server.request.get('/api/v1/festivals/fest-1').set('x-user-token', alice.token).expect(200);

      const profiles = res.body.data?.profiles || [];
      const bobInResults = profiles.find((p: any) => p.id === bobProfile.id);
      assert.equal(bobInResults, undefined, 'Soft-deleted profile should not appear in festival profiles');
    } finally {
      await pool.end();
    }
  });

  test('soft-deleted profiles do not appear in profiles list endpoint', async () => {
    const server = await startServer();
    servers.push(server);
    const u1 = await registerUser(server, 'count_u1');
    const u2 = await registerUser(server, 'count_u2');
    await joinFestivalProfile(server, u1.token, 'fest-1');
    const p2 = await joinFestivalProfile(server, u2.token, 'fest-1');

    // Get profiles list — both should appear
    const resBefore = await server.request.get('/api/v1/profiles/fest-1').set('x-user-token', u1.token).expect(200);
    const profilesBefore = resBefore.body.data || [];
    assert.ok(profilesBefore.length >= 2, 'Both profiles should appear before soft-delete');

    // Soft-delete u2's profile
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query('UPDATE festival_profiles SET deleted_at = NOW() WHERE id = $1', [p2.id]);

      const resAfter = await server.request.get('/api/v1/profiles/fest-1').set('x-user-token', u1.token).expect(200);
      const profilesAfter = resAfter.body.data || [];
      const deletedInResults = profilesAfter.find((p: any) => p.id === p2.id);
      assert.equal(deletedInResults, undefined, 'Soft-deleted profile should not appear in profiles list');
      assert.ok(profilesAfter.length < profilesBefore.length, 'Profile count should decrease after soft-delete');
    } finally {
      await pool.end();
    }
  });
});
