/**
 * Integration tests for POST /api/v1/account/email — the change-email flow.
 *
 * Covers the security contract of the route:
 *   - the happy path issues a hashed, expiring token and does NOT touch the
 *     login identity,
 *   - an unverified (unclicked) token leaves `users.email` alone,
 *   - an expired token is refused,
 *   - a replayed token is refused (single use),
 *   - a wrong current password is refused and issues no token,
 *   - an address already registered elsewhere is refused,
 *   - the scoped rate limit fires,
 *   - concurrent requests leave exactly one live change token,
 *   - a pending change token dies with any password rotation,
 *   - an unclicked signup token survives an email-change request,
 *   - promoting the address signs every session out,
 *   - an address taken between request and confirm gives 409, not 500,
 *   - the retired POST /api/v1/auth/update-email stays unmounted.
 *
 * Harness: schema setup and constants come from tests/_integration-helpers.ts;
 * teardown is targeted by created user id (no TRUNCATE), one planner per test.
 */

import crypto from 'crypto';
import { afterEach, describe, test } from 'node:test';
import {
  assert,
  createFestivalPlanner,
  DEFAULT_PASSWORD,
  ensureTestSchema,
  Pool,
  PUBLIC_DIR,
  request,
  TEST_DATABASE_URL,
  TRUSTED_MUTATION_HEADER,
} from './_integration-helpers';

const ACCEPTED_MSG = 'Verification link sent. Your login email changes only when you open it.';

const createdUserIds: string[] = [];

async function withPool<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function cleanupCreatedUsers() {
  if (createdUserIds.length === 0) return;
  await withPool(async (pool) => {
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = ANY($1)', [createdUserIds]);
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = ANY($1)', [createdUserIds]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [createdUserIds]);
    await pool.query('DELETE FROM user_sessions WHERE user_id = ANY($1)', [createdUserIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  });
  createdUserIds.length = 0;
}

// Local, not the helper's: the shared `startServer` TRUNCATEs every table, which
// would wipe the users of any suite running beside this one, and it does not
// pin RESEND_API_KEY empty.
async function startServer(overrides: Record<string, unknown> = {}) {
  await ensureTestSchema();
  const planner = await createFestivalPlanner({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR,
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
    AUTH_RATE_LIMIT_MAX: 1000,
    // Keeps every send on sendEmail's graceful-degrade path — no network, no
    // real mail. Assertions look at the token row, never at a send.
    RESEND_API_KEY: '',
    ...overrides,
  });
  return {
    planner,
    request: request(planner.app),
    async close() {
      if (typeof planner.close === 'function') await planner.close();
      else if (planner.server) await new Promise<void>((r) => planner.server.close(() => r()));
    },
  };
}

// `users.username` is capped at 30 chars and silently truncated, so keep the
// generated names short enough to stay unique after storage.
let uniqueCounter = 0;
function unique(prefix: string) {
  uniqueCounter += 1;
  return `${prefix}${uniqueCounter}${Math.random().toString(36).slice(2, 8)}`;
}

// Local, not the helper's: that one takes no email and returns the raw body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function registerUser(server: any, username: string, email?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    username,
    password: DEFAULT_PASSWORD,
    confirmPassword: DEFAULT_PASSWORD,
    dateOfBirth: '1995-01-01',
    tosAccepted: true,
  };
  if (email) body.email = email;
  const res = await server.request.post('/api/v1/auth/register').set(TRUSTED_MUTATION_HEADER, '1').send(body);
  assert.ok(res.status === 201 || res.status === 200, `register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const id = res.body.data.user.id as string;
  assert.ok(id, 'registered user id not found');
  createdUserIds.push(id);
  return { id, token: res.body.data.token as string, username, email };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function changeEmail(server: any, token: string, email: string, password = DEFAULT_PASSWORD) {
  return server.request
    .post('/api/v1/account/email')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .set('x-user-token', token)
    .send({ email, password });
}

/**
 * The raw verification token never leaves the server (only its SHA-256 hash is
 * stored, and the link goes out by email). To exercise the real callback
 * against the row the route actually wrote, re-point that row's `token_hash` at
 * a raw token the test knows. Everything else about the row — the pending
 * address, expiry, used_at — is left exactly as the route created it.
 */
async function stealPendingToken(userId: string) {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const updated = await withPool(async (pool) => {
    const { rows } = await pool.query(
      `UPDATE email_verification_tokens SET token_hash = $2
        WHERE id = (SELECT id FROM email_verification_tokens
                     WHERE user_id = $1 AND used_at IS NULL
                     ORDER BY id DESC LIMIT 1)
        RETURNING id, email`,
      [userId, hash],
    );
    return rows[0];
  });
  assert.ok(updated, 'expected a live verification token row for the user');
  return { raw, tokenId: updated.id as string, pendingEmail: updated.email as string };
}

async function readUser(userId: string) {
  return withPool(async (pool) => {
    const { rows } = await pool.query('SELECT email, email_verified_at FROM users WHERE id = $1', [userId]);
    return rows[0] as { email: string | null; email_verified_at: Date | null };
  });
}

/**
 * Live (unused, unexpired) verification tokens for a user. Pass `email` to
 * count only the ones pending for that address — signing up with an address
 * already issues a verification token of its own.
 */
async function countLiveTokens(userId: string, email?: string) {
  return withPool(async (pool) => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM email_verification_tokens
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
          AND ($2::text IS NULL OR email = $2)`,
      [userId, email ?? null],
    );
    return rows[0].c as number;
  });
}

