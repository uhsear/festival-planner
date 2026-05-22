import { afterEach, describe, test } from 'node:test';
import {
  assert,
  DEFAULT_PASSWORD,
  startServer,
  registerUser,
  loginUser,
  joinFestivalProfile,
  loginAdmin,
  connectSocket,
  waitForEvent,
} from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Admin', { concurrency: 1 }, () => {
  test('locks down admin user management without exposing passwords', async () => {
    const server = await startServer();
    servers.push(server);

    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, bob.token);

    await server.request
      .get('/api/v1/admin/users')
      .expect(401);

    await server.request
      .put(`/api/v1/admin/users/${bob.user.id}/reset-password`)
      .send({ newPassword: 'resetpass789' })
      .expect(401);

    await server.request
      .delete(`/api/v1/admin/users/${bob.user.id}`)
      .expect(401);

    const adminToken = await loginAdmin(server);
    const usersResponse = await server.request
      .get('/api/v1/admin/users')
      .set('x-user-token', adminToken)
      .expect(200);

    assert.ok(usersResponse.body.data.length >= 1, 'Should have at least 1 user');
    const bobEntry = usersResponse.body.data.find((u: any) => u.username === 'bob');
    assert.ok(bobEntry, 'bob should appear in user list');
    assert.ok(!('password' in bobEntry));
    assert.equal(bobEntry.profileCount, 1);

    await server.request
      .put(`/api/v1/admin/users/${bob.user.id}/reset-password`)
      .set('x-user-token', adminToken)
      .send({ newPassword: 'resetpass789' })
      .expect(200);

    await server.request
      .post('/api/v1/auth/login')
      .send({ username: 'bob', password: DEFAULT_PASSWORD })
      .expect(401);

    await loginUser(server, 'bob', 'resetpass789');

    await server.request
      .delete(`/api/v1/admin/users/${bob.user.id}`)
      .set('x-user-token', adminToken)
      .expect(200);

    await server.request
      .post('/api/v1/auth/login')
      .send({ username: 'bob', password: 'resetpass789' })
      .expect(401);
  });

  test('limits public health output and keeps detailed health admin-only', async () => {
    const server = await startServer();
    servers.push(server);

    const publicHealth = await server.request
      .get('/api/health')
      .expect(200);
    assert.equal(publicHealth.body.data.status, 'ok');
    assert.equal(typeof publicHealth.body.data.uptime, 'number');

    await server.request
      .get('/api/admin/health')
      .expect(401);

    const adminToken = await loginAdmin(server);
    const detailedHealth = await server.request
      .get('/api/admin/health')
      .set('x-user-token', adminToken)
      .expect(200);

    assert.equal(detailedHealth.body.data.status, 'ok');
    assert.equal(typeof detailedHealth.body.data.uptime, 'number');
    assert.equal(typeof detailedHealth.body.data.connections, 'number');
    assert.equal(typeof detailedHealth.body.data.users, 'number');
    assert.match(detailedHealth.body.data.timestamp, /\d{4}-\d{2}-\d{2}T/);
  });

  test('covers admin festival CRUD and realtime festival events', async () => {
    const server = await startServer();
    servers.push(server);

    const socket = connectSocket(server.baseUrl);
    await waitForEvent(socket, 'connect');

    const adminToken = await loginAdmin(server);
    const createdEvent = waitForEvent(socket, 'festival:created', (payload) => payload.id === 'fest-2');

    await server.request
      .post('/api/v1/festivals')
      .set('x-user-token', adminToken)
      .send({
        id: 'fest-2',
        name: 'Second Fest',
        location: 'Another Field',
        stages: [{ id: 'alt', name: 'Alt', color: '#4488ff' }],
        days: [{ label: 'Sunday', date: '2026-06-07', sets: [{ id: 'set-z', artist: 'Zeta', stageId: 'alt', startTime: '15:00', endTime: '16:00' }] }],
      })
      .expect(201);

    const createdPayload: any = await createdEvent;
    assert.equal(createdPayload.name, 'Second Fest');

    const updatedEvent = waitForEvent(socket, 'festival:updated', (payload) => payload.id === 'fest-2');
    await server.request
      .put('/api/v1/festivals/fest-2')
      .set('x-user-token', adminToken)
      .send({
        id: 'fest-2',
        name: 'Second Fest Updated',
        location: 'Another Field',
        stages: [{ id: 'alt', name: 'Alt', color: '#4488ff' }],
        days: [{ label: 'Sunday', date: '2026-06-07', sets: [{ id: 'set-z', artist: 'Zeta', stageId: 'alt', startTime: '16:00', endTime: '17:00' }] }],
      })
      .expect(200);
    await updatedEvent;

    const deletedEvent = waitForEvent(socket, 'festival:deleted', (payload) => payload.id === 'fest-2');
    await server.request
      .delete('/api/v1/festivals/fest-2')
      .set('x-user-token', adminToken)
      .expect(200);
    await deletedEvent;

    socket.close();
  });

  test('broadcasts profile removal when an admin deletes a user', async () => {
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
    bobSocket.emit('join:festival', 'fest-1', { userToken: bob.token });
    await waitForEvent(aliceSocket, 'presence:update', (payload) => payload.online.length === 2);

    const deletedProfileEvent = waitForEvent(aliceSocket, 'profile:deleted', (payload) => payload.profileId === bobProfile.id);
    const bobDisconnected = waitForEvent(bobSocket, 'disconnect', () => true);
    const alicePresence = waitForEvent(aliceSocket, 'presence:update', (payload) => payload.online.length === 1);

    await server.request
      .delete(`/api/v1/admin/users/${bob.user.id}`)
      .set('x-user-token', adminToken)
      .expect(200);

    await deletedProfileEvent;
    await bobDisconnected;
    await alicePresence;

    const profileList = await server.request
      .get('/api/v1/profiles/fest-1')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.equal(profileList.body.data.some((profile: any) => profile.id === bobProfile.id), false);

    aliceSocket.close();
    bobSocket.close();
  });
});
