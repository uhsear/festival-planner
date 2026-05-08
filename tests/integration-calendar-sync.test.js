const { afterEach, describe, test } = require('node:test');
const {
  assert,
  startServer,
  registerUser,
  joinFestivalProfile,
} = require('./_integration-helpers');

const servers = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Calendar Sync', { concurrency: 1 }, () => {
  test('creates a calendar sync token and retrieves ICS feed', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'calsync-alice-' + Date.now());
    const profile = await joinFestivalProfile(server, alice.token);

    // Add a pick so the ICS has content
    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', alice.token)
      .send({ picks: { 'set-a': 'must' } })
      .expect(200);

    // Create calendar sync token
    const syncRes = await server.request
      .post('/api/v1/calendar-sync/fest-1')
      .set('x-user-token', alice.token)
      .expect(200);

    assert.equal(syncRes.body.error, null);
    assert.ok(syncRes.body.data.url, 'Should return a calendar URL');
    assert.ok(syncRes.body.data.tokenId, 'Should return a token ID');

    // Extract the token from the URL
    const tokenId = syncRes.body.data.tokenId;

    // Fetch the ICS feed (no auth needed — token-based)
    const icsRes = await server.request
      .get(`/cal/${tokenId}.ics`)
      .expect(200)
      .expect('Content-Type', /text\/calendar/);

    const icsBody = icsRes.text;
    assert.ok(icsBody.includes('BEGIN:VCALENDAR'), 'ICS should contain VCALENDAR');
    assert.ok(icsBody.includes('END:VCALENDAR'), 'ICS should end VCALENDAR');
    assert.ok(icsBody.includes('BEGIN:VEVENT'), 'ICS should contain at least one VEVENT (for set-a pick)');
    assert.ok(icsBody.includes('Alpha'), 'ICS should include artist name Alpha from set-a');
  });

  test('returns the same token on repeated calls (idempotent)', async () => {
    const server = await startServer();
    servers.push(server);

    const bob = await registerUser(server, 'calsync-bob-' + Date.now());
    await joinFestivalProfile(server, bob.token);

    const first = await server.request
      .post('/api/v1/calendar-sync/fest-1')
      .set('x-user-token', bob.token)
      .expect(200);

    const second = await server.request
      .post('/api/v1/calendar-sync/fest-1')
      .set('x-user-token', bob.token)
      .expect(200);

    // The token should be the same (upsert behavior)
    assert.equal(first.body.data.url, second.body.data.url);
  });

  test('requires authentication to create a sync token', async () => {
    const server = await startServer();
    servers.push(server);

    await server.request
      .post('/api/v1/calendar-sync/fest-1')
      .expect(401);
  });

  test('returns 404 when user has no profile for the festival', async () => {
    const server = await startServer();
    servers.push(server);

    const charlie = await registerUser(server, 'calsync-charlie-' + Date.now());
    // Do NOT join a festival profile

    const res = await server.request
      .post('/api/v1/calendar-sync/fest-1')
      .set('x-user-token', charlie.token)
      .expect(404);

    assert.ok(res.body.error, 'Should return an error');
  });

  test('returns 404 for ICS feed with invalid token', async () => {
    const server = await startServer();
    servers.push(server);

    await server.request
      .get('/cal/nonexistent-token-' + Date.now() + '.ics')
      .expect(404);
  });

  test('ICS feed contains no events when user has no picks', async () => {
    const server = await startServer();
    servers.push(server);

    const dave = await registerUser(server, 'calsync-dave-' + Date.now());
    await joinFestivalProfile(server, dave.token);

    const syncRes = await server.request
      .post('/api/v1/calendar-sync/fest-1')
      .set('x-user-token', dave.token)
      .expect(200);

    const tokenId = syncRes.body.data.tokenId;

    const icsRes = await server.request
      .get(`/cal/${tokenId}.ics`)
      .expect(200);

    const icsBody = icsRes.text;
    assert.ok(icsBody.includes('BEGIN:VCALENDAR'), 'ICS should still be valid');
    assert.ok(!icsBody.includes('BEGIN:VEVENT'), 'ICS should have no events when no picks');
  });
});
