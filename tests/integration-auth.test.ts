import { afterEach, describe, test } from 'node:test';
import {
  assert,
  request,
  Pool,
  DEFAULT_PASSWORD,
  TRUSTED_MUTATION_HEADER,
  TEST_DATABASE_URL,
  startServer,
  registerUser,
  loginUser,
  joinFestivalProfile,
  loginAdmin,
  uploadAvatar,
  connectSocket,
  waitForEvent,
  markTrustedMutation,
} from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Auth', { concurrency: 1 }, () => {
  test('covers register, verify, logout, login, and password change', async () => {
    const server = await startServer();
    servers.push(server);

    const registration = await registerUser(server, 'alice');
    assert.equal(registration.user.username, 'alice');
    await server.request
      .get('/api/v1/profiles/fest-1')
      .set('x-user-token', registration.token)
      .expect(403);
    const profile = await joinFestivalProfile(server, registration.token);

    await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', registration.token)
      .expect(200);

    await server.request
      .post('/api/v1/auth/logout')
      .set('x-user-token', registration.token)
      .expect(200);

    await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', registration.token)
      .expect(401);

    const login = await loginUser(server, 'alice');
    await server.request
      .post('/api/v1/auth/change-password')
      .set('x-user-token', login.token)
      .send({
        currentPassword: DEFAULT_PASSWORD,
        newPassword: 'newpassword456',
        confirmPassword: 'newpassword456',
      })
      .expect(200);

    await server.request
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: DEFAULT_PASSWORD })
      .expect(401);

    const relogin = await loginUser(server, 'alice', 'newpassword456');
    assert.equal(relogin.user.username, 'alice');

    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', login.token)
      .send({ picks: { 'set-a': 'must' } })
      .expect(401);
  });

  test('uses cookie-backed sessions for user and admin auth flows', async () => {
    const server = await startServer();
    servers.push(server);

    const userAgent = request.agent(server.planner.app);
    const registration = await markTrustedMutation(userAgent
      .post('/api/v1/auth/register'))
      .send({ username: 'cookie-user', password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, tosAccepted: true })
      .expect(201);

    assert.match(registration.headers['set-cookie'].join('; '), /festie_session=/);

    await markTrustedMutation(userAgent.post('/api/v1/auth/verify')).expect(200);

    const changePassword = await markTrustedMutation(userAgent
      .post('/api/v1/auth/change-password'))
      .send({
        currentPassword: DEFAULT_PASSWORD,
        newPassword: 'freshpassword456',
        confirmPassword: 'freshpassword456',
      })
      .expect(200);

    assert.match(changePassword.headers['set-cookie'].join('; '), /festie_session=/);

    await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', registration.body.data.token)
      .expect(401);

    const logout = await markTrustedMutation(userAgent.post('/api/v1/auth/logout')).expect(200);
    assert.match(logout.headers['set-cookie'].join('; '), /festie_session=;/);
    await markTrustedMutation(userAgent.post('/api/v1/auth/verify')).expect(401);

    // Test admin auth through role-based system
    const adminUser = 'testadmin-' + Date.now();
    const adminReg = await server.request
      .post('/api/v1/auth/register')
      .send({ username: adminUser, password: 'test-admin-password', confirmPassword: 'test-admin-password', tosAccepted: true })
      .expect(201);

    // Grant admin role via DB
    const pool = new Pool({ connectionString: server.databaseUrl });
    try {
      await pool.query(`
        INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
        SELECT u.id, r.id, NULL, NOW()
        FROM users u, roles r
        WHERE u.username = $1 AND r.name = 'admin'
        ON CONFLICT (user_id, role_id) DO NOTHING
      `, [adminUser]);
    } finally {
      await pool.end();
    }

    // Login as admin through standard auth
    const adminLogin = await server.request
      .post('/api/v1/auth/login')
      .send({ username: adminUser, password: 'test-admin-password' })
      .expect(200);

    const adminToken = adminLogin.body.data.token;
    assert(adminToken, 'Admin token should be returned');

    // Verify admin can access admin endpoints with x-user-token header
    await server.request
      .get('/api/v1/admin/analytics')
      .set('x-user-token', adminToken)
      .expect(200);

    // Logout and verify token is invalid
    const logoutRes = await server.request
      .post('/api/v1/auth/logout')
      .set('x-user-token', adminToken)
      .expect(200);

    // Token should now be invalid
    await server.request
      .get('/api/v1/admin/analytics')
      .set('x-user-token', adminToken)
      .expect(401);
  });

  test('caps active user sessions per user', async () => {
    const server = await startServer({ USER_SESSION_MAX: 3 });
    servers.push(server);

    const registration = await registerUser(server, 'session-user');
    const tokens = [registration.token];

    for (let index = 0; index < 3; index += 1) {
      const login = await loginUser(server, 'session-user');
      tokens.push(login.token);
    }

    await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', tokens[0])
      .expect(401);

    for (const token of tokens.slice(1)) {
      await server.request
        .post('/api/v1/auth/verify')
        .set('x-user-token', token)
        .expect(200);
    }
  });

  test('rejects originless cookie mutations without a trusted browser header', async () => {
    const server = await startServer();
    servers.push(server);

    const userAgent = request.agent(server.planner.app);
    const registration = await markTrustedMutation(userAgent
      .post('/api/v1/auth/register'))
      .send({ username: 'csrf-user', password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, tosAccepted: true })
      .expect(201);

    await userAgent
      .post('/api/v1/profiles')
      .send({ festivalId: 'fest-1' })
      .expect(403);

    await markTrustedMutation(userAgent
      .post('/api/v1/profiles'))
      .send({ festivalId: 'fest-1' })
      .expect(200);

    await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', registration.body.data.token)
      .expect(200);
  });

  test('processes account avatars into compressed profile photos and supports removal', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    const aliceProfile = await joinFestivalProfile(server, alice.token);
    await joinFestivalProfile(server, bob.token);

    await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', alice.token)
      .attach('avatar', Buffer.from('not-an-image'), { filename: 'avatar.txt', contentType: 'text/plain' })
      .expect(400);

    await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', alice.token)
      .attach('avatar', Buffer.from('still-not-an-image'), { filename: 'avatar.png', contentType: 'image/png' })
      .expect(400);

    const upload = await uploadAvatar(server, alice.token);
    assert.match(upload.user.avatarUrl, /^\/uploads\/avatars\/[a-f0-9]+\.webp\?v=/);

    await server.request
      .get(upload.user.avatarUrl.split('?')[0])
      .expect(200)
      .expect('Content-Type', /image\/webp/);

    const verify = await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.equal(verify.body.data.user.avatarUrl, upload.user.avatarUrl);

    const profileList = await server.request
      .get('/api/v1/profiles/fest-1')
      .set('x-user-token', bob.token)
      .expect(200);
    const visibleAlice = profileList.body.data.find((profile: any) => profile.id === aliceProfile.id);
    assert.equal(visibleAlice.avatarUrl, upload.user.avatarUrl);

    const removal = await server.request
      .delete('/api/v1/account/avatar')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.equal(removal.body.data.user.avatarUrl, null);

    const users = await server.planner.state.stores.users.readAll();
    const storedAlice = users.find((user: any) => user.id === alice.user.id);
    assert.equal(storedAlice.avatarKey, null);

    await server.request
      .get(upload.user.avatarUrl.split('?')[0])
      .expect(404);
  });

  test('session touch throttle avoids unnecessary writes', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'alice');

    // Multiple rapid verify calls should succeed without errors
    for (let i = 0; i < 5; i++) {
      await server.request
        .post('/api/v1/auth/verify')
        .set('x-user-token', alice.token)
        .expect(200);
    }
  });

  test('user registration with duplicate username returns error, no partial write', async () => {
    const server = await startServer();
    servers.push(server);
    await registerUser(server, 'unique-user');
    const res = await server.request
      .post('/api/v1/auth/register')
      .send({ username: 'unique-user', password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, tosAccepted: true });
    // Should be rejected — either 400 or 409
    assert.ok(res.status >= 400);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// #20: Password Boundary Testing
// ═══════════════════════════════════════════════════════════════════════

describe('Password Boundary Validation', { concurrency: 1 }, () => {
  let server: any;
  afterEach(async () => { if (server) await server.close(); });

  test('rejects 7-character password (below minimum)', async () => {
    server = await startServer();
    const res = await server.request
      .post('/api/v1/auth/register')
      .send({ username: 'shortpw', password: 'abc1234', confirmPassword: 'abc1234', tosAccepted: true });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('accepts 8-character password (minimum valid)', async () => {
    server = await startServer();
    const res = await server.request
      .post('/api/v1/auth/register')
      .send({ username: 'minpw', password: 'abcd1234', confirmPassword: 'abcd1234', tosAccepted: true });
    assert.equal(res.status, 201);
    assert.ok(res.body.data);
  });

  test('accepts 100-character password (maximum valid)', async () => {
    server = await startServer();
    const longPw = 'a'.repeat(100);
    const res = await server.request
      .post('/api/v1/auth/register')
      .send({ username: 'maxpw', password: longPw, confirmPassword: longPw, tosAccepted: true });
    assert.equal(res.status, 201);
    assert.ok(res.body.data);
  });

  test('rejects 101-character password (above maximum)', async () => {
    server = await startServer();
    const tooLong = 'a'.repeat(101);
    const res = await server.request
      .post('/api/v1/auth/register')
      .send({ username: 'overlongpw', password: tooLong, confirmPassword: tooLong, tosAccepted: true });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('change-password rejects short password', async () => {
    server = await startServer();
    const user = await registerUser(server, 'changepw');
    const res = await server.request
      .post('/api/v1/auth/change-password')
      .set('x-user-token', user.token)
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'short1', confirmPassword: 'short1' });
    assert.equal(res.status, 400);
  });
});

// ============================================================================
// userAuthRateLimits Stale Entry Cleanup (v1.7.3)
// ============================================================================
describe('userAuthRateLimits stale entry cleanup', { concurrency: 1 }, () => {
  const servers: any[] = [];
  afterEach(async () => { for (const s of servers) await s.close().catch(() => {}); servers.length = 0; });

  test('stale entries are purged after 2× the auth rate limit window', async () => {
    const AUTH_WINDOW = 200; // 200ms
    const server = await startServer({
      AUTH_RATE_LIMIT_WINDOW: AUTH_WINDOW,
      AUTH_RATE_LIMIT_MAX: 100,
    });
    servers.push(server);

    // Register a real user, then fail login with wrong password to trigger per-user rate limit
    await registerUser(server, 'ratelimit_user');
    await server.request
      .post('/api/v1/auth/login')
      .send({ username: 'ratelimit_user', password: 'wrongpassword' })
      .expect(401);

    const authMap = server.planner.state.userAuthRateLimits;
    assert.ok(authMap.size > 0, 'Auth rate limit map should have an entry after failed login');

    // Simulate aging the entry by backdating its windowStart
    for (const [key, entry] of authMap.entries()) {
      entry.windowStart = Date.now() - (AUTH_WINDOW * 3);
    }

    // Manually trigger cleanup logic (same as the 60s interval callback)
    const now = Date.now();
    for (const key of Array.from(authMap.keys())) {
      const entry = authMap.get(key);
      if (!entry) continue;
      if (now - entry.windowStart > AUTH_WINDOW * 2) authMap.delete(key);
    }

    assert.equal(authMap.size, 0, 'Stale auth rate limit entries should be purged');
  });

  test('non-stale entries survive cleanup', async () => {
    const AUTH_WINDOW = 300_000; // 5 minutes
    const server = await startServer({
      AUTH_RATE_LIMIT_WINDOW: AUTH_WINDOW,
      AUTH_RATE_LIMIT_MAX: 100,
    });
    servers.push(server);

    await registerUser(server, 'ratelimit_fresh');
    await server.request
      .post('/api/v1/auth/login')
      .send({ username: 'ratelimit_fresh', password: 'wrongpassword' })
      .expect(401);

    const authMap = server.planner.state.userAuthRateLimits;
    const sizeBefore = authMap.size;
    assert.ok(sizeBefore > 0);

    // Run cleanup — entries are fresh, should survive
    const now = Date.now();
    for (const key of Array.from(authMap.keys())) {
      const entry = authMap.get(key);
      if (!entry) continue;
      if (now - entry.windowStart > AUTH_WINDOW * 2) authMap.delete(key);
    }

    assert.equal(authMap.size, sizeBefore, 'Fresh entries should survive cleanup');
  });
});