/** Live (unused, unexpired) tokens for a user, as { email } rows. */
async function liveTokenEmails(userId: string): Promise<string[]> {
  return withPool(async (pool) => {
    const { rows } = await pool.query(
      `SELECT email FROM email_verification_tokens
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW() ORDER BY email`,
      [userId],
    );
    return rows.map((r: { email: string }) => r.email);
  });
}

/** Re-point the newest live password-reset row at a raw token the test knows. */
async function stealResetToken(userId: string) {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const updated = await withPool(async (pool) => {
    const { rows } = await pool.query(
      `UPDATE password_reset_tokens SET token_hash = $2
        WHERE id = (SELECT id FROM password_reset_tokens
                     WHERE user_id = $1 AND used_at IS NULL ORDER BY id DESC LIMIT 1)
        RETURNING id`,
      [userId, hash],
    );
    return rows[0];
  });
  assert.ok(updated, 'expected a live password-reset token row for the user');
  return raw;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try {
      await s.close();
    } catch {
      /* noop */
    }
  }
  await cleanupCreatedUsers();
});

describe('account: POST /email (change-email request)', { concurrency: 1 }, () => {
  test('happy path: issues a hashed pending token and leaves the login identity alone', async () => {
    const server = await startServer();
    servers.push(server);
    const oldEmail = `${unique('old')}@example.com`;
    const user = await registerUser(server, unique('ec-ok'), oldEmail);

    // Mixed case on purpose — the pending address must be normalised.
    const newEmail = `${unique('New')}@Example.COM`;
    const res = await changeEmail(server, user.token, newEmail);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.message, ACCEPTED_MSG);
    // The response must not echo the submitted address or leak a token.
    const bodyText = JSON.stringify(res.body);
    assert.ok(!bodyText.toLowerCase().includes(newEmail.toLowerCase()), 'response echoed the new address');
    assert.ok(!/[a-f0-9]{64}/.test(bodyText), 'response leaked a token-shaped value');

    // Login identity untouched: the new address is NOT on the user row, and is
    // not resolvable as an account yet.
    const row = await readUser(user.id);
    assert.equal(row.email, oldEmail);

    const pending = await withPool(async (pool) => {
      const { rows } = await pool.query(
        `SELECT email, token_hash, used_at, expires_at > NOW() AS live
           FROM email_verification_tokens WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
        [user.id],
      );
      return rows[0];
    });
    assert.equal(pending.email, newEmail.toLowerCase(), 'pending address must be stored lowercased');
    assert.equal(pending.used_at, null);
    assert.equal(pending.live, true, 'token must have a future expiry');
    assert.match(pending.token_hash, /^[a-f0-9]{64}$/, 'token must be stored as a sha256 hash');
  });

  test('unverified token: the address only becomes the identity after the link is used', async () => {
    const server = await startServer();
    servers.push(server);
    const oldEmail = `${unique('old')}@example.com`;
    const newEmail = `${unique('new')}@example.com`;
    const user = await registerUser(server, unique('ec-verify'), oldEmail);

    assert.equal((await changeEmail(server, user.token, newEmail)).status, 200);

    // Before verification the account still answers to the old address only.
    const before = await readUser(user.id);
    assert.equal(before.email, oldEmail);

    const { raw } = await stealPendingToken(user.id);
    const verified = await server.request
      .get(`/api/v1/auth/verify-email?token=${raw}`)
      .set('Accept', 'application/json');
    assert.equal(verified.status, 200);

    const after = await readUser(user.id);
    assert.equal(after.email, newEmail);
    assert.notEqual(after.email_verified_at, null, 'promotion must stamp email_verified_at');
  });

  test('expired token is refused and the identity does not move', async () => {
    const server = await startServer();
    servers.push(server);
    const oldEmail = `${unique('old')}@example.com`;
    const newEmail = `${unique('new')}@example.com`;
    const user = await registerUser(server, unique('ec-exp'), oldEmail);

    assert.equal((await changeEmail(server, user.token, newEmail)).status, 200);
    const { raw, tokenId } = await stealPendingToken(user.id);
    await withPool((pool) =>
      pool.query("UPDATE email_verification_tokens SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1", [
        tokenId,
      ]),
    );

    const res = await server.request.get(`/api/v1/auth/verify-email?token=${raw}`).set('Accept', 'application/json');
    assert.equal(res.status, 400);
    assert.equal((await readUser(user.id)).email, oldEmail);
  });

  test('replayed token is refused on the second use', async () => {
    const server = await startServer();
    servers.push(server);
    const oldEmail = `${unique('old')}@example.com`;
    const newEmail = `${unique('new')}@example.com`;
    const user = await registerUser(server, unique('ec-replay'), oldEmail);

    assert.equal((await changeEmail(server, user.token, newEmail)).status, 200);
    const { raw } = await stealPendingToken(user.id);

    const first = await server.request.get(`/api/v1/auth/verify-email?token=${raw}`).set('Accept', 'application/json');
    assert.equal(first.status, 200);

    const replay = await server.request.get(`/api/v1/auth/verify-email?token=${raw}`).set('Accept', 'application/json');
    assert.equal(replay.status, 400);
    assert.match(replay.body.error.message, /expired|already been used/i);

    // Still the once-verified address; the replay changed nothing. Promoting
    // the address also retired the leftover signup link for the old one, so no
    // stale token can revert the change.
    assert.equal((await readUser(user.id)).email, newEmail);
    assert.equal(await countLiveTokens(user.id), 0);
  });

  test('wrong current password is rejected and issues no token', async () => {
    const server = await startServer();
    servers.push(server);
    const oldEmail = `${unique('old')}@example.com`;
    const user = await registerUser(server, unique('ec-pw'), oldEmail);

    const newEmail = `${unique('new')}@example.com`;
    const res = await changeEmail(server, user.token, newEmail, 'Wr0ngPassword!x');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'PASSWORD_INCORRECT');
    assert.equal(await countLiveTokens(user.id, newEmail), 0);
    assert.equal((await readUser(user.id)).email, oldEmail);
  });

  test('address already registered elsewhere is refused outright, with no token', async () => {
    // The former fake-success posture did not hold: the taken branch slept
    // 200-500ms while the accepted branch answered in ~38ms, so the two were
    // separable by timing anyway, and /api/v1/auth/register leaks the same
    // fact unauthenticated. Say so plainly instead of lying to the user.
    const server = await startServer();
    servers.push(server);
    const takenEmail = `${unique('taken')}@example.com`;
    await registerUser(server, unique('ec-other'), takenEmail);

    const oldEmail = `${unique('old')}@example.com`;
    const user = await registerUser(server, unique('ec-dup'), oldEmail);

    const res = await changeEmail(server, user.token, takenEmail.toUpperCase());
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'ALREADY_EXISTS');
    assert.equal(await countLiveTokens(user.id, takenEmail), 0, 'no token may be issued for an unavailable address');
    assert.equal((await readUser(user.id)).email, oldEmail);
  });

  test('scoped rate limit blocks the 4th request in the window', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, unique('ec-rl'), `${unique('old')}@example.com`);

    for (let i = 0; i < 3; i++) {
      const r = await changeEmail(server, user.token, `${unique('rl')}@example.com`);
      assert.equal(r.status, 200, `request ${i + 1} should pass, got ${r.status}`);
    }
    const fourth = await changeEmail(server, user.token, `${unique('rl')}@example.com`);
    assert.equal(fourth.status, 429);
    assert.equal(fourth.body.error.code, 'RATE_LIMITED');
  });

  // The old-address security notice is asserted in
  // tests/routes-auth-account-festivals.test.ts ("POST /email notifies the
  // address on file"): pino writes through a worker transport, so the send is
  // not observable from inside this process, while the unit suite injects the
  // logger and can read every recipient the handler passed to sendEmail.

  test('concurrent requests leave exactly one live change token', async () => {
    const server = await startServer();
    servers.push(server);
    const oldEmail = `${unique('old')}@example.com`;
    const user = await registerUser(server, unique('ec-race'), oldEmail);

    const a = `${unique('a')}@example.com`;
    const b = `${unique('b')}@example.com`;
    const [r1, r2] = await Promise.all([changeEmail(server, user.token, a), changeEmail(server, user.token, b)]);
    assert.ok([r1.status, r2.status].every((st) => st === 200), `statuses ${r1.status} ${r2.status}`);

    const live = await liveTokenEmails(user.id);
    const changeTokens = live.filter((e) => e !== oldEmail);
    assert.equal(changeTokens.length, 1, `two parallel requests left ${changeTokens.length} live links: ${live}`);
    assert.ok([a, b].includes(changeTokens[0]!), 'the surviving link must be one of the two requested');
  });

  test('an unclicked signup token survives an email-change request', async () => {
    // invalidateVerificationTokens(userId) used to kill every pending token,
    // silently including the signup link the user had not opened yet.
    const server = await startServer();
    servers.push(server);
    const oldEmail = `${unique('old')}@example.com`;
    const user = await registerUser(server, unique('ec-signup'), oldEmail);
    assert.deepEqual(await liveTokenEmails(user.id), [oldEmail], 'registration must issue a signup token');

    assert.equal((await changeEmail(server, user.token, `${unique('new')}@example.com`)).status, 200);

    assert.ok((await liveTokenEmails(user.id)).includes(oldEmail), 'the signup token must still be live');
  });

  test('changing the password kills the pending change link the notice warns about', async () => {
    // The security notice tells the owner to change their password. That advice
    // is only true if the password change also revokes the attacker's link.
    const server = await startServer();
    servers.push(server);
    const oldEmail = `${unique('old')}@example.com`;
    const attacker = `${unique('atk')}@evil.test`;
    const user = await registerUser(server, unique('ec-pwrot'), oldEmail);

    assert.equal((await changeEmail(server, user.token, attacker)).status, 200);
    const { raw } = await stealPendingToken(user.id);

    const rotated = await server.request
      .post('/api/v1/auth/change-password')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .set('x-user-token', user.token)
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'N3wStr0ng!Pw22', confirmPassword: 'N3wStr0ng!Pw22' });
    assert.equal(rotated.status, 200);

    const clicked = await server.request.get(`/api/v1/auth/verify-email?token=${raw}`).set('Accept', 'application/json');
    assert.equal(clicked.status, 400, 'the pending link must be dead after a password rotation');
    assert.equal((await readUser(user.id)).email, oldEmail, 'the identity must not move');
    assert.ok((await liveTokenEmails(user.id)).includes(oldEmail), 'the signup token is not collateral damage');
  });

  test('a password reset kills the pending change link too', async () => {
    const server = await startServer();
    servers.push(server);
    const oldEmail = `${unique('old')}@example.com`;
    const attacker = `${unique('atk')}@evil.test`;
    const user = await registerUser(server, unique('ec-reset'), oldEmail);

    assert.equal((await changeEmail(server, user.token, attacker)).status, 200);
    const { raw } = await stealPendingToken(user.id);

    assert.equal(
      (
        await server.request
          .post('/api/v1/auth/forgot-password')
          .set(TRUSTED_MUTATION_HEADER, '1')
          .send({ email: oldEmail })
      ).status,
      200,
    );
    const resetRaw = await stealResetToken(user.id);
    const reset = await server.request
      .post('/api/v1/auth/reset-password')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ token: resetRaw, newPassword: 'N3wStr0ng!Pw22', confirmPassword: 'N3wStr0ng!Pw22' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));

    const clicked = await server.request.get(`/api/v1/auth/verify-email?token=${raw}`).set('Accept', 'application/json');
    assert.equal(clicked.status, 400, 'recovery must revoke a pending change link as well');
    assert.equal((await readUser(user.id)).email, oldEmail);
  });

  test('address taken between request and confirm: 409, not a 500 that claims to be retryable', async () => {
    const server = await startServer();
    servers.push(server);
    const oldEmail = `${unique('old')}@example.com`;
    const target = `${unique('race')}@example.com`;
    const user = await registerUser(server, unique('ec-taken'), oldEmail);

    assert.equal((await changeEmail(server, user.token, target)).status, 200);
    const { raw } = await stealPendingToken(user.id);

    // Somebody else claims the address in the meantime.
    await registerUser(server, unique('ec-thief'), target);

    const res = await server.request.get(`/api/v1/auth/verify-email?token=${raw}`).set('Accept', 'application/json');
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'ALREADY_EXISTS');
    assert.equal(res.body.error.retryable, false, 'no retry of this link can ever succeed');
    assert.equal((await readUser(user.id)).email, oldEmail);
  });

  test('promoting a new address signs every existing session out', async () => {
    const server = await startServer();
    servers.push(server);
    const oldEmail = `${unique('old')}@example.com`;
    const newEmail = `${unique('new')}@example.com`;
    const user = await registerUser(server, unique('ec-sess'), oldEmail);

    assert.equal((await server.request.get('/api/v1/auth/me').set('x-user-token', user.token)).status, 200);

    assert.equal((await changeEmail(server, user.token, newEmail)).status, 200);
    const { raw } = await stealPendingToken(user.id);
    const verified = await server.request.get(`/api/v1/auth/verify-email?token=${raw}`).set('Accept', 'application/json');
    assert.equal(verified.status, 200);
    assert.equal(verified.body.data.sessionsRevoked, true);

    const after = await server.request.get('/api/v1/auth/me').set('x-user-token', user.token);
    assert.equal(after.status, 401, 'a session issued before the identity moved must not survive it');
    assert.equal((await readUser(user.id)).email, newEmail);
  });

  test('the retired POST /api/v1/auth/update-email is not mounted', async () => {
    const server = await startServer();
    servers.push(server);
    const oldEmail = `${unique('old')}@example.com`;
    const user = await registerUser(server, unique('ec-legacy'), oldEmail);

    const res = await server.request
      .post('/api/v1/auth/update-email')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .set('x-user-token', user.token)
      .send({ email: `${unique('atk')}@evil.test`, password: DEFAULT_PASSWORD });

    assert.equal(res.status, 404);
    assert.equal((await readUser(user.id)).email, oldEmail);
  });
});
