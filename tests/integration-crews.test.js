const { afterEach, describe, test } = require('node:test');
const {
  assert,
  startServer,
  registerUser,
  joinFestivalProfile,
  loginAdmin,
  connectSocket,
  waitForEvent,
} = require('./_integration-helpers');

const servers = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Crews (membership + realtime)', { concurrency: 1 }, () => {
  test('requires festival membership for crew APIs and realtime rooms', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    await joinFestivalProfile(server, alice.token);
    const charlie = await registerUser(server, 'charlie');

    await server.request
      .get('/api/v1/profiles/fest-1')
      .set('x-user-token', charlie.token)
      .expect(403);

    await server.request
      .get('/api/v1/presence/fest-1')
      .set('x-user-token', charlie.token)
      .expect(403);

    const aliceSocket = connectSocket(server.baseUrl);
    const charlieSocket = connectSocket(server.baseUrl);
    await Promise.all([waitForEvent(aliceSocket, 'connect'), waitForEvent(charlieSocket, 'connect')]);

    const alicePresence = waitForEvent(aliceSocket, 'presence:update', (payload) => payload.online.length === 1);
    aliceSocket.emit('join:festival', 'fest-1', { userToken: alice.token });
    await alicePresence;

    const realtimeError = waitForEvent(charlieSocket, 'error', (payload) => /Join this festival/.test(payload.message));
    charlieSocket.emit('join:festival', 'fest-1', { userToken: charlie.token });
    await realtimeError;

    aliceSocket.close();
    charlieSocket.close();
  });

  test('drops crew access immediately when a profile is deleted', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, alice.token);
    const bobProfile = await joinFestivalProfile(server, bob.token);
    const adminToken = await loginAdmin(server);

    const aliceSocket = connectSocket(server.baseUrl);
    const bobSocket = connectSocket(server.baseUrl);
    await Promise.all([waitForEvent(aliceSocket, 'connect'), waitForEvent(bobSocket, 'connect')]);

    aliceSocket.emit('join:festival', 'fest-1', { userToken: alice.token });
    await waitForEvent(aliceSocket, 'presence:update', (payload) => payload.online.length === 1);

    const bobPresence = waitForEvent(aliceSocket, 'presence:update', (payload) => payload.online.length === 2);
    bobSocket.emit('join:festival', 'fest-1', { userToken: bob.token });
    await bobPresence;

    const revokeEvent = waitForEvent(bobSocket, 'festival:access-revoked', (payload) => payload.profileId === bobProfile.id);
    const aliceAfterDelete = waitForEvent(aliceSocket, 'presence:update', (payload) => payload.online.length === 1);
    await server.request
      .delete(`/api/v1/profiles/${bobProfile.id}`)
      .set('x-user-token', adminToken)
      .expect(200);
    await revokeEvent;
    await aliceAfterDelete;

    aliceSocket.close();
    bobSocket.close();
  });
});

