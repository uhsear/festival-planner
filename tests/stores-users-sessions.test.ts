import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import createUsersStore from '../lib/db/stores/users';
import createSessionsStore from '../lib/db/stores/sessions';

// ── Helpers ────────────────────────────────────────────────────────

function mockPool(queryResults: any[] = []) {
  let callIndex = 0;
  const calls: any[] = [];
  const pool: any = {
    query: async (sql: any, params: any) => {
      const result = queryResults[callIndex] || { rows: [], rowCount: 0 };
      calls.push({ sql, params, target: 'pool' });
      callIndex++;
      return result;
    },
    connect: async () => ({
      query: async (sql: any, params: any) => {
        const result = queryResults[callIndex] || { rows: [], rowCount: 0 };
        calls.push({ sql, params, target: 'client' });
        callIndex++;
        return result;
      },
      release: () => {},
    }),
    calls,
  };
  return pool;
}

const mockUtils: any = {
  toISOString: (val: any) => (val ? new Date(val).toISOString() : null),
};

// Collapse multi-line/whitespace-formatted SQL into a single normalized line
// so substring assertions are not brittle to SQL formatting.
const norm = (s: any) => String(s).replace(/\s+/g, ' ').trim();

function fakeUserRow(overrides: any = {}) {
  return {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    passwordHash: 'hash123',
    avatarKey: null,
    avatarVersion: null,
    avatarUpdatedAt: null,
    tosAcceptedAt: '2026-01-01T00:00:00.000Z',
    tosVersion: '1.0',
    emailVerifiedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════
//  USERS STORE
// ════════════════════════════════════════════════════════════════════

describe('createUsersStore', () => {
  // ── readAll ──────────────────────────────────────────────────────

  describe('readAll', () => {
    it('returns normalized rows', async () => {
      const row = fakeUserRow();
      const pool = mockPool([{ rows: [row], rowCount: 1 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.readAll();
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'u1');
      assert.equal(result[0].username, 'alice');
      assert.ok(pool.calls[0].sql.includes('FROM users'));
    });

    it('returns empty array when no users', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.readAll();
      assert.deepEqual(result, []);
    });

    it('normalizes null avatar fields', async () => {
      const row = fakeUserRow({ avatarKey: '', avatarVersion: 0 });
      const pool = mockPool([{ rows: [row], rowCount: 1 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.readAll();
      assert.equal(result[0].avatarKey, null);
      assert.equal(result[0].avatarVersion, null);
    });
  });

  // ── getById ──────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns normalized user when found', async () => {
      const row = fakeUserRow();
      const pool = mockPool([{ rows: [row], rowCount: 1 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.getById('u1');
      assert.equal(result.id, 'u1');
      assert.equal(pool.calls[0].params[0], 'u1');
    });

    it('returns null when user not found', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.getById('missing');
      assert.equal(result, null);
    });

    it('normalizes ISO timestamps', async () => {
      const row = fakeUserRow({ createdAt: new Date('2026-03-15') });
      const pool = mockPool([{ rows: [row], rowCount: 1 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.getById('u1');
      assert.equal(result.createdAt, '2026-03-15T00:00:00.000Z');
    });
  });

  // ── getByIds ─────────────────────────────────────────────────────

  describe('getByIds', () => {
    it('returns Map of users keyed by id', async () => {
      const rows = [fakeUserRow({ id: 'u1' }), fakeUserRow({ id: 'u2', username: 'bob' })];
      const pool = mockPool([{ rows, rowCount: 2 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.getByIds(['u1', 'u2']);
      assert.ok(result instanceof Map);
      assert.equal(result.size, 2);
      assert.equal(result.get('u1').username, 'alice');
      assert.equal(result.get('u2').username, 'bob');
    });

    it('returns empty Map for null/empty input', async () => {
      const pool = mockPool([]);
      const users = createUsersStore(pool, mockUtils);

      const result1 = await users.getByIds(null);
      assert.equal(result1.size, 0);

      const result2 = await users.getByIds([]);
      assert.equal(result2.size, 0);

      // No pool queries should have been made
      assert.equal(pool.calls.length, 0);
    });

    it('returns Map with only found users', async () => {
      const pool = mockPool([{ rows: [fakeUserRow({ id: 'u1' })], rowCount: 1 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.getByIds(['u1', 'u999']);
      assert.equal(result.size, 1);
      assert.ok(result.has('u1'));
      assert.ok(!result.has('u999'));
    });
  });

  // ── getByUsername / findByUsername ────────────────────────────────

  describe('getByUsername', () => {
    it('returns user when found', async () => {
      const pool = mockPool([{ rows: [fakeUserRow()], rowCount: 1 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.getByUsername('alice');
      assert.equal(result.username, 'alice');
      assert.equal(pool.calls[0].params[0], 'alice');
    });

    it('returns null when username not found', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.getByUsername('nobody');
      assert.equal(result, null);
    });

    it('queries with LIMIT 1', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const users = createUsersStore(pool, mockUtils);
      await users.getByUsername('test');
      assert.ok(pool.calls[0].sql.includes('LIMIT 1'));
    });
  });

  describe('findByUsername', () => {
    it('returns user when found (alias of getByUsername)', async () => {
      const pool = mockPool([{ rows: [fakeUserRow()], rowCount: 1 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.findByUsername('alice');
      assert.equal(result.username, 'alice');
    });

    it('returns null when not found', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.findByUsername('ghost');
      assert.equal(result, null);
    });
  });

  // ── create ───────────────────────────────────────────────────────

  describe('create', () => {
    it('inserts user and returns getById result', async () => {
      const row = fakeUserRow();
      // First call: INSERT, second call: getById SELECT
      const pool = mockPool([
        { rows: [], rowCount: 1 },
        { rows: [row], rowCount: 1 },
      ]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.create({
        id: 'u1',
        username: 'alice',
        passwordHash: 'hash123',
        email: 'alice@example.com',
      });
      assert.equal(result.id, 'u1');
      assert.ok(pool.calls[0].sql.includes('INSERT INTO users'));
      assert.ok(pool.calls[1].sql.includes('SELECT'));
    });

    it('sets email to null when not provided', async () => {
      const pool = mockPool([
        { rows: [], rowCount: 1 },
        { rows: [fakeUserRow({ email: null })], rowCount: 1 },
      ]);
      const users = createUsersStore(pool, mockUtils);

      await users.create({ id: 'u1', username: 'alice', passwordHash: 'h' });
      const params = pool.calls[0].params;
      // email is 4th param (index 3)
      assert.equal(params[3], null);
    });

    it('uses provided createdAt or defaults to now', async () => {
      const pool = mockPool([
        { rows: [], rowCount: 1 },
        { rows: [fakeUserRow()], rowCount: 1 },
      ]);
      const users = createUsersStore(pool, mockUtils);

      const specificDate = '2025-06-01T00:00:00.000Z';
      await users.create({
        id: 'u1',
        username: 'alice',
        passwordHash: 'h',
        createdAt: specificDate,
      });
      // date_of_birth was inserted at param[4]; createdAt shifted to param[5].
      assert.equal(pool.calls[0].params[5], specificDate);
    });

    it('passes tosAcceptedAt and tosVersion when provided', async () => {
      const pool = mockPool([
        { rows: [], rowCount: 1 },
        { rows: [fakeUserRow()], rowCount: 1 },
      ]);
      const users = createUsersStore(pool, mockUtils);

      await users.create({
        id: 'u1',
        username: 'alice',
        passwordHash: 'h',
        dateOfBirth: '1990-05-05',
        tosAcceptedAt: '2026-01-01T00:00:00.000Z',
        tosVersion: '2.0',
      });
      // INSERT order: ...email($4), date_of_birth($5), created_at($6), tos_accepted_at($7), tos_version($8)
      assert.equal(pool.calls[0].params[4], '1990-05-05');
      assert.equal(pool.calls[0].params[6], '2026-01-01T00:00:00.000Z');
      assert.equal(pool.calls[0].params[7], '2.0');
    });
  });

  // ── update ───────────────────────────────────────────────────────

  describe('update', () => {
    it('sets fields and returns updated user', async () => {
      const updatedRow = fakeUserRow({ username: 'alice2' });
      const pool = mockPool([
        { rows: [], rowCount: 1 }, // UPDATE
        { rows: [updatedRow], rowCount: 1 }, // SELECT
      ]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.update('u1', { username: 'alice2' });
      assert.equal(result.username, 'alice2');
      assert.ok(pool.calls[0].sql.includes('UPDATE users SET'));
      assert.ok(pool.calls[0].sql.includes('username'));
    });

    it('maps camelCase keys to snake_case columns', async () => {
      const pool = mockPool([
        { rows: [], rowCount: 1 },
        { rows: [fakeUserRow()], rowCount: 1 },
      ]);
      const users = createUsersStore(pool, mockUtils);

      await users.update('u1', { avatarKey: 'new-key' });
      assert.ok(pool.calls[0].sql.includes('avatar_key'));
    });

    it('throws on invalid column key', async () => {
      const pool = mockPool([]);
      const users = createUsersStore(pool, mockUtils);

      await assert.rejects(() => users.update('u1', { hackerField: 'bad' }), { message: /Invalid column key/ });
    });

    it('returns null when user not found after update', async () => {
      const pool = mockPool([
        { rows: [], rowCount: 0 },
        { rows: [], rowCount: 0 },
      ]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.update('missing', { username: 'x' });
      assert.equal(result, null);
    });
  });

  // ── softDelete ───────────────────────────────────────────────────

  describe('softDelete', () => {
    it('sets deleted_at with deletedBy and reason', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const users = createUsersStore(pool, mockUtils);

      await users.softDelete('u1', { deletedBy: 'admin', reason: 'test' });
      assert.ok(pool.calls[0].sql.includes('deleted_at = NOW()'));
      assert.equal(pool.calls[0].params[0], 'u1');
      assert.equal(pool.calls[0].params[1], 'admin');
      assert.equal(pool.calls[0].params[2], 'test');
    });

    it('defaults deletedBy and reason to null', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const users = createUsersStore(pool, mockUtils);

      await users.softDelete('u1');
      assert.equal(pool.calls[0].params[1], null);
      assert.equal(pool.calls[0].params[2], null);
    });

    it('only updates non-deleted users', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const users = createUsersStore(pool, mockUtils);

      await users.softDelete('u1');
      assert.ok(pool.calls[0].sql.includes('deleted_at IS NULL'));
    });
  });

  // ── delete (soft with return) ────────────────────────────────────

  describe('delete', () => {
    it('returns user before soft-deleting', async () => {
      const row = fakeUserRow();
      const pool = mockPool([
        { rows: [row], rowCount: 1 }, // getById
        { rows: [], rowCount: 1 }, // UPDATE
      ]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.delete('u1', { deletedBy: 'admin', reason: 'cleanup' });
      assert.equal(result.id, 'u1');
      assert.equal(pool.calls[1].params[1], 'admin');
      assert.equal(pool.calls[1].params[2], 'cleanup');
    });

    it('returns null when user does not exist', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.delete('missing');
      assert.equal(result, null);
      // Only the getById call should have been made
      assert.equal(pool.calls.length, 1);
    });

    it('defaults deletedBy and reason to null', async () => {
      const row = fakeUserRow();
      const pool = mockPool([
        { rows: [row], rowCount: 1 },
        { rows: [], rowCount: 1 },
      ]);
      const users = createUsersStore(pool, mockUtils);

      await users.delete('u1');
      assert.equal(pool.calls[1].params[1], null);
      assert.equal(pool.calls[1].params[2], null);
    });
  });

  // ── purgeDeleted ─────────────────────────────────────────────────

  describe('purgeDeleted', () => {
    it('deletes users older than given days', async () => {
      const pool = mockPool([{ rows: [], rowCount: 3 }]);
      const users = createUsersStore(pool, mockUtils);

      await users.purgeDeleted(30);
      assert.ok(pool.calls[0].sql.includes('DELETE FROM users'));
      assert.equal(pool.calls[0].params[0], 30);
    });

    it('clamps negative days to 0', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const users = createUsersStore(pool, mockUtils);

      await users.purgeDeleted(-5);
      assert.equal(pool.calls[0].params[0], 0);
    });

    it('returns early for NaN input', async () => {
      const pool = mockPool([]);
      const users = createUsersStore(pool, mockUtils);

      await users.purgeDeleted('not-a-number');
      assert.equal(pool.calls.length, 0);
    });
  });

  // ── count ────────────────────────────────────────────────────────

  describe('count', () => {
    it('returns integer count', async () => {
      const pool = mockPool([{ rows: [{ count: '42' }] }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.count();
      assert.equal(result, 42);
      assert.equal(typeof result, 'number');
    });

    it('returns 0 when no users', async () => {
      const pool = mockPool([{ rows: [{ count: '0' }] }]);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.count();
      assert.equal(result, 0);
    });

    it('only counts non-deleted users', async () => {
      const pool = mockPool([{ rows: [{ count: '5' }] }]);
      const users = createUsersStore(pool, mockUtils);

      await users.count();
      assert.ok(pool.calls[0].sql.includes('deleted_at IS NULL'));
    });
  });

  // ── replaceAll ───────────────────────────────────────────────────

  describe('replaceAll', () => {
    it('soft-deletes all when nextUsers is empty', async () => {
      // BEGIN, UPDATE (soft-delete all), COMMIT
      const pool = mockPool([
        { rows: [] }, // BEGIN
        { rows: [] }, // UPDATE soft-delete all
        { rows: [] }, // COMMIT
      ]);
      const users = createUsersStore(pool, mockUtils);

      await users.replaceAll([]);
      assert.equal(pool.calls.length, 3);
      assert.ok(pool.calls[1].sql.includes('UPDATE users SET deleted_at'));
      assert.ok(!pool.calls[1].sql.includes('NOT IN'));
    });

    it('soft-deletes missing users and upserts provided ones', async () => {
      const nextUsers = [{ id: 'u1', username: 'alice', passwordHash: 'h1', createdAt: '2026-01-01T00:00:00.000Z' }];
      // BEGIN, UPDATE (soft-delete NOT IN), INSERT/UPSERT, COMMIT
      const pool = mockPool([
        { rows: [] }, // BEGIN
        { rows: [] }, // UPDATE soft-delete
        { rows: [] }, // UPSERT user u1
        { rows: [] }, // COMMIT
      ]);
      const users = createUsersStore(pool, mockUtils);

      await users.replaceAll(nextUsers);
      assert.equal(pool.calls.length, 4);
      assert.ok(pool.calls[1].sql.includes('NOT IN'));
      assert.ok(pool.calls[2].sql.includes('INSERT INTO users'));
      assert.ok(pool.calls[2].sql.includes('ON CONFLICT'));
    });

    it('handles multiple users in replaceAll', async () => {
      const nextUsers = [
        { id: 'u1', username: 'alice', passwordHash: 'h1' },
        { id: 'u2', username: 'bob', passwordHash: 'h2' },
      ];
      // BEGIN, UPDATE, UPSERT u1, UPSERT u2, COMMIT
      const pool = mockPool([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
      const users = createUsersStore(pool, mockUtils);

      await users.replaceAll(nextUsers);
      assert.equal(pool.calls.length, 5);
    });

    it('defaults updatedAt to createdAt when not provided', async () => {
      const nextUsers = [{ id: 'u1', username: 'alice', passwordHash: 'h1', createdAt: '2026-03-01T00:00:00.000Z' }];
      const pool = mockPool([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
      const users = createUsersStore(pool, mockUtils);

      await users.replaceAll(nextUsers);
      // updatedAt param is index 9 (0-based)
      const upsertParams = pool.calls[2].params;
      assert.equal(upsertParams[9], '2026-03-01T00:00:00.000Z');
    });
  });

  // ── hardDelete ───────────────────────────────────────────────────

  describe('hardDelete', () => {
    it('deletes child rows then user within transaction', async () => {
      const row = fakeUserRow();
      // BEGIN(1) + 20 child DELETEs + DELETE FROM users RETURNING(1) + COMMIT(1) = 23
      const results: any[] = [{ rows: [] }]; // BEGIN
      for (let i = 0; i < 20; i++) results.push({ rows: [] }); // 20 child deletes
      results.push({ rows: [row], rowCount: 1 }); // DELETE FROM users RETURNING
      results.push({ rows: [] }); // COMMIT
      const pool = mockPool(results);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.hardDelete('u1');
      assert.equal(result.id, 'u1');
      // Verify it starts with BEGIN
      assert.ok(pool.calls[0].sql.includes('BEGIN'));
      // Last non-COMMIT call should be DELETE FROM users
      const deleteUsersCall = pool.calls[pool.calls.length - 2];
      assert.ok(deleteUsersCall.sql.includes('DELETE FROM users WHERE id'));
    });

    it('returns null when user does not exist in hard delete', async () => {
      const results: any[] = [{ rows: [] }]; // BEGIN
      for (let i = 0; i < 20; i++) results.push({ rows: [] }); // 20 child deletes
      results.push({ rows: [], rowCount: 0 }); // DELETE FROM users RETURNING (no match)
      results.push({ rows: [] }); // COMMIT
      const pool = mockPool(results);
      const users = createUsersStore(pool, mockUtils);

      const result = await users.hardDelete('missing');
      assert.equal(result, null);
    });

    it('rolls back on error in hardDelete', async () => {
      const results: any[] = [{ rows: [] }]; // BEGIN
      // Simulate error on the second child DELETE
      const pool = mockPool(results);
      let rollbackCalled = false;
      pool.connect = async () => {
        let clientCallIdx = 0;
        return {
          query: async (sql: any, params: any) => {
            clientCallIdx++;
            if (sql === 'ROLLBACK') {
              rollbackCalled = true;
              return { rows: [] };
            }
            if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
            if (clientCallIdx === 3) throw new Error('FK violation');
            return { rows: [] };
          },
          release: () => {},
        };
      };
      const users = createUsersStore(pool, mockUtils);

      await assert.rejects(() => users.hardDelete('u1'), { message: 'FK violation' });
      assert.ok(rollbackCalled);
    });
  });
});

// ════════════════════════════════════════════════════════════════════
//  SESSIONS STORE
// ════════════════════════════════════════════════════════════════════

describe('createSessionsStore', () => {
  // ── createUserSession ────────────────────────────────────────────

  describe('createUserSession', () => {
    it('inserts session and returns empty evicted list when under limit', async () => {
      // BEGIN, INSERT, SELECT FOR UPDATE (1 session), COMMIT
      const pool = mockPool([
        { rows: [] }, // BEGIN
        { rows: [] }, // INSERT
        { rows: [{ token: 'tok1' }] }, // SELECT (1 session, limit 5 => no eviction)
        { rows: [] }, // COMMIT
      ]);
      const sessions = createSessionsStore(pool, mockUtils);

      const evicted = await sessions.createUserSession({
        token: 'tok1',
        userId: 'u1',
        username: 'alice',
        createdAt: new Date().toISOString(),
        lastAccess: new Date().toISOString(),
        maxPerUser: 5,
      });
      assert.deepEqual(evicted, []);
    });

    it('evicts oldest sessions when over maxPerUser', async () => {
      // BEGIN, INSERT, SELECT FOR UPDATE (6 sessions, limit 5), DELETE evicted, COMMIT
      const sixSessions = Array.from({ length: 6 }, (_, i) => ({ token: `tok${i}` }));
      const pool = mockPool([
        { rows: [] }, // BEGIN
        { rows: [] }, // INSERT
        { rows: sixSessions }, // SELECT (6 sessions)
        { rows: [] }, // DELETE evicted
        { rows: [] }, // COMMIT
      ]);
      const sessions = createSessionsStore(pool, mockUtils);

      const evicted = await sessions.createUserSession({
        token: 'tok6',
        userId: 'u1',
        username: 'alice',
        createdAt: new Date().toISOString(),
        lastAccess: new Date().toISOString(),
        maxPerUser: 5,
      });
      assert.equal(evicted.length, 1);
      assert.equal(evicted[0], 'tok0');
    });

    it('evicts multiple tokens when far over limit', async () => {
      const eightSessions = Array.from({ length: 8 }, (_, i) => ({ token: `tok${i}` }));
      const pool = mockPool([{ rows: [] }, { rows: [] }, { rows: eightSessions }, { rows: [] }, { rows: [] }]);
      const sessions = createSessionsStore(pool, mockUtils);

      const evicted = await sessions.createUserSession({
        token: 'tok8',
        userId: 'u1',
        username: 'alice',
        createdAt: new Date().toISOString(),
        lastAccess: new Date().toISOString(),
        maxPerUser: 5,
      });
      assert.equal(evicted.length, 3);
      assert.deepEqual(evicted, ['tok0', 'tok1', 'tok2']);
    });
  });

  // ── validateUserSession ──────────────────────────────────────────

  describe('validateUserSession', () => {
    it('returns session when valid and recently accessed', async () => {
      const now = new Date();
      const session = {
        token: 'tok1',
        userId: 'u1',
        username: 'alice',
        createdAt: now.toISOString(),
        lastAccess: now.toISOString(),
      };
      const pool = mockPool([{ rows: [session], rowCount: 1 }]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.validateUserSession('tok1', 86400000);
      assert.equal(result.token, 'tok1');
      assert.equal(result.userId, 'u1');
      // Only 1 query (SELECT) since lastAccess was recent
      assert.equal(pool.calls.length, 1);
    });

    it('returns null and deletes when session is expired', async () => {
      const expired = new Date(Date.now() - 200000000); // well past TTL
      const session = {
        token: 'tok1',
        userId: 'u1',
        username: 'alice',
        createdAt: expired.toISOString(),
        lastAccess: expired.toISOString(),
      };
      const pool = mockPool([
        { rows: [session], rowCount: 1 }, // SELECT
        { rows: [], rowCount: 1 }, // DELETE expired
      ]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.validateUserSession('tok1', 86400000);
      assert.equal(result, null);
      assert.equal(pool.calls.length, 2);
      assert.ok(pool.calls[1].sql.includes('DELETE'));
    });

    it('returns null when token not found', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.validateUserSession('missing', 86400000);
      assert.equal(result, null);
    });

    it('updates lastAccess when >60s has elapsed', async () => {
      const created = new Date();
      const oldAccess = new Date(Date.now() - 120000); // 2 minutes ago
      const session = {
        token: 'tok1',
        userId: 'u1',
        username: 'alice',
        createdAt: created.toISOString(),
        lastAccess: oldAccess.toISOString(),
      };
      const pool = mockPool([
        { rows: [session], rowCount: 1 }, // SELECT
        { rows: [], rowCount: 1 }, // UPDATE lastAccess
      ]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.validateUserSession('tok1', 86400000);
      assert.ok(result);
      assert.equal(pool.calls.length, 2);
      assert.ok(pool.calls[1].sql.includes('UPDATE user_sessions SET last_access'));
      // lastAccess should be updated to a recent date
      assert.ok(result.lastAccess instanceof Date);
    });
  });

  // ── listUserSessions ─────────────────────────────────────────────

  describe('listUserSessions', () => {
    it('returns all sessions for a user', async () => {
      const rows = [
        { token: 'tok1', userId: 'u1', username: 'alice', createdAt: new Date(), lastAccess: new Date() },
        { token: 'tok2', userId: 'u1', username: 'alice', createdAt: new Date(), lastAccess: new Date() },
      ];
      const pool = mockPool([{ rows, rowCount: 2 }]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.listUserSessions('u1');
      assert.equal(result.length, 2);
      assert.equal(pool.calls[0].params[0], 'u1');
    });

    it('returns empty array when user has no sessions', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.listUserSessions('u1');
      assert.deepEqual(result, []);
    });

    it('orders by last_access ASC', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const sessions = createSessionsStore(pool, mockUtils);
      await sessions.listUserSessions('u1');
      assert.ok(norm(pool.calls[0].sql).includes('ORDER BY last_access ASC'));
    });
  });

  // ── deleteUserSession ────────────────────────────────────────────

  describe('deleteUserSession', () => {
    it('deletes session by token', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const sessions = createSessionsStore(pool, mockUtils);

      await sessions.deleteUserSession('tok1');
      assert.ok(pool.calls[0].sql.includes('DELETE FROM user_sessions'));
      assert.equal(pool.calls[0].params[0], 'tok1');
    });

    it('does not throw when token does not exist', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const sessions = createSessionsStore(pool, mockUtils);

      await assert.doesNotReject(() => sessions.deleteUserSession('missing'));
    });

    it('executes exactly one query', async () => {
      const pool = mockPool([{ rows: [], rowCount: 1 }]);
      const sessions = createSessionsStore(pool, mockUtils);

      await sessions.deleteUserSession('tok1');
      assert.equal(pool.calls.length, 1);
    });
  });

  // ── deleteUserSessions ───────────────────────────────────────────

  describe('deleteUserSessions', () => {
    it('deletes all sessions for user and returns tokens', async () => {
      const pool = mockPool([
        { rows: [{ token: 'tok1' }, { token: 'tok2' }], rowCount: 2 }, // SELECT
        { rows: [], rowCount: 2 }, // DELETE
      ]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.deleteUserSessions('u1');
      assert.deepEqual(result, ['tok1', 'tok2']);
      assert.equal(pool.calls.length, 2);
    });

    it('excludes specified token from deletion', async () => {
      const pool = mockPool([
        { rows: [{ token: 'tok1' }], rowCount: 1 }, // SELECT with exceptToken
        { rows: [], rowCount: 1 }, // DELETE
      ]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.deleteUserSessions('u1', 'tok2');
      assert.deepEqual(result, ['tok1']);
      assert.ok(pool.calls[0].sql.includes('token <> $2'));
      assert.equal(pool.calls[0].params[1], 'tok2');
    });

    it('returns empty array and skips DELETE when no sessions found', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.deleteUserSessions('u1');
      assert.deepEqual(result, []);
      assert.equal(pool.calls.length, 1); // Only the SELECT
    });
  });

  // ── deleteExpiredUserSessions ────────────────────────────────────

  describe('deleteExpiredUserSessions', () => {
    it('deletes expired sessions and returns tokens', async () => {
      const pool = mockPool([
        {
          rows: [{ token: 'tok1' }, { token: 'tok2' }],
          rowCount: 2,
        },
      ]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.deleteExpiredUserSessions(86400000);
      assert.deepEqual(result, ['tok1', 'tok2']);
      assert.ok(pool.calls[0].sql.includes('DELETE FROM user_sessions'));
      assert.ok(pool.calls[0].sql.includes('RETURNING token'));
    });

    it('returns empty array when nothing expired', async () => {
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.deleteExpiredUserSessions(86400000);
      assert.deepEqual(result, []);
    });

    it('calculates correct threshold from TTL', async () => {
      const before = Date.now();
      const pool = mockPool([{ rows: [], rowCount: 0 }]);
      const sessions = createSessionsStore(pool, mockUtils);

      await sessions.deleteExpiredUserSessions(86400000);
      const threshold = pool.calls[0].params[0];
      assert.ok(threshold instanceof Date);
      const after = Date.now();
      // threshold should be roughly now - 86400000ms
      const expected = before - 86400000;
      assert.ok(threshold.getTime() >= expected - 100);
      assert.ok(threshold.getTime() <= after - 86400000 + 100);
    });
  });

  // ── counts ───────────────────────────────────────────────────────

  describe('counts', () => {
    it('returns userSessions count as integer', async () => {
      const pool = mockPool([{ rows: [{ count: '15' }] }]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.counts();
      assert.equal(result.userSessions, 15);
      assert.equal(typeof result.userSessions, 'number');
    });

    it('returns 0 when no sessions exist', async () => {
      const pool = mockPool([{ rows: [{ count: '0' }] }]);
      const sessions = createSessionsStore(pool, mockUtils);

      const result = await sessions.counts();
      assert.equal(result.userSessions, 0);
    });

    it('queries user_sessions table', async () => {
      const pool = mockPool([{ rows: [{ count: '0' }] }]);
      const sessions = createSessionsStore(pool, mockUtils);
      await sessions.counts();
      assert.ok(pool.calls[0].sql.includes('user_sessions'));
    });
  });

  // ── refreshTokens ───────────────────────────────────────────────

  describe('refreshTokens', () => {
    describe('create', () => {
      it('inserts a refresh token', async () => {
        const pool = mockPool([{ rows: [], rowCount: 1 }]);
        const sessions = createSessionsStore(pool, mockUtils);

        await sessions.refreshTokens.create({
          token: 'rt1',
          userId: 'u1',
          sessionToken: 'st1',
          expiresAt: '2026-07-01T00:00:00.000Z',
        });
        assert.ok(pool.calls[0].sql.includes('INSERT INTO refresh_tokens'));
        assert.deepEqual(pool.calls[0].params, ['rt1', 'u1', 'st1', '2026-07-01T00:00:00.000Z']);
      });

      it('executes exactly one query', async () => {
        const pool = mockPool([{ rows: [], rowCount: 1 }]);
        const sessions = createSessionsStore(pool, mockUtils);
        await sessions.refreshTokens.create({ token: 'rt1', userId: 'u1', sessionToken: 'st1', expiresAt: new Date() });
        assert.equal(pool.calls.length, 1);
      });

      it('does not return a value', async () => {
        const pool = mockPool([{ rows: [], rowCount: 1 }]);
        const sessions = createSessionsStore(pool, mockUtils);
        const result = await sessions.refreshTokens.create({
          token: 'rt1',
          userId: 'u1',
          sessionToken: 'st1',
          expiresAt: new Date(),
        });
        assert.equal(result, undefined);
      });
    });

    describe('validate', () => {
      it('returns token row when valid', async () => {
        const row = {
          token: 'rt1',
          userId: 'u1',
          sessionToken: 'st1',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          revoked: false,
        };
        const pool = mockPool([
          { rows: [row], rowCount: 1 }, // SELECT refresh token
          { rows: [{ '?column?': 1 }], rowCount: 1 }, // SELECT 1 FROM user_sessions (linked session exists)
        ]);
        const sessions = createSessionsStore(pool, mockUtils);

        const result = await sessions.refreshTokens.validate('rt1');
        assert.equal(result.token, 'rt1');
        assert.equal(result.userId, 'u1');
      });

      it('returns null and deletes when linked session no longer exists (H2 defense-in-depth)', async () => {
        const row = {
          token: 'rt1',
          userId: 'u1',
          sessionToken: 'st1',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          revoked: false,
        };
        const pool = mockPool([
          { rows: [row], rowCount: 1 }, // SELECT refresh token
          { rows: [], rowCount: 0 }, // SELECT 1 FROM user_sessions (session gone)
          { rows: [], rowCount: 1 }, // DELETE refresh token
        ]);
        const sessions = createSessionsStore(pool, mockUtils);

        const result = await sessions.refreshTokens.validate('rt1');
        assert.equal(result, null);
        assert.ok(pool.calls[2].sql.includes('DELETE'));
      });

      it('returns null and deletes when token is revoked', async () => {
        const row = {
          token: 'rt1',
          userId: 'u1',
          sessionToken: 'st1',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          revoked: true,
        };
        const pool = mockPool([
          { rows: [row], rowCount: 1 }, // SELECT
          { rows: [], rowCount: 1 }, // DELETE
        ]);
        const sessions = createSessionsStore(pool, mockUtils);

        const result = await sessions.refreshTokens.validate('rt1');
        assert.equal(result, null);
        assert.equal(pool.calls.length, 2);
        assert.ok(pool.calls[1].sql.includes('DELETE'));
      });

      it('returns null and deletes when token is expired', async () => {
        const row = {
          token: 'rt1',
          userId: 'u1',
          sessionToken: 'st1',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() - 86400000).toISOString(), // expired
          revoked: false,
        };
        const pool = mockPool([
          { rows: [row], rowCount: 1 },
          { rows: [], rowCount: 1 },
        ]);
        const sessions = createSessionsStore(pool, mockUtils);

        const result = await sessions.refreshTokens.validate('rt1');
        assert.equal(result, null);
      });

      it('returns null when token not found', async () => {
        const pool = mockPool([{ rows: [], rowCount: 0 }]);
        const sessions = createSessionsStore(pool, mockUtils);

        const result = await sessions.refreshTokens.validate('missing');
        assert.equal(result, null);
        assert.equal(pool.calls.length, 1);
      });
    });

    describe('rotate', () => {
      it('revokes old token and inserts new within transaction', async () => {
        const pool = mockPool([
          { rows: [] }, // BEGIN
          { rows: [{ user_id: 'u1' }] }, // SELECT old token
          { rows: [] }, // UPDATE revoke
          { rows: [] }, // INSERT new token
          { rows: [] }, // COMMIT
        ]);
        const sessions = createSessionsStore(pool, mockUtils);

        await sessions.refreshTokens.rotate('old-rt', 'new-rt', 'new-st', '2026-07-01T00:00:00.000Z');
        assert.ok(pool.calls[1].sql.includes('SELECT user_id'));
        assert.ok(pool.calls[2].sql.includes('UPDATE refresh_tokens SET revoked'));
        assert.ok(pool.calls[3].sql.includes('INSERT INTO refresh_tokens'));
      });

      it('throws when old token not found', async () => {
        const pool = mockPool([
          { rows: [] }, // BEGIN
          { rows: [] }, // SELECT (not found)
          // withTransaction will ROLLBACK on error
          { rows: [] }, // ROLLBACK
        ]);
        const sessions = createSessionsStore(pool, mockUtils);

        await assert.rejects(() => sessions.refreshTokens.rotate('missing', 'new-rt', 'new-st', new Date()), {
          message: 'Old refresh token not found',
        });
      });

      it('uses transaction (BEGIN/COMMIT)', async () => {
        const pool = mockPool([{ rows: [] }, { rows: [{ user_id: 'u1' }] }, { rows: [] }, { rows: [] }, { rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);

        await sessions.refreshTokens.rotate('old', 'new', 'st', new Date());
        assert.equal(pool.calls[0].sql, 'BEGIN');
        assert.equal(pool.calls[pool.calls.length - 1].sql, 'COMMIT');
      });
    });

    describe('revokeAll', () => {
      it('revokes all non-revoked tokens for user', async () => {
        const pool = mockPool([{ rows: [], rowCount: 3 }]);
        const sessions = createSessionsStore(pool, mockUtils);

        await sessions.refreshTokens.revokeAll('u1');
        assert.ok(pool.calls[0].sql.includes('UPDATE refresh_tokens SET revoked = TRUE'));
        assert.equal(pool.calls[0].params[0], 'u1');
      });

      it('only targets non-revoked tokens', async () => {
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);

        await sessions.refreshTokens.revokeAll('u1');
        assert.ok(pool.calls[0].sql.includes('revoked = FALSE'));
      });

      it('executes exactly one query', async () => {
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);
        await sessions.refreshTokens.revokeAll('u1');
        assert.equal(pool.calls.length, 1);
      });
    });

    describe('deleteExpired', () => {
      it('deletes expired and revoked tokens', async () => {
        const pool = mockPool([{ rows: [], rowCount: 5 }]);
        const sessions = createSessionsStore(pool, mockUtils);

        await sessions.refreshTokens.deleteExpired();
        assert.ok(pool.calls[0].sql.includes('DELETE FROM refresh_tokens'));
        assert.ok(pool.calls[0].sql.includes('expires_at < NOW()'));
        assert.ok(pool.calls[0].sql.includes('revoked = TRUE'));
      });

      it('takes no parameters', async () => {
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);
        await sessions.refreshTokens.deleteExpired();
        assert.equal(pool.calls[0].params, undefined);
      });

      it('executes exactly one query', async () => {
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);
        await sessions.refreshTokens.deleteExpired();
        assert.equal(pool.calls.length, 1);
      });
    });
  });

  // ── loginFailures ───────────────────────────────────────────────

  describe('loginFailures', () => {
    describe('record', () => {
      it('upserts a login failure', async () => {
        const pool = mockPool([{ rows: [], rowCount: 1 }]);
        const sessions = createSessionsStore(pool, mockUtils);

        await sessions.loginFailures.record('u1');
        assert.ok(pool.calls[0].sql.includes('INSERT INTO login_failures'));
        assert.ok(pool.calls[0].sql.includes('ON CONFLICT'));
        assert.ok(pool.calls[0].sql.includes('consecutive_failures + 1'));
        assert.equal(pool.calls[0].params[0], 'u1');
      });

      it('passes current date as second parameter', async () => {
        const before = Date.now();
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);

        await sessions.loginFailures.record('u1');
        const ts = pool.calls[0].params[1];
        assert.ok(ts instanceof Date);
        assert.ok(ts.getTime() >= before);
      });

      it('executes exactly one query', async () => {
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);
        await sessions.loginFailures.record('u1');
        assert.equal(pool.calls.length, 1);
      });
    });

    describe('reset', () => {
      it('deletes login failure record for user', async () => {
        const pool = mockPool([{ rows: [], rowCount: 1 }]);
        const sessions = createSessionsStore(pool, mockUtils);

        await sessions.loginFailures.reset('u1');
        assert.ok(pool.calls[0].sql.includes('DELETE FROM login_failures'));
        assert.equal(pool.calls[0].params[0], 'u1');
      });

      it('does not throw when no record exists', async () => {
        const pool = mockPool([{ rows: [], rowCount: 0 }]);
        const sessions = createSessionsStore(pool, mockUtils);
        await assert.doesNotReject(() => sessions.loginFailures.reset('u1'));
      });

      it('executes exactly one query', async () => {
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);
        await sessions.loginFailures.reset('u1');
        assert.equal(pool.calls.length, 1);
      });
    });

    describe('get', () => {
      it('returns failure record when it exists', async () => {
        const row = { consecutiveFailures: 3, lastFailureAt: new Date(), lockedUntil: null };
        const pool = mockPool([{ rows: [row], rowCount: 1 }]);
        const sessions = createSessionsStore(pool, mockUtils);

        const result = await sessions.loginFailures.get('u1');
        assert.equal(result.consecutiveFailures, 3);
      });

      it('returns null when no failure record exists', async () => {
        const pool = mockPool([{ rows: [], rowCount: 0 }]);
        const sessions = createSessionsStore(pool, mockUtils);

        const result = await sessions.loginFailures.get('u1');
        assert.equal(result, null);
      });

      it('passes userId as parameter', async () => {
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);
        await sessions.loginFailures.get('u1');
        assert.equal(pool.calls[0].params[0], 'u1');
      });
    });

    describe('lock', () => {
      it('updates locked_until for user', async () => {
        const lockedUntil = new Date(Date.now() + 300000);
        const pool = mockPool([{ rows: [], rowCount: 1 }]);
        const sessions = createSessionsStore(pool, mockUtils);

        await sessions.loginFailures.lock('u1', lockedUntil);
        assert.ok(pool.calls[0].sql.includes('UPDATE login_failures SET locked_until'));
        assert.equal(pool.calls[0].params[0], lockedUntil);
        assert.equal(pool.calls[0].params[1], 'u1');
      });

      it('executes exactly one query', async () => {
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);
        await sessions.loginFailures.lock('u1', new Date());
        assert.equal(pool.calls.length, 1);
      });

      it('does not throw when no record to lock', async () => {
        const pool = mockPool([{ rows: [], rowCount: 0 }]);
        const sessions = createSessionsStore(pool, mockUtils);
        await assert.doesNotReject(() => sessions.loginFailures.lock('u1', new Date()));
      });
    });
  });

  // ── metricsRollups ──────────────────────────────────────────────

  describe('metricsRollups', () => {
    describe('insert', () => {
      it('inserts a metrics rollup', async () => {
        const pool = mockPool([{ rows: [], rowCount: 1 }]);
        const sessions = createSessionsStore(pool, mockUtils);

        const rollup = {
          bucketStart: '2026-05-07T00:00:00.000Z',
          bucketEnd: '2026-05-07T01:00:00.000Z',
          totalRequests: 1000,
          totalErrors: 5,
          avgDurationMs: 42.5,
          status2xx: 900,
          status4xx: 80,
          status5xx: 5,
          peakConnections: 150,
          activeUsers: 50,
        };
        await sessions.metricsRollups.insert(rollup);
        assert.ok(norm(pool.calls[0].sql).includes('INSERT INTO metrics_rollups'));
        assert.equal(pool.calls[0].params.length, 10);
        assert.equal(pool.calls[0].params[0], rollup.bucketStart);
        assert.equal(pool.calls[0].params[2], 1000);
      });

      it('executes exactly one query', async () => {
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);
        await sessions.metricsRollups.insert({
          bucketStart: new Date(),
          bucketEnd: new Date(),
          totalRequests: 0,
          totalErrors: 0,
          avgDurationMs: 0,
          status2xx: 0,
          status4xx: 0,
          status5xx: 0,
          peakConnections: 0,
          activeUsers: 0,
        });
        assert.equal(pool.calls.length, 1);
      });

      it('does not return a value', async () => {
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);
        const result = await sessions.metricsRollups.insert({
          bucketStart: new Date(),
          bucketEnd: new Date(),
          totalRequests: 0,
          totalErrors: 0,
          avgDurationMs: 0,
          status2xx: 0,
          status4xx: 0,
          status5xx: 0,
          peakConnections: 0,
          activeUsers: 0,
        });
        assert.equal(result, undefined);
      });
    });

    describe('query', () => {
      it('returns rollup rows for time range', async () => {
        const rows = [{ id: 1, bucket_start: '2026-05-07T00:00:00Z', total_requests: 100 }];
        const pool = mockPool([{ rows, rowCount: 1 }]);
        const sessions = createSessionsStore(pool, mockUtils);

        const result = await sessions.metricsRollups.query('2026-05-07T00:00:00Z', '2026-05-08T00:00:00Z');
        assert.equal(result.length, 1);
        assert.equal(result[0].total_requests, 100);
      });

      it('defaults limit to 168', async () => {
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);

        await sessions.metricsRollups.query('2026-05-07T00:00:00Z', '2026-05-08T00:00:00Z');
        assert.equal(pool.calls[0].params[2], 168);
      });

      it('respects custom limit', async () => {
        const pool = mockPool([{ rows: [] }]);
        const sessions = createSessionsStore(pool, mockUtils);

        await sessions.metricsRollups.query('2026-05-07T00:00:00Z', '2026-05-08T00:00:00Z', 50);
        assert.equal(pool.calls[0].params[2], 50);
      });

      it('returns empty array when no rollups in range', async () => {
        const pool = mockPool([{ rows: [], rowCount: 0 }]);
        const sessions = createSessionsStore(pool, mockUtils);

        const result = await sessions.metricsRollups.query('2000-01-01', '2000-01-02');
        assert.deepEqual(result, []);
      });
    });
  });

  // ── store shape ─────────────────────────────────────────────────

  describe('store structure', () => {
    it('attaches refreshTokens sub-store', () => {
      const pool = mockPool([]);
      const sessions = createSessionsStore(pool, mockUtils);
      assert.ok(sessions.refreshTokens);
      assert.equal(typeof sessions.refreshTokens.create, 'function');
      assert.equal(typeof sessions.refreshTokens.validate, 'function');
      assert.equal(typeof sessions.refreshTokens.rotate, 'function');
      assert.equal(typeof sessions.refreshTokens.revokeAll, 'function');
      assert.equal(typeof sessions.refreshTokens.deleteExpired, 'function');
    });

    it('attaches loginFailures sub-store', () => {
      const pool = mockPool([]);
      const sessions = createSessionsStore(pool, mockUtils);
      assert.ok(sessions.loginFailures);
      assert.equal(typeof sessions.loginFailures.record, 'function');
      assert.equal(typeof sessions.loginFailures.reset, 'function');
      assert.equal(typeof sessions.loginFailures.get, 'function');
      assert.equal(typeof sessions.loginFailures.lock, 'function');
    });

    it('attaches metricsRollups sub-store', () => {
      const pool = mockPool([]);
      const sessions = createSessionsStore(pool, mockUtils);
      assert.ok(sessions.metricsRollups);
      assert.equal(typeof sessions.metricsRollups.insert, 'function');
      assert.equal(typeof sessions.metricsRollups.query, 'function');
    });
  });
});
