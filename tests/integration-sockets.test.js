const { afterEach, describe, test } = require('node:test');
const {
  assert,
  DEFAULT_PASSWORD,
  startServer,
  registerUser,
  loginUser,
  joinFestivalProfile,
  loginAdmin,
  uploadAvatar,
  connectSocket,
  waitForEvent,
  markTrustedMutation,
} = require('./_integration-helpers');

const servers = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Sockets', { concurrency: 1 }, () => {
  test('joins realtime rooms through the browser session cookie path', async () => {
    const server = await startServer();
    servers.push(server);

    const registration = await markTrustedMutation(server.request
      .post('/api/v1/auth/register'))
      .send({ username: 'socket-cookie-user', password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, tosAccepted: true })
      .expect(201);

    await server.request
      .post('/api/v1/profiles')
      .set('x-user-token', registration.body.data.token)
      .send({ festivalId: 'fest-1' })
      .expect(200);

    const cookieHeader = registration.headers['set-cookie']
      .map((value) => value.split(';')[0])
      .join('; ');

    const socket = connectSocket(server.baseUrl, {
      extraHeaders: {
        Cookie: cookieHeader,
      },
    });
    await waitForEvent(socket, 'connect');

    const presence = waitForEvent(socket, 'presence:update', (payload) => payload.online.length === 1);
    socket.emit('join:festival', 'fest-1', {});
    await presence;

    socket.close();
  });

  test('disconnects sockets immediately when a session is evicted or logged out', async () => {
    const server = await startServer({ USER_SESSION_MAX: 1 });
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    await joinFestivalProfile(server, alice.token);

    const socket = connectSocket(server.baseUrl);
    await waitForEvent(socket, 'connect');
    const presence = waitForEvent(socket, 'presence:update', (payload) => payload.online.length === 1);
    socket.emit('join:festival', 'fest-1', { userToken: alice.token });
    await presence;

    const evictedDisconnect = waitForEvent(socket, 'disconnect', () => true);
    const nextLogin = await loginUser(server, 'alice');
    await evictedDisconnect;

    await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', alice.token)
      .expect(401);

    const logoutSocket = connectSocket(server.baseUrl);
    await waitForEvent(logoutSocket, 'connect');
    logoutSocket.emit('join:festival', 'fest-1', { userToken: nextLogin.token });
    await waitForEvent(logoutSocket, 'presence:update', (payload) => payload.online.length === 1);

    const logoutDisconnect = waitForEvent(logoutSocket, 'disconnect', () => true);
    await server.request
      .post('/api/v1/auth/logout')
      .set('x-user-token', nextLogin.token)
      .expect(200);
    await logoutDisconnect;
  });

  test('rate limits noisy realtime join events', async () => {
    const server = await startServer({ SOCKET_JOIN_RATE_LIMIT: 2, SOCKET_EVENT_WINDOW: 10_000 });
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    await joinFestivalProfile(server, alice.token);
    const socket = connectSocket(server.baseUrl);
    await waitForEvent(socket, 'connect');

    socket.emit('join:festival', 'fest-1', { userToken: alice.token });
    await waitForEvent(socket, 'presence:update', (payload) => payload.online.length === 1);

    socket.emit('join:festival', 'fest-1', { userToken: alice.token });
    const joinRateLimit = waitForEvent(socket, 'error', (payload) => payload.message === 'Realtime rate limit exceeded');
    socket.emit('join:festival', 'fest-1', { userToken: alice.token });
    await joinRateLimit;

    socket.close();
  });

  test('rate limits websocket connection attempts per IP', async () => {
    const server = await startServer({ SOCKET_CONNECT_RATE_LIMIT: 2, SOCKET_CONNECT_WINDOW: 10_000 });
    servers.push(server);

    const first = connectSocket(server.baseUrl);
    const second = connectSocket(server.baseUrl);

    await Promise.all([waitForEvent(first, 'connect'), waitForEvent(second, 'connect')]);
    const third = connectSocket(server.baseUrl);
    const connectError = await waitForEvent(third, 'connect_error', (error) => String(error?.message || error) === 'websocket error');
    assert.equal(String(connectError.message || connectError), 'websocket error');
    assert.equal(server.planner.state.socketConnectRateLimits.get('127.0.0.1')?.count, 3);

    first.close();
    second.close();
    third.close();
  });

  test('evicts joined festival sockets when an admin deletes the festival', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    await joinFestivalProfile(server, alice.token);
    const adminToken = await loginAdmin(server);

    const socket = connectSocket(server.baseUrl);
    await waitForEvent(socket, 'connect');
    socket.emit('join:festival', 'fest-1', { userToken: alice.token });
    await waitForEvent(socket, 'presence:update', (payload) => payload.online.length === 1);

    const revoked = waitForEvent(socket, 'festival:access-revoked', (payload) => payload.festivalId === 'fest-1');
    const deleted = waitForEvent(socket, 'festival:deleted', (payload) => payload.id === 'fest-1');

    await server.request
      .delete('/api/v1/festivals/fest-1?hard=true')
      .set('x-user-token', adminToken)
      .expect(200);

    await revoked;
    await deleted;

    socket.close();
  });

  test('covers presence and realtime profile events', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    const adminToken = await loginAdmin(server);
    const avatar = await uploadAvatar(server, alice.token);

    const aliceProfile = await joinFestivalProfile(server, alice.token);

    const aliceSocket = connectSocket(server.baseUrl);
    const bobSocket = connectSocket(server.baseUrl);

    await Promise.all([waitForEvent(aliceSocket, 'connect'), waitForEvent(bobSocket, 'connect')]);

    const presenceForAlice = waitForEvent(aliceSocket, 'presence:update', (payload) => payload.online.length === 1);
    aliceSocket.emit('join:festival', 'fest-1', { userToken: alice.token });
    const alicePresence = await presenceForAlice;
    assert.equal(alicePresence.online[0].avatarUrl, avatar.user.avatarUrl);

    const profileCreated = waitForEvent(aliceSocket, 'profile:created', (payload) => payload.profile.name === 'bob');
    const bobProfile = await joinFestivalProfile(server, bob.token);
    await profileCreated;

    const presenceForBoth = waitForEvent(aliceSocket, 'presence:update', (payload) => payload.online.length === 2);
    bobSocket.emit('join:festival', 'fest-1', { userToken: bob.token });
    await presenceForBoth;

    const presenceAfterLeave = waitForEvent(aliceSocket, 'presence:update', (payload) => payload.online.length === 1);
    bobSocket.emit('leave:festival');
    await presenceAfterLeave;

    const presenceAfterRejoin = waitForEvent(aliceSocket, 'presence:update', (payload) => payload.online.length === 2);
    bobSocket.emit('join:festival', 'fest-1', { userToken: bob.token });
    await presenceAfterRejoin;

    const updatedProfile = waitForEvent(bobSocket, 'profile:updated', (payload) => payload.profileId === aliceProfile.id);
    await server.request
      .put(`/api/v1/profiles/${aliceProfile.id}`)
      .set('x-user-token', alice.token)
      .send({ picks: { 'set-a': 'must' }, notes: { 'set-a': 'Alice private note' } })
      .expect(200);
    const updatedPayload = await updatedProfile;
    assert.deepEqual(updatedPayload.picks, { 'set-a': 'must' });
    assert.equal(updatedPayload.notes, undefined);

    const bobDisconnected = waitForEvent(bobSocket, 'disconnect', () => true);
    const presenceAfterRevoke = waitForEvent(aliceSocket, 'presence:update', (payload) => payload.online.length === 1);

    await server.request
      .put(`/api/v1/admin/users/${bob.user.id}/reset-password`)
      .set('x-user-token', adminToken)
      .send({ newPassword: 'bobreset789' })
      .expect(200);

    await bobDisconnected;
    await presenceAfterRevoke;

    const deletedProfileEvent = waitForEvent(aliceSocket, 'profile:deleted', (payload) => payload.profileId === bobProfile.id);
    await server.request
      .delete(`/api/v1/profiles/${bobProfile.id}`)
      .set('x-user-token', adminToken)
      .expect(200);
    await deletedProfileEvent;

    aliceSocket.close();
    bobSocket.close();
  });

  test('disconnect cleans up presence and room switching works', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, alice.token);
    await joinFestivalProfile(server, bob.token);

    const aliceSocket = connectSocket(server.baseUrl);
    const bobSocket = connectSocket(server.baseUrl);
    await Promise.all([waitForEvent(aliceSocket, 'connect'), waitForEvent(bobSocket, 'connect')]);

    aliceSocket.emit('join:festival', 'fest-1', { userToken: alice.token });
    bobSocket.emit('join:festival', 'fest-1', { userToken: bob.token });
    await waitForEvent(aliceSocket, 'presence:update', (p) => p.online.length === 2);

    // Bob disconnects — Alice should see presence drop to 1
    const presenceAfterDisconnect = waitForEvent(aliceSocket, 'presence:update', (p) => p.online.length === 1);
    bobSocket.disconnect();
    await presenceAfterDisconnect;

    aliceSocket.close();
  });

  test('join:crew — user joins a crew room and receives ack', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    await joinFestivalProfile(server, alice.token);

    // Create a crew via HTTP API
    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .set('x-festie-request', '1')
      .send({ name: 'Socket Test Crew', festivalId: 'fest-1' })
      .expect(201);
    const crewId = crewRes.body.data.id;

    // Connect and first join the festival (required for session state)
    const socket = connectSocket(server.baseUrl);
    await waitForEvent(socket, 'connect');
    socket.emit('join:festival', 'fest-1', { userToken: alice.token });
    await waitForEvent(socket, 'presence:update', (p) => p.online.length === 1);

    // Now join the crew room
    const ack = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('join:crew ack timeout')), 4000);
      socket.emit('join:crew', { crewId }, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
    assert.equal(ack.ok, true);
    assert.equal(ack.crewId, crewId);

    socket.close();
  });

  test('leave:crew — user leaves a crew room', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    await joinFestivalProfile(server, alice.token);

    // Create a crew
    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .set('x-festie-request', '1')
      .send({ name: 'Leave Test Crew', festivalId: 'fest-1' })
      .expect(201);
    const crewId = crewRes.body.data.id;

    const socket = connectSocket(server.baseUrl);
    await waitForEvent(socket, 'connect');
    socket.emit('join:festival', 'fest-1', { userToken: alice.token });
    await waitForEvent(socket, 'presence:update', (p) => p.online.length === 1);

    // Join crew room first
    const joinAck = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('join:crew ack timeout')), 4000);
      socket.emit('join:crew', { crewId }, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
    assert.equal(joinAck.ok, true);

    // Now leave the crew room — leave:crew has no ack, so verify
    // the socket stays connected and can still interact
    socket.emit('leave:crew', { crewId });

    // Give the server a moment to process the leave
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify the socket is still connected and functional by re-joining
    const rejoinAck = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('rejoin:crew ack timeout')), 4000);
      socket.emit('join:crew', { crewId }, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
    assert.equal(rejoinAck.ok, true);

    socket.close();
  });

  test('reconnect:restore — restores festival room subscription on reconnect', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    await joinFestivalProfile(server, alice.token);

    // First connection — join festival
    const socket1 = connectSocket(server.baseUrl);
    await waitForEvent(socket1, 'connect');
    socket1.emit('join:festival', 'fest-1', { userToken: alice.token });
    await waitForEvent(socket1, 'presence:update', (p) => p.online.length === 1);

    // Disconnect the first socket
    socket1.disconnect();

    // Second connection — simulate reconnect:restore
    const socket2 = connectSocket(server.baseUrl);
    await waitForEvent(socket2, 'connect');

    const restoreAck = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('reconnect:restore ack timeout')), 4000);
      socket2.emit('reconnect:restore', { festivalId: 'fest-1', userToken: alice.token }, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
    assert.equal(restoreAck.ok, true);
    assert.ok(restoreAck.profileId, 'restore should return profileId');

    // Verify presence is active after restore
    await waitForEvent(socket2, 'presence:update', (p) => p.online.length >= 1);

    socket2.close();
  });

  test('reconnect:restore — rejects unauthenticated restore with disconnect', async () => {
    const server = await startServer();
    servers.push(server);

    const socket = connectSocket(server.baseUrl);
    await waitForEvent(socket, 'connect');

    const disconnected = waitForEvent(socket, 'disconnect', () => true);
    socket.emit('reconnect:restore', { festivalId: 'fest-1', userToken: 'invalid-token' }, () => {});
    await disconnected;
  });

  test('rejects socket events from unauthenticated or unauthorized sockets', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    await joinFestivalProfile(server, alice.token);

    // Socket with invalid token should be disconnected on join attempt
    const badSocket = connectSocket(server.baseUrl);
    await waitForEvent(badSocket, 'connect');

    const disconnected = waitForEvent(badSocket, 'disconnect', () => true);
    badSocket.emit('join:festival', 'fest-1', { userToken: 'invalid-token-value' });
    await disconnected;

    // Socket with valid token that joins should work
    const aliceSocket = connectSocket(server.baseUrl);
    await waitForEvent(aliceSocket, 'connect');
    aliceSocket.emit('join:festival', 'fest-1', { userToken: alice.token });
    await waitForEvent(aliceSocket, 'presence:update', (p) => p.online.length === 1);

    aliceSocket.close();
  });
});
