/**
 * Integration tests for the EPHEMERAL live-location socket handlers in
 * routes/socket.ts: location:share / location:update / location:stop, plus the
 * disconnect → location:peer-stopped auto-expire.
 *
 * Safety-critical invariants under test:
 *   - location:share re-verifies crew membership against Postgres (sharing live
 *     GPS is more sensitive than viewing); a non-member is rejected NOT_A_MEMBER,
 *     a socket not in the crew room is rejected NOT_IN_CREW_ROOM.
 *   - NO Postgres write happens for any location event (positions are ephemeral
 *     and travel ONLY over Socket.IO) — asserted by inspecting crew_activity.
 *   - location:update broadcasts location:peer-update to the crew room EXCLUDING
 *     the sender; a non-sharing sender is rejected (NOT_SHARING) and never
 *     reaches peers.
 *   - location:stop and a raw disconnect both emit location:peer-stopped so no
 *     ghost marker lingers (reason 'stop' vs 'disconnect').
 *
 * DB-backed: these handlers call stores.crews.getMember, so this suite requires
 * Postgres (TEST_DATABASE_URL). It therefore runs in CI (which provisions PG)
 * and is SKIPPED locally on a machine without a test database.
 */

import { afterEach, describe, test } from 'node:test';
import {
  assert,
  startServer,
  registerUser,
  joinFestivalProfile,
  connectSocket,
  waitForEvent,
  Pool,
} from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

// Helper: connect a socket, join the festival (auth) and then the crew room.
async function joinedCrewSocket(server: any, baseUrl: string, token: string, crewId: string) {
  const socket = connectSocket(baseUrl);
  await waitForEvent(socket, 'connect');
  socket.emit('join:festival', 'fest-1', { userToken: token });
  await waitForEvent(socket, 'presence:update', () => true);
  const ack: any = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('join:crew ack timeout')), 4000);
    socket.emit('join:crew', { crewId }, (r: any) => {
      clearTimeout(t);
      resolve(r);
    });
  });
  assert.equal(ack.ok, true);
  return socket;
}