describe('Crew System', { concurrency: 1 }, () => {
  test('crew lifecycle: create, invite, join, overlap, transfer, leave, kick, delete', async () => {
    const server = await startServer();
    servers.push(server);

    // Register Alice, Bob, and Charlie
    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    const charlie = await registerUser(server, 'charlie');

    // All join the festival
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');
    await joinFestivalProfile(server, charlie.token, 'fest-1');

    // 1. Alice creates a crew for fest-1
    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Alpha Squad', festivalId: 'fest-1' })
      .expect(201);

    const crew = crewRes.body.data;
    assert.equal(crew.name, 'Alpha Squad');
    assert.equal(crew.festivalId, 'fest-1');
    assert.equal(crew.role, 'owner');
    assert.equal(crew.memberCount, 1);
    assert.ok(crew.inviteCode);
    const inviteCode = crew.inviteCode;

    // 2. List crews should show Alice's crew
    const listRes = await server.request
      .get('/api/v1/crews?festivalId=fest-1')
      .set('x-user-token', alice.token)
      .expect(200);

    assert.ok(listRes.body.data.length >= 1);
    const listedCrew = listRes.body.data.find((c) => c.id === crew.id);
    assert.ok(listedCrew);

    // 3. Get crew details
    const detailRes = await server.request
      .get(`/api/v1/crews/${crew.id}`)
      .set('x-user-token', alice.token)
      .expect(200);

    const crewDetail = detailRes.body.data;
    assert.equal(crewDetail.memberCount, 1);
    assert.equal(crewDetail.members.length, 1);
    assert.equal(crewDetail.members[0].userId, alice.user.id);
    assert.equal(crewDetail.members[0].role, 'owner');

    // 4. Bob joins via invite code
    const bobJoinRes = await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode })
      .expect(200);

    const bobJoined = bobJoinRes.body.data;
    assert.equal(bobJoined.memberCount, 2);
    assert.equal(bobJoined.role, 'member');

    // 5. Check pick overlap (Alice and Bob have no picks yet)
    const overlapRes = await server.request
      .get(`/api/v1/crews/${crew.id}/overlap`)
      .set('x-user-token', alice.token)
      .expect(200);

    const overlap = overlapRes.body.data;
    assert.equal(overlap.crewId, crew.id);
    assert.equal(overlap.memberCount, 2);

    // 6. Alice transfers ownership to Bob
    const transferRes = await server.request
      .put(`/api/v1/crews/${crew.id}/transfer`)
      .set('x-user-token', alice.token)
      .send({ userId: bob.user.id })
      .expect(200);

    const transferred = transferRes.body.data;
    const bobRole = transferred.members.find((m) => m.userId === bob.user.id);
    const aliceRole = transferred.members.find((m) => m.userId === alice.user.id);
    assert.equal(bobRole.role, 'owner');
    assert.equal(aliceRole.role, 'member');

    // 7. Alice leaves the crew
    const leaveRes = await server.request
      .delete(`/api/v1/crews/${crew.id}/leave`)
      .set('x-user-token', alice.token)
      .expect(200);

    assert.equal(leaveRes.body.data.success, true);

    // Verify Alice is gone
    const afterLeaveRes = await server.request
      .get(`/api/v1/crews/${crew.id}`)
      .set('x-user-token', bob.token)
      .expect(200);

    const afterLeave = afterLeaveRes.body.data;
    assert.equal(afterLeave.memberCount, 1);
    assert.equal(afterLeave.members[0].userId, bob.user.id);

    // 8. Charlie joins via the same invite code
    const charlieJoinRes = await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', charlie.token)
      .send({ inviteCode })
      .expect(200);

    const charlieJoined = charlieJoinRes.body.data;
    assert.equal(charlieJoined.memberCount, 2);

    // 9. Bob kicks Charlie
    const kickRes = await server.request
      .delete(`/api/v1/crews/${crew.id}/members/${charlie.user.id}`)
      .set('x-user-token', bob.token)
      .expect(200);

    assert.equal(kickRes.body.data.success, true);

    // Verify Charlie is removed
    const afterKickRes = await server.request
      .get(`/api/v1/crews/${crew.id}`)
      .set('x-user-token', bob.token)
      .expect(200);

    const afterKick = afterKickRes.body.data;
    assert.equal(afterKick.memberCount, 1);

    // 10. Bob deletes the crew
    const deleteRes = await server.request
      .delete(`/api/v1/crews/${crew.id}`)
      .set('x-user-token', bob.token)
      .expect(200);

    assert.equal(deleteRes.body.data.success, true);

    // Verify crew is gone
    await server.request
      .get(`/api/v1/crews/${crew.id}`)
      .set('x-user-token', bob.token)
      .expect(404);
  });

  test('non-festival member cannot create crew', async () => {
    const server = await startServer();
    servers.push(server);

    const user = await registerUser(server, 'nomember');
    // User did not join the festival

    const res = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', user.token)
      .send({ name: 'Invalid Crew', festivalId: 'fest-1' })
      .expect(403);

    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Join the festival/i);
  });

  test('cannot join with invalid invite code', async () => {
    const server = await startServer();
    servers.push(server);

    const user = await registerUser(server, 'user1');
    await joinFestivalProfile(server, user.token, 'fest-1');

    const res = await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', user.token)
      .send({ inviteCode: 'INVALID123' })
      .expect(404);

    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.match(res.body.error.message, /Invalid invite code/i);
  });

  test('cannot join crew if already a member', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Test Crew', festivalId: 'fest-1' })
      .expect(201);

    const inviteCode = crewRes.body.data.inviteCode;

    // Bob joins
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode })
      .expect(200);

    // Bob tries to join again
    const res = await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode })
      .expect(400);

    assert.equal(res.body.error.code, 'ALREADY_EXISTS');
  });

  test('non-owner cannot delete crew', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Test Crew', festivalId: 'fest-1' })
      .expect(201);

    const crewId = crewRes.body.data.id;
    const inviteCode = crewRes.body.data.inviteCode;

    // Bob joins
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode })
      .expect(200);

    // Bob tries to delete
    const res = await server.request
      .delete(`/api/v1/crews/${crewId}`)
      .set('x-user-token', bob.token)
      .expect(403);

    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Only the crew owner/i);
  });

  test('non-owner cannot transfer ownership', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    const charlie = await registerUser(server, 'charlie');
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');
    await joinFestivalProfile(server, charlie.token, 'fest-1');

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Test Crew', festivalId: 'fest-1' })
      .expect(201);

    const crewId = crewRes.body.data.id;
    const inviteCode = crewRes.body.data.inviteCode;

    // Bob and Charlie join
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode })
      .expect(200);

    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', charlie.token)
      .send({ inviteCode })
      .expect(200);

    // Bob tries to transfer to Charlie
    const res = await server.request
      .put(`/api/v1/crews/${crewId}/transfer`)
      .set('x-user-token', bob.token)
      .send({ userId: charlie.user.id })
      .expect(403);

    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Only the crew owner/i);
  });

  test('non-owner cannot kick members', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    const charlie = await registerUser(server, 'charlie');
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');
    await joinFestivalProfile(server, charlie.token, 'fest-1');

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Test Crew', festivalId: 'fest-1' })
      .expect(201);

    const crewId = crewRes.body.data.id;
    const inviteCode = crewRes.body.data.inviteCode;

    // Bob and Charlie join
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode })
      .expect(200);

    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', charlie.token)
      .send({ inviteCode })
      .expect(200);

    // Bob tries to kick Charlie
    const res = await server.request
      .delete(`/api/v1/crews/${crewId}/members/${charlie.user.id}`)
      .set('x-user-token', bob.token)
      .expect(403);

    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Only the crew owner/i);
  });

  test('owner can kick themselves indirectly by transferring then leaving', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Test Crew', festivalId: 'fest-1' })
      .expect(201);

    const crewId = crewRes.body.data.id;
    const inviteCode = crewRes.body.data.inviteCode;

    // Bob joins
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode })
      .expect(200);

    // Alice tries to leave as owner (should fail)
    const leaveRes = await server.request
      .delete(`/api/v1/crews/${crewId}/leave`)
      .set('x-user-token', alice.token)
      .expect(400);

    assert.equal(leaveRes.body.error.code, 'FORBIDDEN');
    assert.match(leaveRes.body.error.message, /Transfer ownership before leaving/i);

    // Alice transfers to Bob
    await server.request
      .put(`/api/v1/crews/${crewId}/transfer`)
      .set('x-user-token', alice.token)
      .send({ userId: bob.user.id })
      .expect(200);

    // Now Alice can leave
    await server.request
      .delete(`/api/v1/crews/${crewId}/leave`)
      .set('x-user-token', alice.token)
      .expect(200);
  });

  test('regenerate invite code (owner only)', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Test Crew', festivalId: 'fest-1' })
      .expect(201);

    const crewId = crewRes.body.data.id;
    const oldCode = crewRes.body.data.inviteCode;

    // Bob joins with old code
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode: oldCode })
      .expect(200);

    // Alice regenerates the code
    const regenRes = await server.request
      .post(`/api/v1/crews/${crewId}/invite`)
      .set('x-user-token', alice.token)
      .expect(200);

    const newCode = regenRes.body.data.inviteCode;
    assert.ok(newCode);
    assert.notEqual(newCode, oldCode);

    // Old code should no longer work
    const charlie = await registerUser(server, 'charlie');
    await joinFestivalProfile(server, charlie.token, 'fest-1');

    const res = await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', charlie.token)
      .send({ inviteCode: oldCode })
      .expect(404);

    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('non-owner cannot regenerate invite code', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Test Crew', festivalId: 'fest-1' })
      .expect(201);

    const crewId = crewRes.body.data.id;
    const inviteCode = crewRes.body.data.inviteCode;

    // Bob joins
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode })
      .expect(200);

    // Bob tries to regenerate
    const res = await server.request
      .post(`/api/v1/crews/${crewId}/invite`)
      .set('x-user-token', bob.token)
      .expect(403);

    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Only the crew owner/i);
  });

  test('update crew (owner only)', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Test Crew', festivalId: 'fest-1', maxMembers: 10 })
      .expect(201);

    const crewId = crewRes.body.data.id;
    const inviteCode = crewRes.body.data.inviteCode;

    // Bob joins
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode })
      .expect(200);

    // Bob tries to update
    const res = await server.request
      .put(`/api/v1/crews/${crewId}`)
      .set('x-user-token', bob.token)
      .send({ name: 'Bob Squad' })
      .expect(403);

    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Only the crew owner/i);

    // Alice updates the name
    const updateRes = await server.request
      .put(`/api/v1/crews/${crewId}`)
      .set('x-user-token', alice.token)
      .send({ name: 'Alpha Squad Updated' })
      .expect(200);

    const updated = updateRes.body.data;
    assert.equal(updated.name, 'Alpha Squad Updated');
  });

  test('max members limit is enforced', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    const charlie = await registerUser(server, 'charlie');
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');
    await joinFestivalProfile(server, charlie.token, 'fest-1');

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Small Crew', festivalId: 'fest-1' })
      .expect(201);

    const crewId = crewRes.body.data.id;
    const maxMembers = crewRes.body.data.maxMembers;
    const inviteCode = crewRes.body.data.inviteCode;

    // Bob joins
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode })
      .expect(200);

    // If maxMembers is 2, Charlie should be rejected
    if (maxMembers === 2) {
      const res = await server.request
        .post('/api/v1/crews/join')
        .set('x-user-token', charlie.token)
        .send({ inviteCode })
        .expect(400);

      assert.equal(res.body.error.code, 'MAX_LIMIT_REACHED');
      assert.match(res.body.error.message, /Crew is full/i);
    }
  });

  test('crew members cannot see invite code', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Test Crew', festivalId: 'fest-1' })
      .expect(201);

    const crewId = crewRes.body.data.id;
    const inviteCode = crewRes.body.data.inviteCode;

    // Bob joins
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode })
      .expect(200);

    // Bob fetches crew details
    const detailRes = await server.request
      .get(`/api/v1/crews/${crewId}`)
      .set('x-user-token', bob.token)
      .expect(200);

    // Bob should not see the invite code
    assert.equal(detailRes.body.data.inviteCode, undefined);

    // But Alice should see it
    const aliceDetailRes = await server.request
      .get(`/api/v1/crews/${crewId}`)
      .set('x-user-token', alice.token)
      .expect(200);

    assert.ok(aliceDetailRes.body.data.inviteCode);
  });

  test('non-member cannot view crew details', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Test Crew', festivalId: 'fest-1' })
      .expect(201);

    const crewId = crewRes.body.data.id;

    // Bob tries to view without being a member
    const res = await server.request
      .get(`/api/v1/crews/${crewId}`)
      .set('x-user-token', bob.token)
      .expect(403);

    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Not a member/i);
  });

  test('non-member cannot access crew overlap', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, alice.token, 'fest-1');
    await joinFestivalProfile(server, bob.token, 'fest-1');

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Test Crew', festivalId: 'fest-1' })
      .expect(201);

    const crewId = crewRes.body.data.id;

    // Bob tries to access overlap without being a member
    const res = await server.request
      .get(`/api/v1/crews/${crewId}/overlap`)
      .set('x-user-token', bob.token)
      .expect(403);

    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Not a member/i);
  });

  test('authenticated users are required for all crew endpoints', async () => {
    const server = await startServer();
    servers.push(server);

    // No token
    await server.request
      .get('/api/v1/crews')
      .expect(401);

    await server.request
      .post('/api/v1/crews')
      .send({ name: 'Test', festivalId: 'fest-1' })
      .expect(401);

    await server.request
      .post('/api/v1/crews/join')
      .send({ inviteCode: 'ABC123' })
      .expect(401);
  });
});
