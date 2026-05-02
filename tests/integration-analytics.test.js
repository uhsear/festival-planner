const { afterEach, describe, test } = require('node:test');
const {
  assert,
  Pool,
  TEST_DATABASE_URL,
  startServer,
} = require('./_integration-helpers');

const servers = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Analytics Install', { concurrency: 1 }, () => {
  test('tracks a valid install event and returns 204', async () => {
    const server = await startServer();
    servers.push(server);

    await server.request
      .post('/api/v1/analytics/install')
      .send({ platform: 'ios', event: 'shown' })
      .expect(204);

    // Verify the event was persisted
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query(
        'SELECT * FROM install_events ORDER BY created_at DESC LIMIT 1'
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].platform, 'ios');
      assert.equal(rows[0].event, 'shown');
    } finally {
      await pool.end();
    }
  });

  test('accepts all valid platform and event combinations', async () => {
    const server = await startServer();
    servers.push(server);

    const platforms = ['ios', 'android', 'desktop'];
    const events = ['shown', 'accepted', 'dismissed', 'native_fired', 'inapp_blocked'];

    for (const platform of platforms) {
      for (const event of events) {
        await server.request
          .post('/api/v1/analytics/install')
          .send({ platform, event })
          .expect(204);
      }
    }

    // Verify all 15 events were persisted
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM install_events');
      assert.equal(rows[0].count, platforms.length * events.length);
    } finally {
      await pool.end();
    }
  });

  test('rejects invalid platform values with 400', async () => {
    const server = await startServer();
    servers.push(server);

    const res = await server.request
      .post('/api/v1/analytics/install')
      .send({ platform: 'windows', event: 'shown' })
      .expect(400);

    assert.ok(res.body.error, 'Should return an error message');
    assert.match(res.body.error, /invalid platform/i);
  });

  test('rejects invalid event values with 400', async () => {
    const server = await startServer();
    servers.push(server);

    const res = await server.request
      .post('/api/v1/analytics/install')
      .send({ platform: 'ios', event: 'clicked' })
      .expect(400);

    assert.ok(res.body.error, 'Should return an error message');
    assert.match(res.body.error, /invalid event/i);
  });

  test('rejects missing fields with 400', async () => {
    const server = await startServer();
    servers.push(server);

    // Missing event
    const res1 = await server.request
      .post('/api/v1/analytics/install')
      .send({ platform: 'ios' })
      .expect(400);
    assert.ok(res1.body.error);

    // Missing platform
    const res2 = await server.request
      .post('/api/v1/analytics/install')
      .send({ event: 'shown' })
      .expect(400);
    assert.ok(res2.body.error);

    // Empty body
    const res3 = await server.request
      .post('/api/v1/analytics/install')
      .send({})
      .expect(400);
    assert.ok(res3.body.error);
  });

  test('stores optional fields: reason and engagement_ms', async () => {
    const server = await startServer();
    servers.push(server);

    await server.request
      .post('/api/v1/analytics/install')
      .send({
        platform: 'android',
        event: 'dismissed',
        reason: 'user swiped away',
        engagement_ms: 5000,
      })
      .expect(204);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query(
        "SELECT * FROM install_events WHERE platform = 'android' AND event = 'dismissed' ORDER BY created_at DESC LIMIT 1"
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].reason, 'user swiped away');
      assert.equal(rows[0].engagement_ms, 5000);
    } finally {
      await pool.end();
    }
  });

  test('does not require authentication (anonymous install tracking)', async () => {
    const server = await startServer();
    servers.push(server);

    // No auth header needed
    await server.request
      .post('/api/v1/analytics/install')
      .send({ platform: 'desktop', event: 'accepted' })
      .expect(204);
  });

  test('clamps engagement_ms to valid range', async () => {
    const server = await startServer();
    servers.push(server);

    // Negative value should be clamped to 0
    await server.request
      .post('/api/v1/analytics/install')
      .send({ platform: 'ios', event: 'shown', engagement_ms: -100 })
      .expect(204);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query(
        'SELECT engagement_ms FROM install_events ORDER BY created_at DESC LIMIT 1'
      );
      assert.equal(rows[0].engagement_ms, 0, 'Negative engagement_ms should be clamped to 0');
    } finally {
      await pool.end();
    }
  });
});
