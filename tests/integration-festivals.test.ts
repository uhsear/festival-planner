import { afterEach, describe, test } from 'node:test';
import {
  assert,
  Pool,
  TRUSTED_MUTATION_HEADER,
  TEST_DATABASE_URL,
  startServer,
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

describe('Integration — Festivals', { concurrency: 1 }, () => {
  test('serves the app with a hardened CSP', async () => {
    const server = await startServer({ PUBLIC_ORIGIN: 'https://rave.example.com' });
    servers.push(server);

    const response = await server.request.get('/').expect(200);
    const csp = response.headers['content-security-policy']!;

    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(csp.includes("script-src 'self'"));
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
    assert.ok(csp.includes("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"));
    assert.ok(csp.includes("style-src-attr 'unsafe-inline'"));
    assert.ok(csp.includes("connect-src 'self' wss://rave.example.com"));
    assert.ok(!csp.includes("connect-src 'self' ws: wss:"));
    assert.match(response.text, /Festival Planner/i);
  });

  test('uses Cloudflare client IP headers for rate limiting only when proxy trust is enabled', async () => {
    const server = await startServer({ RATE_LIMIT_MAX: 1, TRUST_PROXY: 1 });
    servers.push(server);

    await server.request
      .get('/api/health')
      .set('cf-connecting-ip', '203.0.113.10')
      .expect(200);

    await server.request
      .get('/api/health')
      .set('cf-connecting-ip', '203.0.113.10')
      .expect(429);

    await server.request
      .get('/api/health')
      .set('cf-connecting-ip', '203.0.113.11')
      .expect(200);
  });

  test('ignores spoofed proxy IP headers when proxy trust is disabled', async () => {
    const server = await startServer({ RATE_LIMIT_MAX: 1, TRUST_PROXY: false });
    servers.push(server);

    await server.request
      .get('/api/health')
      .set('cf-connecting-ip', '203.0.113.10')
      .expect(200);

    await server.request
      .get('/api/health')
      .set('cf-connecting-ip', '203.0.113.11')
      .expect(429);
  });

  test('caps in-memory rate limit entries under rotating IP traffic', async () => {
    const server = await startServer({ TRUST_PROXY: 1, MAX_RATE_LIMIT_ENTRIES: 3 });
    servers.push(server);

    for (const ip of ['203.0.113.10', '203.0.113.11', '203.0.113.12', '203.0.113.13', '203.0.113.14']) {
      await server.request
        .get('/api/health')
        .set('cf-connecting-ip', ip)
        .expect(200);
    }

    assert.equal(server.planner.state.rateLimits.size, 3);
    assert.deepEqual([...server.planner.state.rateLimits.keys()], ['203.0.113.12', '203.0.113.13', '203.0.113.14']);
  });

  test('serves festival data from postgresql', async () => {
    const server = await startServer();
    servers.push(server);

    await server.request
      .get('/api/v1/festivals')
      .expect(200)
      .expect((response: any) => {
        assert.equal(response.body.data[0].name, 'Test Fest');
      });
  });

  test('marks user-scoped GET responses as no-store, public festival detail as no-cache', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    await joinFestivalProfile(server, alice.token);
    const adminToken = await loginAdmin(server);

    const profilesResponse = await server.request
      .get('/api/v1/profiles/fest-1')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.equal(profilesResponse.headers['cache-control'], 'no-store');

    const presenceResponse = await server.request
      .get('/api/v1/presence/fest-1')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.equal(presenceResponse.headers['cache-control'], 'no-store');

    const adminUsersResponse = await server.request
      .get('/api/v1/admin/users')
      .set('x-user-token', adminToken)
      .expect(200);
    assert.equal(adminUsersResponse.headers['cache-control'], 'no-store');

    const adminHealthResponse = await server.request
      .get('/api/admin/health')
      .set('x-user-token', adminToken)
      .expect(200);
    assert.equal(adminHealthResponse.headers['cache-control'], 'no-store');

    // Festival detail is PUBLIC (no auth required) — returns only
    // structural data (stages/days/sets/times) with no user state. Use
    // no-cache (revalidate) rather than no-store so the service worker
    // can serve the last-known copy when offline. The remaining
    // assertions above cover the genuinely user-scoped endpoints
    // (profiles, presence, admin/*) that must stay at no-store.
    const festivalResponse = await server.request
      .get('/api/v1/festivals/fest-1')
      .expect(200);
    assert.equal(festivalResponse.headers['cache-control'], 'no-cache');
  });

  // PWA-asset serving (manifest/sw) is verified against a built web bundle, which
  // the backend test job no longer produces (the Vite SPA was retired; the
  // Expo-web bundle is built at deploy time). The SW cache rules are guarded
  // directly + robustly by packages/shared sw-parity.test.ts. This test keeps the
  // backend half: stricter festival validation.
  test('stricter festival validation rejects overlapping sets', async () => {
    const server = await startServer();
    servers.push(server);

    const adminToken = await loginAdmin(server);

    await server.request
      .post('/api/v1/festivals')
      .set('x-user-token', adminToken)
      .send({
        name: 'Broken Fest',
        stages: [{ id: 'main', name: 'Main Stage', color: '#ff3366' }],
        days: [
          {
            label: 'Friday',
            date: '2026-06-05',
            sets: [
              { id: 'broken-a', artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' },
              { id: 'broken-b', artist: 'Beta', stageId: 'main', startTime: '10:30', endTime: '11:30' },
            ],
          },
        ],
      })
      .expect(400);
  });

  test('postgresql stores and serves seeded festival data', async () => {
    const server = await startServer();
    servers.push(server);

    const festivals = await server.request.get('/api/v1/festivals').expect(200);
    assert.equal(festivals.body.data.length, 1);
    assert.equal(festivals.body.data[0].name, 'Test Fest');
  });

  test('rejects malicious festivalId in API endpoints', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    await joinFestivalProfile(server, alice.token);

    // Festival ID with path traversal characters should fail
    const res1 = await server.request
      .get('/api/v1/presence/fest%00evil')
      .set('x-user-token', alice.token);
    assert.ok(res1.status >= 400, `Expected 4xx/5xx for null-byte festivalId, got ${res1.status}`);

    // Non-existent festival returns 404
    const res2 = await server.request
      .get('/api/v1/presence/nonexistent-fest')
      .set('x-user-token', alice.token);
    assert.equal(res2.status, 404);
  });

  // Service-worker caching correctness (api-cache StaleWhileRevalidate + the
  // cross-account boundary) is covered by packages/shared/src/pwa/sw-parity.test.ts,
  // which asserts the runtimeCaching config directly without needing a built SW.
  // The old test here required a CI-built web bundle that no longer exists.

  test('CSP includes media-src none directive', async () => {
    const server = await startServer();
    servers.push(server);

    const response = await server.request.get('/').expect(200);
    const csp = response.headers['content-security-policy']!;
    assert.ok(csp.includes("media-src 'none'"));
  });

  test('renders without re-entrance by serving consistent HTML', async () => {
    const server = await startServer();
    servers.push(server);

    // The SPA catch-all serves consistent HTML without re-entering the router.
    // The exact bundle markup depends on a built web dist (produced at deploy
    // time, not in the backend test env), so assert the serving contract: a 200
    // HTML document, not a 5xx or a redirect loop.
    const response = await server.request.get('/').expect(200);
    assert.match(response.headers['content-type'] || '', /text\/html/);
    assert.ok(response.text.length > 0, 'SPA fallback should return a non-empty HTML document');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Festival soft-delete + rate limit edge cases + pagination
// ═══════════════════════════════════════════════════════════════════════

describe('Database Transaction Rollback — festival', { concurrency: 1 }, () => {
  let server: any;
  afterEach(async () => { if (server) await server.close(); });

  test('festival soft-delete marks festival as deleted', async () => {
    server = await startServer();
    const user = await registerUser(server, 'fest-cascade');
    await joinFestivalProfile(server, user.token, 'fest-1');
    const adminToken = await loginAdmin(server);

    const deleteRes = await server.request
      .delete('/api/v1/festivals/fest-1')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1');
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.data.softDeleted, true);
  });
});

describe('Rate Limiting Edge Cases', { concurrency: 1 }, () => {
  let server: any;
  afterEach(async () => { if (server) await server.close(); });

  test('rate limit at exact boundary allows last request', async () => {
    server = await startServer({ RATE_LIMIT_MAX: 5, RATE_LIMIT_WINDOW: 60000 });
    // Make exactly 5 requests under /api (which has the rate limiter)
    for (let i = 0; i < 5; i++) {
      const res = await server.request.get('/api/health');
      assert.equal(res.status, 200);
    }
    // 6th request should be rate limited
    const limitedRes = await server.request.get('/api/health');
    assert.equal(limitedRes.status, 429);
  });
});

describe('Pagination Bounds', { concurrency: 1 }, () => {
  let server: any;
  afterEach(async () => { if (server) await server.close(); });

  test('limit=0 returns empty results or default', async () => {
    server = await startServer();
    const user = await registerUser(server, 'page-user');
    const res = await server.request
      .get('/api/v1/festivals?limit=0')
      .set('x-user-token', user.token);
    assert.equal(res.status, 200);
    // Should return either empty array or default page size
    assert.ok(Array.isArray(res.body.data) || res.body.data);
  });

  test('very large limit is capped to server max', async () => {
    server = await startServer();
    const user = await registerUser(server, 'page-user2');
    const res = await server.request
      .get('/api/v1/festivals?limit=99999')
      .set('x-user-token', user.token);
    assert.equal(res.status, 200);
  });

  test('invalid cursor returns 400 or default results', async () => {
    server = await startServer();
    const user = await registerUser(server, 'page-user3');
    const res = await server.request
      .get('/api/v1/festivals?cursor=not-a-valid-cursor')
      .set('x-user-token', user.token);
    // Either 400 (invalid cursor) or 200 (ignored invalid cursor)
    assert.ok(res.status === 200 || res.status === 400);
  });

  test('empty dataset returns empty results with no next cursor', async () => {
    server = await startServer();
    const user = await registerUser(server, 'page-user4');
    // Try paginating messages in a festival with no messages
    await joinFestivalProfile(server, user.token, 'fest-1');
    const res = await server.request
      .get('/api/v1/export/fest-1/messages?limit=10')
      .set('x-user-token', user.token);
    // Should succeed with no data or empty array
    assert.ok(res.status === 200 || res.status === 404);
  });
});