// Helper: emit an event that has an ack callback and await the ack.
function emitWithAck(socket: any, event: string, data: any, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} ack timeout`)), timeoutMs);
    socket.emit(event, data, (r: any) => {
      clearTimeout(t);
      resolve(r);
    });
  });
}

const VALID_FIX = {
  lat: 41.8781,
  lng: -87.6298,
  accuracy: 8,
  capturedAt: '2026-06-06T18:00:00.000Z',
};

describe('Integration — Live Location (ephemeral sockets)', { concurrency: 1 }, () => {
  // Standard two-member setup: Alice owns a crew, Bob joins it.
  async function setupCrew() {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    await joinFestivalProfile(server, alice.token);
    await joinFestivalProfile(server, bob.token);

    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .set('x-festie-request', '1')
      .send({ name: 'Loc Crew', festivalId: 'fest-1' })
      .expect(201);
    const crewId = crewRes.body.data.id;
    const inviteCode = crewRes.body.data.inviteCode;

    await server.request.post('/api/v1/crews/join').set('x-user-token', bob.token).send({ inviteCode }).expect(200);

    return { server, alice, bob, crewId };
  }

  // ── Membership re-verification ──────────────────────────────────────
  test('location:share succeeds for a member already in the crew room', async () => {
    const { server, alice, crewId } = await setupCrew();
    const socket = await joinedCrewSocket(server, server.baseUrl, alice.token, crewId);

    const ack: any = await emitWithAck(socket, 'location:share', { crewId });
    assert.equal(ack.ok, true);

    socket.close();
  });

  test('location:share rejects NOT_IN_CREW_ROOM when the socket never joined the room', async () => {
    const { server, alice, crewId } = await setupCrew();
    // Join festival (auth) but NOT the crew room.
    const socket = connectSocket(server.baseUrl);
    await waitForEvent(socket, 'connect');
    socket.emit('join:festival', 'fest-1', { userToken: alice.token });
    await waitForEvent(socket, 'presence:update', () => true);

    const ack: any = await emitWithAck(socket, 'location:share', { crewId });
    assert.equal(ack.ok, false);
    assert.equal(ack.code, 'NOT_IN_CREW_ROOM');

    socket.close();
  });

  test('location:share rejects NOT_A_MEMBER after the user leaves the crew', async () => {
    const { server, alice, bob, crewId } = await setupCrew();
    // Bob joins the crew room over the socket, then leaves the crew via HTTP.
    const bobSocket = await joinedCrewSocket(server, server.baseUrl, bob.token, crewId);

    await server.request.delete(`/api/v1/crews/${crewId}/leave`).set('x-user-token', bob.token).expect(200);

    // Socket still thinks it's in the room (socket.data.crewId is set), but the
    // membership re-verify against Postgres must now reject the share.
    const ack: any = await emitWithAck(bobSocket, 'location:share', { crewId });
    assert.equal(ack.ok, false);
    assert.equal(ack.code, 'NOT_A_MEMBER');

    bobSocket.close();
    void alice;
  });

  test('location:share with a SCHEMA_MISMATCH payload is rejected', async () => {
    const { server, alice, crewId } = await setupCrew();
    const socket = await joinedCrewSocket(server, server.baseUrl, alice.token, crewId);

    const ack: any = await emitWithAck(socket, 'location:share', { crewId: '' });
    assert.equal(ack.ok, false);
    assert.equal(ack.code, 'SCHEMA_MISMATCH');

    socket.close();
  });

  // ── Broadcast to crew room, excluding the sender ────────────────────
  test('location:share with a first fix broadcasts location:peer-update to peers (not the sender)', async () => {
    const { server, alice, bob, crewId } = await setupCrew();
    const aliceSocket = await joinedCrewSocket(server, server.baseUrl, alice.token, crewId);
    const bobSocket = await joinedCrewSocket(server, server.baseUrl, bob.token, crewId);

    // Sender must NOT receive its own broadcast.
    let aliceGotOwn = false;
    aliceSocket.on('location:peer-update', () => {
      aliceGotOwn = true;
    });

    const peerUpdate = waitForEvent(bobSocket, 'location:peer-update', (p: any) => p.userId === alice.user.id);
    const ack: any = await emitWithAck(aliceSocket, 'location:share', { crewId, position: VALID_FIX });
    assert.equal(ack.ok, true);

    const payload: any = await peerUpdate;
    assert.equal(payload.crewId, crewId);
    assert.equal(payload.lat, VALID_FIX.lat);
    assert.equal(payload.lng, VALID_FIX.lng);
    assert.ok(payload.serverAt, 'server stamps serverAt');

    assert.equal(aliceGotOwn, false, 'sender does not receive its own peer-update');

    aliceSocket.close();
    bobSocket.close();
  });

  test('location:update broadcasts location:peer-update to peers excluding the sender', async () => {
    const { server, alice, bob, crewId } = await setupCrew();
    const aliceSocket = await joinedCrewSocket(server, server.baseUrl, alice.token, crewId);
    const bobSocket = await joinedCrewSocket(server, server.baseUrl, bob.token, crewId);

    // Alice must be sharing before updates are accepted.
    await emitWithAck(aliceSocket, 'location:share', { crewId });

    const peerUpdate = waitForEvent(
      bobSocket,
      'location:peer-update',
      (p: any) => p.userId === alice.user.id && p.lat === VALID_FIX.lat,
    );
    aliceSocket.emit('location:update', { crewId, ...VALID_FIX });

    const payload: any = await peerUpdate;
    assert.equal(payload.userId, alice.user.id);
    assert.equal(payload.lng, VALID_FIX.lng);

    aliceSocket.close();
    bobSocket.close();
  });

  test('location:update from a non-sharing socket is rejected (NOT_SHARING) and never reaches peers', async () => {
    const { server, alice, bob, crewId } = await setupCrew();
    const aliceSocket = await joinedCrewSocket(server, server.baseUrl, alice.token, crewId);
    const bobSocket = await joinedCrewSocket(server, server.baseUrl, bob.token, crewId);

    let bobGotUpdate = false;
    bobSocket.on('location:peer-update', () => {
      bobGotUpdate = true;
    });

    // Alice never called location:share, so this update must be refused.
    const errorEvt = waitForEvent(aliceSocket, 'error', (e: any) => e.code === 'NOT_SHARING');
    aliceSocket.emit('location:update', { crewId, ...VALID_FIX });
    const err: any = await errorEvt;
    assert.equal(err.code, 'NOT_SHARING');

    // Give any (erroneous) broadcast a chance to arrive — it must not.
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(bobGotUpdate, false, 'a non-sharing update must not reach peers');

    aliceSocket.close();
    bobSocket.close();
  });

  // ── Stop + disconnect auto-expire ───────────────────────────────────
  test('location:stop emits location:peer-stopped (reason stop) to peers', async () => {
    const { server, alice, bob, crewId } = await setupCrew();
    const aliceSocket = await joinedCrewSocket(server, server.baseUrl, alice.token, crewId);
    const bobSocket = await joinedCrewSocket(server, server.baseUrl, bob.token, crewId);

    await emitWithAck(aliceSocket, 'location:share', { crewId });

    const stopped = waitForEvent(bobSocket, 'location:peer-stopped', (p: any) => p.userId === alice.user.id);
    const ack: any = await emitWithAck(aliceSocket, 'location:stop', { crewId });
    assert.equal(ack.ok, true);

    const payload: any = await stopped;
    assert.equal(payload.crewId, crewId);
    assert.equal(payload.reason, 'stop');

    aliceSocket.close();
    bobSocket.close();
  });

  test('location:stop for a crew the socket never joined is rejected and never reaches that crew', async () => {
    const { server, alice, bob, crewId } = await setupCrew();
    // Bob is a real member sitting in the crew room — he is the victim who must
    // NOT be told that a peer stopped sharing.
    const bobSocket = await joinedCrewSocket(server, server.baseUrl, bob.token, crewId);

    // Mallory authenticates (join:festival) but never joins the crew room and is
    // not a member, then names the crew directly in a location:stop payload.
    const mallory = await registerUser(server, 'mallory');
    await joinFestivalProfile(server, mallory.token);
    const mallorySocket = connectSocket(server.baseUrl);
    await waitForEvent(mallorySocket, 'connect');
    mallorySocket.emit('join:festival', 'fest-1', { userToken: mallory.token });
    await waitForEvent(mallorySocket, 'presence:update', () => true);

    let bobGotStopped = false;
    bobSocket.on('location:peer-stopped', () => {
      bobGotStopped = true;
    });

    const ack: any = await emitWithAck(mallorySocket, 'location:stop', { crewId });
    assert.equal(ack.ok, false, 'a stop naming a crew the socket never joined must be refused');

    // Give any (erroneous) broadcast a chance to arrive — it must not.
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(bobGotStopped, false, 'an unadmitted stop must not reach the crew room');

    mallorySocket.close();
    bobSocket.close();
    void alice;
  });

  test('disconnect while sharing emits location:peer-stopped (reason disconnect) to peers', async () => {
    const { server, alice, bob, crewId } = await setupCrew();
    const aliceSocket = await joinedCrewSocket(server, server.baseUrl, alice.token, crewId);
    const bobSocket = await joinedCrewSocket(server, server.baseUrl, bob.token, crewId);

    await emitWithAck(aliceSocket, 'location:share', { crewId, position: VALID_FIX });

    const stopped = waitForEvent(
      bobSocket,
      'location:peer-stopped',
      (p: any) => p.userId === alice.user.id && p.reason === 'disconnect',
    );
    aliceSocket.disconnect();

    const payload: any = await stopped;
    assert.equal(payload.crewId, crewId);
    assert.equal(payload.reason, 'disconnect');

    bobSocket.close();
  });

  // ── Ephemerality: NO Postgres write ─────────────────────────────────
  test('no crew_activity row is written for any location event (ephemeral invariant)', async () => {
    const { server, alice, bob, crewId } = await setupCrew();
    const aliceSocket = await joinedCrewSocket(server, server.baseUrl, alice.token, crewId);
    const bobSocket = await joinedCrewSocket(server, server.baseUrl, bob.token, crewId);

    // Exercise the full lifecycle: share → update → stop.
    await emitWithAck(aliceSocket, 'location:share', { crewId, position: VALID_FIX });
    const peerUpdate = waitForEvent(bobSocket, 'location:peer-update', () => true);
    aliceSocket.emit('location:update', { crewId, ...VALID_FIX });
    await peerUpdate;
    await emitWithAck(aliceSocket, 'location:stop', { crewId });

    // Inspect the durable store directly — there must be zero location rows.
    const pool = new Pool({ connectionString: server.databaseUrl });
    try {
      const { rows } = await pool.query(`SELECT type FROM crew_activity WHERE crew_id = $1`, [crewId]);
      const types = rows.map((r: any) => r.type);
      assert.ok(
        !types.some((t: string) => /location|share|update/i.test(t)),
        `live location must never persist; found activity types: ${JSON.stringify(types)}`,
      );
    } finally {
      await pool.end();
    }

    aliceSocket.close();
    bobSocket.close();
  });
});
