import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Helper: mock pool factory (same pattern as stores-polls.test.js)
// ---------------------------------------------------------------------------
function makePool(queryResults: any[] = []) {
  let callIdx = 0;
  return {
    query: mock.fn(async (..._args: any[]) => {
      const result = queryResults[callIdx] || { rows: [] };
      callIdx++;
      return result;
    }),
  };
}

// ---------------------------------------------------------------------------
// lib/db/stores/email-tokens.js — createEmailTokensStore
// ---------------------------------------------------------------------------
describe('lib/db/stores/email-tokens.js', () => {
  let createEmailTokensStore: any;

  beforeEach(async () => {
    const mod = await import('../lib/db/stores/email-tokens.js');
    createEmailTokensStore = mod.createEmailTokensStore;
  });

  // =========================================================================
  // findUserByEmail()
  // =========================================================================
  describe('findUserByEmail', () => {
    it('returns the user when a matching email exists', async () => {
      const user = { id: 'user-1', username: 'alice', email: 'alice@example.com' };
      const pool = makePool([{ rows: [user] }]);
      const store = createEmailTokensStore(pool);

      const result = await store.findUserByEmail('alice@example.com');

      assert.deepStrictEqual(result, user);
      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]! as any;
      assert.ok(call.arguments[0].includes('SELECT id, username, email FROM users'));
      assert.ok(call.arguments[0].includes('LOWER(email) = $1'));
      assert.ok(call.arguments[0].includes('deleted_at IS NULL'));
      assert.deepStrictEqual(call.arguments[1], ['alice@example.com']);
    });

    it('returns null when no user matches the email', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      const result = await store.findUserByEmail('nobody@example.com');

      assert.strictEqual(result, null);
      assert.deepStrictEqual((pool.query.mock.calls[0]! as any).arguments[1], ['nobody@example.com']);
    });
  });

  // =========================================================================
  // invalidateResetTokens()
  // =========================================================================
  describe('invalidateResetTokens', () => {
    it('sets used_at on all unused reset tokens for the user', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      await store.invalidateResetTokens('user-1');

      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]! as any;
      assert.ok(call.arguments[0].includes('UPDATE password_reset_tokens'));
      assert.ok(call.arguments[0].includes('SET used_at = NOW()'));
      assert.ok(call.arguments[0].includes('user_id = $1'));
      assert.ok(call.arguments[0].includes('used_at IS NULL'));
      assert.deepStrictEqual(call.arguments[1], ['user-1']);
    });
  });

  // =========================================================================
  // createResetToken()
  // =========================================================================
  describe('createResetToken', () => {
    it('inserts a password reset token with a 1-hour expiry', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      await store.createResetToken('user-1', 'abc123hash');

      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]! as any;
      assert.ok(call.arguments[0].includes('INSERT INTO password_reset_tokens'));
      assert.ok(call.arguments[0].includes('user_id'));
      assert.ok(call.arguments[0].includes('token_hash'));
      assert.ok(call.arguments[0].includes('expires_at'));
      assert.ok(call.arguments[0].includes("INTERVAL '1 hour'"));
      assert.deepStrictEqual(call.arguments[1], ['user-1', 'abc123hash']);
    });

    it('passes the exact userId and tokenHash to the query', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      await store.createResetToken('user-42', 'sha256-deadbeef');

      const params = (pool.query.mock.calls[0]! as any).arguments[1];
      assert.strictEqual(params[0], 'user-42');
      assert.strictEqual(params[1], 'sha256-deadbeef');
    });
  });

  // =========================================================================
  // findVerificationToken()
  // =========================================================================
  describe('findVerificationToken', () => {
    it('returns the token record when hash matches an active token', async () => {
      const token = { id: 'tok-1', user_id: 'user-1', email: 'alice@example.com' };
      const pool = makePool([{ rows: [token] }]);
      const store = createEmailTokensStore(pool);

      const result = await store.findVerificationToken('hash-abc');

      assert.deepStrictEqual(result, token);
      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]! as any;
      assert.ok(call.arguments[0].includes('email_verification_tokens'));
      assert.ok(call.arguments[0].includes('token_hash = $1'));
      assert.ok(call.arguments[0].includes('used_at IS NULL'));
      assert.ok(call.arguments[0].includes('expires_at > NOW()'));
      assert.deepStrictEqual(call.arguments[1], ['hash-abc']);
    });

    it('returns null when no active token matches the hash', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      const result = await store.findVerificationToken('nonexistent-hash');

      assert.strictEqual(result, null);
    });
  });

  // =========================================================================
  // markTokenUsed()
  // =========================================================================
  describe('markTokenUsed', () => {
    it('sets used_at on the verification token by id', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      await store.markTokenUsed('tok-1');

      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]! as any;
      assert.ok(call.arguments[0].includes('UPDATE email_verification_tokens'));
      assert.ok(call.arguments[0].includes('SET used_at = NOW()'));
      assert.ok(call.arguments[0].includes('id = $1'));
      assert.deepStrictEqual(call.arguments[1], ['tok-1']);
    });
  });

  // =========================================================================
  // updateUserEmail()
  // =========================================================================
  describe('updateUserEmail', () => {
    it('updates the email and sets email_verified_at timestamp', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      await store.updateUserEmail('user-1', 'newemail@example.com');

      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]! as any;
      assert.ok(call.arguments[0].includes('UPDATE users'));
      assert.ok(call.arguments[0].includes('email = $1'));
      assert.ok(call.arguments[0].includes('email_verified_at = NOW()'));
      assert.ok(call.arguments[0].includes('id = $2'));
      assert.deepStrictEqual(call.arguments[1], ['newemail@example.com', 'user-1']);
    });

    it('passes email as first param and userId as second param', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      await store.updateUserEmail('user-99', 'changed@test.com');

      const params = (pool.query.mock.calls[0]! as any).arguments[1];
      assert.strictEqual(params[0], 'changed@test.com');
      assert.strictEqual(params[1], 'user-99');
    });
  });

  // =========================================================================
  // checkEmailExists()
  // =========================================================================
  describe('checkEmailExists', () => {
    it('returns true when another user has the email', async () => {
      const pool = makePool([{ rows: [{ id: 'other-user' }] }]);
      const store = createEmailTokensStore(pool);

      const result = await store.checkEmailExists('taken@example.com', 'user-1');

      assert.strictEqual(result, true);
      const call = pool.query.mock.calls[0]! as any;
      assert.ok(call.arguments[0].includes('SELECT id FROM users'));
      assert.ok(call.arguments[0].includes('LOWER(email) = $1'));
      assert.ok(call.arguments[0].includes('deleted_at IS NULL'));
      assert.ok(call.arguments[0].includes('id != $2'));
      assert.deepStrictEqual(call.arguments[1], ['taken@example.com', 'user-1']);
    });

    it('returns false when no other user has the email', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      const result = await store.checkEmailExists('available@example.com', 'user-1');

      assert.strictEqual(result, false);
    });
  });

  // =========================================================================
  // setEmailUnverified()
  // =========================================================================
  describe('setEmailUnverified', () => {
    it('sets email and clears email_verified_at', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      await store.setEmailUnverified('user-1', 'pending@example.com');

      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]! as any;
      assert.ok(call.arguments[0].includes('UPDATE users'));
      assert.ok(call.arguments[0].includes('email = $1'));
      assert.ok(call.arguments[0].includes('email_verified_at = NULL'));
      assert.ok(call.arguments[0].includes('id = $2'));
      assert.deepStrictEqual(call.arguments[1], ['pending@example.com', 'user-1']);
    });
  });

  // =========================================================================
  // createVerificationToken()
  // =========================================================================
  describe('createVerificationToken', () => {
    it('inserts a verification token with dynamic TTL', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      await store.createVerificationToken('user-1', 'hash-xyz', 'alice@example.com', 24);

      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]! as any;
      assert.ok(call.arguments[0].includes('INSERT INTO email_verification_tokens'));
      assert.ok(call.arguments[0].includes('user_id'));
      assert.ok(call.arguments[0].includes('token_hash'));
      assert.ok(call.arguments[0].includes('email'));
      assert.ok(call.arguments[0].includes('expires_at'));
      assert.ok(call.arguments[0].includes('INTERVAL'));
      assert.deepStrictEqual(call.arguments[1], ['user-1', 'hash-xyz', 'alice@example.com', 24]);
    });

    it('passes all four parameters in the correct order', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      await store.createVerificationToken('user-5', 'tok-hash', 'bob@test.com', 48);

      const params = (pool.query.mock.calls[0]! as any).arguments[1];
      assert.strictEqual(params[0], 'user-5');
      assert.strictEqual(params[1], 'tok-hash');
      assert.strictEqual(params[2], 'bob@test.com');
      assert.strictEqual(params[3], 48);
    });
  });

  // =========================================================================
  // invalidateVerificationTokens()
  // =========================================================================
  describe('invalidateVerificationTokens', () => {
    it('sets used_at on all unused verification tokens for the user', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      await store.invalidateVerificationTokens('user-1');

      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]! as any;
      assert.ok(call.arguments[0].includes('UPDATE email_verification_tokens'));
      assert.ok(call.arguments[0].includes('SET used_at = NOW()'));
      assert.ok(call.arguments[0].includes('user_id = $1'));
      assert.ok(call.arguments[0].includes('used_at IS NULL'));
      assert.deepStrictEqual(call.arguments[1], ['user-1']);
    });
  });

  // =========================================================================
  // consumeResetToken()
  // =========================================================================
  describe('consumeResetToken', () => {
    it('marks the token used and returns the user_id', async () => {
      const pool = makePool([{ rows: [{ user_id: 'user-1' }] }]);
      const store = createEmailTokensStore(pool);

      const result = await store.consumeResetToken('hash-reset');

      assert.deepStrictEqual(result, { user_id: 'user-1' });
      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]! as any;
      assert.ok(call.arguments[0].includes('UPDATE password_reset_tokens'));
      assert.ok(call.arguments[0].includes('SET used_at = NOW()'));
      assert.ok(call.arguments[0].includes('token_hash = $1'));
      assert.ok(call.arguments[0].includes('used_at IS NULL'));
      assert.ok(call.arguments[0].includes('expires_at > NOW()'));
      assert.ok(call.arguments[0].includes('RETURNING user_id'));
      assert.deepStrictEqual(call.arguments[1], ['hash-reset']);
    });

    it('returns null when the token is expired or already used', async () => {
      const pool = makePool([{ rows: [] }]);
      const store = createEmailTokensStore(pool);

      const result = await store.consumeResetToken('expired-hash');

      assert.strictEqual(result, null);
    });
  });

  // =========================================================================
  // Error propagation
  // =========================================================================
  describe('database error propagation', () => {
    it('findUserByEmail propagates database errors', async () => {
      const pool = { query: mock.fn(async () => { throw new Error('connection refused'); }) };
      const store = createEmailTokensStore(pool);

      await assert.rejects(
        () => store.findUserByEmail('test@example.com'),
        { message: 'connection refused' },
      );
    });

    it('invalidateResetTokens propagates database errors', async () => {
      const pool = { query: mock.fn(async () => { throw new Error('timeout'); }) };
      const store = createEmailTokensStore(pool);

      await assert.rejects(
        () => store.invalidateResetTokens('user-1'),
        { message: 'timeout' },
      );
    });

    it('createResetToken propagates database errors', async () => {
      const pool = { query: mock.fn(async () => { throw new Error('unique violation'); }) };
      const store = createEmailTokensStore(pool);

      await assert.rejects(
        () => store.createResetToken('user-1', 'hash'),
        { message: 'unique violation' },
      );
    });

    it('findVerificationToken propagates database errors', async () => {
      const pool = { query: mock.fn(async () => { throw new Error('relation does not exist'); }) };
      const store = createEmailTokensStore(pool);

      await assert.rejects(
        () => store.findVerificationToken('hash'),
        { message: 'relation does not exist' },
      );
    });

    it('markTokenUsed propagates database errors', async () => {
      const pool = { query: mock.fn(async () => { throw new Error('deadlock detected'); }) };
      const store = createEmailTokensStore(pool);

      await assert.rejects(
        () => store.markTokenUsed('tok-1'),
        { message: 'deadlock detected' },
      );
    });

    it('updateUserEmail propagates database errors', async () => {
      const pool = { query: mock.fn(async () => { throw new Error('permission denied'); }) };
      const store = createEmailTokensStore(pool);

      await assert.rejects(
        () => store.updateUserEmail('user-1', 'email@test.com'),
        { message: 'permission denied' },
      );
    });

    it('checkEmailExists propagates database errors', async () => {
      const pool = { query: mock.fn(async () => { throw new Error('SSL connection lost'); }) };
      const store = createEmailTokensStore(pool);

      await assert.rejects(
        () => store.checkEmailExists('email@test.com', 'user-1'),
        { message: 'SSL connection lost' },
      );
    });

    it('setEmailUnverified propagates database errors', async () => {
      const pool = { query: mock.fn(async () => { throw new Error('disk full'); }) };
      const store = createEmailTokensStore(pool);

      await assert.rejects(
        () => store.setEmailUnverified('user-1', 'email@test.com'),
        { message: 'disk full' },
      );
    });

    it('createVerificationToken propagates database errors', async () => {
      const pool = { query: mock.fn(async () => { throw new Error('constraint violation'); }) };
      const store = createEmailTokensStore(pool);

      await assert.rejects(
        () => store.createVerificationToken('user-1', 'hash', 'email@test.com', 24),
        { message: 'constraint violation' },
      );
    });

    it('invalidateVerificationTokens propagates database errors', async () => {
      const pool = { query: mock.fn(async () => { throw new Error('connection reset'); }) };
      const store = createEmailTokensStore(pool);

      await assert.rejects(
        () => store.invalidateVerificationTokens('user-1'),
        { message: 'connection reset' },
      );
    });

    it('consumeResetToken propagates database errors', async () => {
      const pool = { query: mock.fn(async () => { throw new Error('statement timeout'); }) };
      const store = createEmailTokensStore(pool);

      await assert.rejects(
        () => store.consumeResetToken('hash'),
        { message: 'statement timeout' },
      );
    });
  });
});
