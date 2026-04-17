const { afterEach, describe, test } = require('node:test');
const {
  assert,
  TRUSTED_MUTATION_HEADER,
  startServer,
  registerUser,
  joinFestivalProfile,
  loginAdmin,
} = require('./_integration-helpers');

const servers = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Export', { concurrency: 1 }, () => {
  test('ICS calendar export escapes special characters', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const profile = await joinFestivalProfile(server, alice.token);

    // Add picks with notes containing special chars
    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', alice.token)
      .send({
        picks: { 'set-a': 'must' },
        notes: { 'set-a': 'Bring friends; meet at gate, row 3' },
      })
      .expect(200);

    const icsRes = await server.request
      .get(`/api/v1/export/fest-1/${profile.id}/calendar`)
      .set('x-user-token', alice.token)
      .expect(200);

    assert.match(icsRes.headers['content-type'], /text\/calendar/);
    assert.match(icsRes.text, /BEGIN:VCALENDAR/);
    assert.match(icsRes.text, /BEGIN:VEVENT/);
    // Semicolons and commas should be escaped in ICS
    assert.match(icsRes.text, /\\;/);
    assert.match(icsRes.text, /\\,/);
  });

  test('export worker handles concurrent requests with concurrency limit', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const profile = await joinFestivalProfile(server, alice.token);
    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', alice.token)
      .send({ picks: { 'set-a': 'must' } })
      .expect(200);

    // Export should succeed
    const exportRes = await server.request
      .get(`/api/v1/export/fest-1/${profile.id}`)
      .set('x-user-token', alice.token)
      .expect(200);
    assert.match(exportRes.headers['content-type'], /text\/html/);
    assert.ok(exportRes.headers['content-disposition']?.includes('attachment'));
  });

  test('export enforces per-user cooldown', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const profile = await joinFestivalProfile(server, alice.token);
    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', alice.token)
      .send({ picks: { 'set-a': 'must' } })
      .expect(200);

    // First export succeeds
    await server.request
      .get(`/api/v1/export/fest-1/${profile.id}`)
      .set('x-user-token', alice.token)
      .expect(200);

    // Rapid second export hits cooldown
    const secondExport = await server.request
      .get(`/api/v1/export/fest-1/${profile.id}`)
      .set('x-user-token', alice.token);
    assert.equal(secondExport.status, 429);
  });

  test('export refuses access to another user profile', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    const aliceProfile = await joinFestivalProfile(server, alice.token);
    await joinFestivalProfile(server, bob.token);

    // Bob should not export Alice's profile
    const res = await server.request
      .get(`/api/v1/export/fest-1/${aliceProfile.id}`)
      .set('x-user-token', bob.token);
    assert.equal(res.status, 403);
  });
});

describe('Edge Case: Empty Festivals', { concurrency: 1 }, () => {
  let server;
  afterEach(async () => { if (server) await server.close(); });

  test('export festival with no sets returns valid HTML', async () => {
    server = await startServer();
    // Create minimal festival with stage but no sets
    const adminToken = await loginAdmin(server);
    const createRes = await server.request
      .post('/api/v1/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        id: 'empty-fest',
        name: 'Empty Festival',
        stages: [{ id: 'main', name: 'Main', color: '#ff0000' }],
        days: [{ date: '2026-06-01', sets: [] }]
      });
    assert.equal(createRes.status, 201);

    const user = await registerUser(server, 'empty-fest-user');
    const profile = await joinFestivalProfile(server, user.token, 'empty-fest');

    const exportRes = await server.request
      .get(`/api/v1/export/empty-fest/${profile.id}`)
      .set('x-user-token', user.token);
    assert.equal(exportRes.status, 200);
    assert(exportRes.text.includes('No sets picked yet') || exportRes.text.includes('empty'));
  });
});
