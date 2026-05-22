import { afterEach, describe, test } from 'node:test';
import {
  assert,
  startServer,
  registerUser,
} from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Notifications', { concurrency: 1 }, () => {
  test('notification endpoints: tokens, preferences, read status, and history', async () => {
    const server = await startServer();
    servers.push(server);
    const alice = await registerUser(server, 'alice');

    // Register a device token
    const regRes = await server.request
      .post('/api/v1/notifications/token')
      .set('x-user-token', alice.token)
      .send({ token: 'fcm-test-token-abc123456789', platform: 'web' })
      .expect(200);
    assert.ok(regRes.body.data);
    assert.equal(regRes.body.data.success, true);

    // Duplicate token registration should be idempotent
    const dupRes = await server.request
      .post('/api/v1/notifications/token')
      .set('x-user-token', alice.token)
      .send({ token: 'fcm-test-token-abc123456789', platform: 'web' })
      .expect(200);
    assert.equal(dupRes.body.data.success, true);

    // Get unread count (should be 0 for new user)
    const unreadRes = await server.request
      .get('/api/v1/notifications/unread')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.ok(unreadRes.body.data);
    assert.equal(unreadRes.body.data.total, 0);
    assert.ok(Array.isArray(unreadRes.body.data.byFestival));

    // Mark as read (should succeed even with 0 unread)
    const readRes = await server.request
      .post('/api/v1/notifications/read')
      .set('x-user-token', alice.token)
      .send({ festivalId: 'fest-1' })
      .expect(200);
    assert.equal(readRes.body.data.badgeCount, 0);

    // Get preferences (null for new user → should return defaults or null)
    const prefsRes = await server.request
      .get('/api/v1/notifications/prefs')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.ok(prefsRes.body.data !== undefined);

    // Update preferences
    const updatePrefsRes = await server.request
      .put('/api/v1/notifications/prefs')
      .set('x-user-token', alice.token)
      .send({ crewUpdates: false, setReminders: true, dndStart: '22:00', dndEnd: '08:00' })
      .expect(200);
    assert.ok(updatePrefsRes.body.data);

    // Verify updated preferences persist
    const prefsRes2 = await server.request
      .get('/api/v1/notifications/prefs')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.equal(prefsRes2.body.data.crewUpdates, 0);
    assert.equal(prefsRes2.body.data.setReminders, 1);
    assert.equal(prefsRes2.body.data.dndStart, '22:00');
    assert.equal(prefsRes2.body.data.dndEnd, '08:00');

    // Get history (empty for new user)
    const histRes = await server.request
      .get('/api/v1/notifications/history')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.ok(histRes.body.data !== undefined);

    // Unregister device token
    const unreg = await server.request
      .delete('/api/v1/notifications/token')
      .set('x-user-token', alice.token)
      .send({ token: 'fcm-test-token-abc123456789' })
      .expect(200);
    assert.equal(unreg.body.data.success, true);

    // Unregister already-deleted token should handle gracefully
    const unregAgain = await server.request
      .delete('/api/v1/notifications/token')
      .set('x-user-token', alice.token)
      .send({ token: 'fcm-test-token-abc123456789' });
    // May return 200 or 404 — both are acceptable
    assert.ok([200, 404].includes(unregAgain.status));
  });

  test('notification endpoints reject unauthenticated requests', async () => {
    const server = await startServer();
    servers.push(server);

    // All notification endpoints should require auth
    await server.request.get('/api/v1/notifications/unread').expect(401);
    await server.request.get('/api/v1/notifications/prefs').expect(401);
    await server.request.get('/api/v1/notifications/history').expect(401);
    await server.request.post('/api/v1/notifications/token').send({ token: 'x' }).expect(401);
    await server.request.post('/api/v1/notifications/read').send({}).expect(401);
    await server.request.put('/api/v1/notifications/prefs').send({}).expect(401);
  });

  test('notification preferences validation rejects invalid input', async () => {
    const server = await startServer();
    servers.push(server);
    const alice = await registerUser(server, 'alice');

    // Invalid DND time format should return 400
    const badDnd = await server.request
      .put('/api/v1/notifications/prefs')
      .set('x-user-token', alice.token)
      .send({ dndStart: 'not-a-time', dndEnd: '08:00' });
    assert.equal(badDnd.status, 400);

    // Valid DND time format should succeed
    const goodDnd = await server.request
      .put('/api/v1/notifications/prefs')
      .set('x-user-token', alice.token)
      .send({ dndStart: '22:00', dndEnd: '08:00' })
      .expect(200);
    assert.ok(goodDnd.body.data);

    // Empty token registration should fail
    const emptyToken = await server.request
      .post('/api/v1/notifications/token')
      .set('x-user-token', alice.token)
      .send({ token: '', platform: 'web' })
      .expect(400);
    assert.ok(emptyToken.body.error);

    // Token too short (< 20 chars) should fail
    const shortToken = await server.request
      .post('/api/v1/notifications/token')
      .set('x-user-token', alice.token)
      .send({ token: 'short', platform: 'web' })
      .expect(400);
    assert.ok(shortToken.body.error);

    // Invalid platform should fail
    const badPlatform = await server.request
      .post('/api/v1/notifications/token')
      .set('x-user-token', alice.token)
      .send({ token: 'fcm-test-token-abc123456789', platform: 'invalid' })
      .expect(400);
    assert.ok(badPlatform.body.error);

    // Updating prefs with no valid fields should fail
    const noFields = await server.request
      .put('/api/v1/notifications/prefs')
      .set('x-user-token', alice.token)
      .send({ unknownField: true });
    assert.equal(noFields.status, 400);
  });

  test('notification token registration enforces rate limits', async () => {
    const server = await startServer();
    servers.push(server);
    const alice = await registerUser(server, 'alice');

    // Register 5 tokens (the rate limit)
    for (let i = 0; i < 5; i++) {
      await server.request
        .post('/api/v1/notifications/token')
        .set('x-user-token', alice.token)
        .send({ token: `fcm-test-token-${i}123456789`, platform: 'web' })
        .expect(200);
    }

    // 6th token should hit rate limit (429)
    const rateLimitRes = await server.request
      .post('/api/v1/notifications/token')
      .set('x-user-token', alice.token)
      .send({ token: 'fcm-test-token-5123456789', platform: 'web' });
    assert.equal(rateLimitRes.status, 429);
  });
});
