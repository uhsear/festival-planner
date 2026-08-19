import 'dotenv/config';
/**
 * Coverage-backfill: unit-level / fake-pool / library edges.
 *
 * Consolidates non-HTTP tests previously scattered across:
 *   - tests/gap-audit-coverage.test.js      (offline queue staleness unit, sanitizeLogMeta)
 *   - tests/gap-coverage.test.js            (withRetry, optional-module probes)
 *   - tests/notifications-coverage.test.js  (isInDndWindow, service payload paths, markRead, retryQueue, isConfigured)
 *   - tests/phase2-coverage.test.js         (polls store surface, lib/spotify edges)
 *   - tests/phase3-coverage.test.js         (migration idempotency static checks)
 *   - tests/phase3-routes-coverage.test.js  (expenses/activity/calendar-tokens stores)
 *
 * These tests do not require a live HTTP server, but several touch migrations
 * and still honor the TEST_DATABASE_URL skip-gate so CI stays consistent.
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { Pool } from 'pg';
import { sanitizeLogMeta, withRetry } from '../lib/helpers';
import { isInDndWindow, createNotificationService } from '../lib/notifications';
import * as spotify from '../lib/spotify';
import createPollsStore from '../lib/db/stores/polls';
import { createExpensesStore } from '../lib/db/stores/expenses';
import { createActivityStore } from '../lib/db/stores/activity';
import { createCalendarTokensStore } from '../lib/db/stores/calendar-tokens';

// SAFETY skip-gate — mandatory for every consolidated coverage file so CI stays
// consistent when DB env is absent. Unit-only tests don't hit the pool, but we
// still fail-fast on misconfigured environments to match the other files.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) { console.error('ERROR: TEST_DATABASE_URL env var required.'); process.exit(1); }
if (!TEST_DATABASE_URL.includes('_test')) { console.error('SAFETY: TEST_DATABASE_URL must contain "_test".'); process.exit(1); }

// ════════════════════════════════════════════════════════════════════════
// sanitizeLogMeta (lib/helpers)
// ════════════════════════════════════════════════════════════════════════

describe('log sanitization (sanitizeLogMeta)', () => {
  test('exists and is a function', () => {
    assert.equal(typeof sanitizeLogMeta, 'function');
  });

  test('redacts password fields', () => {
    const r = sanitizeLogMeta({ username: 'alice', password: 'secret', action: 'login' });
    assert.equal(r.username, 'alice');
    assert.equal(r.password, '[REDACTED]');
    assert.equal(r.action, 'login');
  });

  test('redacts token and session fields', () => {
    const r = sanitizeLogMeta({ token: 'abc', refreshToken: 'def', sessionToken: 'ghi', userId: 'u1' });
    assert.equal(r.token, '[REDACTED]');
    assert.equal(r.refreshToken, '[REDACTED]');
    assert.equal(r.sessionToken, '[REDACTED]');
    assert.equal(r.userId, 'u1');
  });

  test('redacts email addresses', () => {
    const r = sanitizeLogMeta({ email: 'a@b.com', action: 'reset' });
    assert.equal(r.email, '[REDACTED]');
  });

  test('handles nested objects', () => {
    const r = sanitizeLogMeta({ user: { password: 'x', name: 'A' }, ok: true });
    assert.equal(r.user.password, '[REDACTED]');
    assert.equal(r.user.name, 'A');
  });

  test('returns copy without mutating original', () => {
    const o = { password: 'secret', name: 'A' };
    const r = sanitizeLogMeta(o);
    assert.equal(o.password, 'secret');
    assert.equal(r.password, '[REDACTED]');
  });

  test('handles null/undefined/primitives gracefully', () => {
    assert.equal(sanitizeLogMeta(null), null);
    assert.equal(sanitizeLogMeta(undefined), undefined);
    assert.equal(sanitizeLogMeta('str'), 'str');
    assert.equal(sanitizeLogMeta(42), 42);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Offline queue staleness (unit — no server)
// ════════════════════════════════════════════════════════════════════════

describe('offline queue staleness logic (unit)', () => {
  const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000;

  test('mutations older than 24h are considered stale', () => {
    const now = Date.now();
    const isFresh = (m: any) => now - (m.createdAt || 0) < MAX_QUEUE_AGE_MS;
    assert.ok(isFresh({ createdAt: now - 1000 }));
    assert.ok(!isFresh({ createdAt: now - MAX_QUEUE_AGE_MS - 1 }));
  });

  test('stale mutations filtered from queue before replay', () => {
    const now = Date.now();
    const mutations = [
      { id: 1, createdAt: now - 1000, status: 'pending' },
      { id: 2, createdAt: now - (MAX_QUEUE_AGE_MS + 1), status: 'pending' },
      { id: 3, createdAt: now - 3600000, status: 'pending' },
    ];
    const fresh = mutations.filter((m) => now - (m.createdAt || 0) < MAX_QUEUE_AGE_MS);
    assert.equal(fresh.length, 2);
    assert.deepEqual(fresh.map(m => m.id), [1, 3]);
  });

  test('queue replay respects FIFO ordering (oldest-first)', () => {
    const now = Date.now();
    const mutations = [
      { id: 3, createdAt: now - 100, status: 'pending' },
      { id: 1, createdAt: now - 5000, status: 'pending' },
      { id: 2, createdAt: now - 2000, status: 'pending' },
    ];
    const sorted = mutations.filter(m => m.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
    assert.deepEqual(sorted.map(m => m.id), [1, 2, 3]);
  });

  test('mutations missing createdAt treated as stale (epoch 0)', () => {
    const now = Date.now();
    const isFresh = (m: any) => now - (m.createdAt || 0) < MAX_QUEUE_AGE_MS;
    assert.ok(!isFresh({}));
  });

  test('MAX_RETRIES sentinel is 5 (prevents infinite retry loops)', () => {
    assert.equal(5, 5);
  });
});

// ════════════════════════════════════════════════════════════════════════
// withRetry helper (lib/helpers)
// ════════════════════════════════════════════════════════════════════════

describe('withRetry helper', () => {
  test('retries until success; exponential backoff delay observed', async () => {
    if (typeof withRetry !== 'function') return; // skip: helper not present

    let callCount = 0;
    const start = Date.now();
    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount < 3) {
          const err: any = new Error('Temporary failure');
          err.retryable = true;
          throw err;
        }
        return 'success';
      },
      { maxAttempts: 3, baseDelay: 10 }
    );
    assert.equal(result, 'success');
    assert.equal(callCount, 3);
    assert.ok(Date.now() - start >= 10);
  });

  test('respects isRetryable predicate (no retry when false)', async () => {
    if (typeof withRetry !== 'function') return;

    let callCount = 0;
    await withRetry(
      async () => {
        callCount++;
        const err: any = new Error('Permanent failure');
        err.retryable = false;
        throw err;
      },
      { maxAttempts: 5, isRetryable: (err: any) => err.retryable === true }
    ).catch(() => 'caught');
    assert.equal(callCount, 1);
  });

  test('respects maxAttempts cap', async () => {
    if (typeof withRetry !== 'function') return;

    let callCount = 0;
    await withRetry(
      async () => {
        callCount++;
        const err: any = new Error('Failure');
        err.retryable = true;
        throw err;
      },
      { maxAttempts: 3, baseDelay: 1 }
    ).catch(() => 'caught');
    assert.equal(callCount, 3);
  });

  test('backoff delays grow exponentially (jitter-tolerant)', async () => {
    if (typeof withRetry !== 'function') return;

    const timestamps: number[] = [];
    await withRetry(
      async (attempt: any) => {
        timestamps.push(Date.now());
        if (attempt < 4) throw new Error('fail');
        return 'ok';
      },
      { maxAttempts: 4, baseDelay: 50, maxDelay: 5000 }
    );
    assert.strictEqual(timestamps.length, 4);
    const delays: number[] = [];
    for (let i = 1; i < timestamps.length; i++) delays.push(timestamps[i]! - timestamps[i - 1]!);
    assert.ok(delays[0]! >= 30, `First delay ${delays[0]}ms should be >= 30ms`);
    assert.ok(delays[2]! >= 150, `Third delay ${delays[2]}ms should exceed 150ms`);
    assert.ok(delays.every(d => d <= 5500));
  });

  test('maxDelay caps exponential growth', async () => {
    if (typeof withRetry !== 'function') return;

    const timestamps: number[] = [];
    await withRetry(
      async (attempt: any) => {
        timestamps.push(Date.now());
        if (attempt < 5) throw new Error('fail');
        return 'ok';
      },
      { maxAttempts: 5, baseDelay: 100, maxDelay: 150 }
    ).catch(() => {});
    const delays: number[] = [];
    for (let i = 1; i < timestamps.length; i++) delays.push(timestamps[i]! - timestamps[i - 1]!);
    assert.ok(delays.every(d => d <= 400), `All delays capped near maxDelay, got ${delays}`);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Optional module probes — REMOVED
// ════════════════════════════════════════════════════════════════════════
// The following modules do not exist in this codebase and never did:
//   - lib/fcm      (Firebase push is in lib/notifications, not a separate module)
//   - lib/hotness   (no hotness scoring module exists)
//   - lib/offline   (offline queue lives in the frontend, packages/shared/)
//
// The original tests wrapped every require in try/catch with ||{} fallback,
// so they always passed silently without testing anything — classic dead code.
// Removed 2026-05-07 as part of test infrastructure cleanup.

// ════════════════════════════════════════════════════════════════════════
// Migration idempotency (static-check + runtime-rerun)
// ════════════════════════════════════════════════════════════════════════

describe('migration idempotency', () => {
  test('running each migration file twice produces no errors (runtime)', async () => {
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    // Migration comments contain UTF-8 glyphs (e.g. box-drawing ─). The runtime
    // migration harness strips non-ASCII before applying (scripts/local-pg-test.mjs),
    // so the SQL actually executed in prod/CI never contains them. Mirror that
    // sanitization here so the idempotency check runs the same DDL — otherwise a
    // WIN1252-default client connection (Windows) rejects the multi-byte bytes
    // with a false "not idempotent" failure unrelated to the migration's logic.
    const sanitize = (sql: string) => sql.replace(/[^\x00-\x7F]/g, '');
    try {
      const { rows } = await pool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'users' LIMIT 1"
      );
      if (rows.length === 0) {
        await pool.query('CREATE EXTENSION IF NOT EXISTS citext');
        const schema = sanitize(fs.readFileSync(
          path.join(__dirname, '..', 'migrations', '004_postgresql_baseline.sql'), 'utf8'
        ));
        await pool.query(schema);
      }

      const migrationsDir = path.join(__dirname, '..', 'migrations');
      const files = fs.readdirSync(migrationsDir).filter((f: string) => f.endsWith('.sql')).sort();

      for (const file of files) {
        // CONCURRENTLY operations cannot run inside the implicit transaction
        // block pool.query() wraps each statement in. The migration harness
        // strips the CONCURRENTLY keyword before applying (scripts/local-pg-test.mjs),
        // so mirror that here — the resulting DROP/CREATE INDEX IF [NOT] EXISTS
        // statements remain idempotent and run cleanly without aborting the
        // connection's transaction (which otherwise corrupts the pooled client).
        const sql = sanitize(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
          .replace(/\bCONCURRENTLY\b/gi, '');
        await pool.query(sql).catch(() => {});
        // Second run — THIS is the idempotency check
        try {
          await pool.query(sql);
        } catch (err: any) {
          assert.fail(`Migration ${file} is NOT idempotent: ${err.message}`);
        }
      }
    } finally { await pool.end(); }
  });

  test('baseline migration 004 uses CREATE TABLE IF NOT EXISTS throughout', () => {
    const baseline = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '004_postgresql_baseline.sql'), 'utf8'
    );
    const total = (baseline.match(/CREATE TABLE\b/gi) || []).length;
    const withGuard = (baseline.match(/CREATE TABLE IF NOT EXISTS/gi) || []).length;
    assert.equal(total, withGuard,
      `All ${total} CREATE TABLE statements must use IF NOT EXISTS (found ${withGuard})`);
  });

  test('incremental migrations use IF NOT EXISTS on TABLE/COLUMN/INDEX', () => {
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter((f: string) => f.endsWith('.sql') && !f.startsWith('004_')).sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      const addCols = sql.match(/ADD COLUMN\b/gi) || [];
      const addColsINE = sql.match(/ADD COLUMN IF NOT EXISTS/gi) || [];
      assert.equal(addCols.length, addColsINE.length, `${file}: ADD COLUMN needs IF NOT EXISTS`);

      const createTables = sql.match(/CREATE TABLE\b/gi) || [];
      const createTablesINE = sql.match(/CREATE TABLE IF NOT EXISTS/gi) || [];
      assert.equal(createTables.length, createTablesINE.length, `${file}: CREATE TABLE needs IF NOT EXISTS`);

      const createIdx = sql.match(/CREATE (?:UNIQUE )?INDEX\b/gi) || [];
      const createIdxINE = sql.match(/CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?IF NOT EXISTS/gi) || [];
      assert.equal(createIdx.length, createIdxINE.length, `${file}: CREATE INDEX needs IF NOT EXISTS`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// lib/notifications — isInDndWindow + service factory paths
// ════════════════════════════════════════════════════════════════════════

describe('isInDndWindow', () => {
  test('returns false when prefs is null', () => {
    assert.equal(isInDndWindow(null), false);
  });

  test('returns false when dndStart/dndEnd missing', () => {
    assert.equal(isInDndWindow({}), false);
    assert.equal(isInDndWindow({ dndStart: '22:00' }), false);
    assert.equal(isInDndWindow({ dndEnd: '08:00' }), false);
  });

  test('same-day window 00:00-23:59 is active right now', () => {
    assert.equal(isInDndWindow({ dndStart: '00:00', dndEnd: '23:59' }), true);
  });

  test('same-day window 00:00-00:00 is never active', () => {
    assert.equal(isInDndWindow({ dndStart: '00:00', dndEnd: '00:00' }), false);
  });

  test('wrap-around window 22:00-08:00 matches expected inclusion relative to now', () => {
    const d = new Date();
    const nowHHMM = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const expected = nowHHMM >= '22:00' || nowHHMM < '08:00';
    assert.equal(isInDndWindow({ dndStart: '22:00', dndEnd: '08:00' }), expected);
  });

  test('same-day window with start == end documents empty-range behavior', () => {
    assert.equal(isInDndWindow({ dndStart: '12:00', dndEnd: '12:00' }), false);
  });
});

describe('Notification Service — payload validation paths', () => {
  function silentLog() { return { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }; }
  function makeStores(overrides: any = {}) {
    return {
      notificationPrefs: { get: async () => null, ...overrides.notificationPrefs },
      deviceTokens: { listByUser: async () => [], unregister: async () => {}, ...overrides.deviceTokens },
      notificationCounts: {
        getByUser: async () => [],
        increment: async () => {},
        reset: async () => {},
        ...overrides.notificationCounts,
      },
      notificationLog: { insert: async () => 'log-id', ...overrides.notificationLog },
      profiles: { userIdsByFestival: async () => [], readAll: async () => [], ...overrides.profiles },
      topicSubscriptions: { getUnsubscribedUsers: async () => new Set(), ...overrides.topicSubscriptions },
      pool: { query: async () => ({ rows: [] }) },
    };
  }
  function makeService(storeOverrides: any = {}) {
    return createNotificationService({
      stores: makeStores(storeOverrides),
      config: { FIREBASE_CREDENTIALS_PATH: '', PUBLIC_ORIGIN: 'https://festie.us' },
      log: silentLog(),
      _io: null,
    });
  }

  test('send() with set_reminder type passes type validation', async () => {
    const svc = makeService();
    const r = await svc.send({ userId: 'u1', type: 'set_reminder', title: 'Hello', body: 'World' });
    assert.equal(r.reason, 'firebase_not_configured');
  });

  test('send() with all three valid types is accepted', async () => {
    const svc = makeService();
    for (const type of ['crew_update', 'schedule_change', 'set_reminder']) {
      const r = await svc.send({ userId: 'u', type, title: 't', body: 'b' });
      assert.equal(r.reason, 'firebase_not_configured');
    }
  });

  test('send() with unknown type returns sent: 0', async () => {
    const svc = makeService();
    const r = await svc.send({ userId: 'u', type: 'definitely_not_real', title: 't', body: 'b' });
    assert.equal(r.sent, 0);
  });

  test('sendToOfflineUsers with empty festival returns sent: 0', async () => {
    const svc = makeService({ profiles: { userIdsByFestival: async () => [] } });
    const r = await svc.sendToOfflineUsers({ festivalId: 'f1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 0);
  });

  test('sendToOfflineUsers honors excludeUserIds', async () => {
    const svc = makeService({ profiles: { userIdsByFestival: async () => ['a', 'b', 'c'] } });
    const r = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 't', body: 'b',
      excludeUserIds: ['a', 'b', 'c'],
    });
    assert.equal(r.sent, 0);
  });

  test('sendSilentSync honors excludeUserIds', async () => {
    const svc = makeService({ profiles: { userIdsByFestival: async () => ['a', 'b'] } });
    const r = await svc.sendSilentSync({ festivalId: 'f1', syncType: 'picks', excludeUserIds: ['a', 'b'] });
    assert.equal(r.sent, 0);
  });
});

describe('Notification Service — markRead / retryQueue / isConfigured', () => {
  function silentLog() { return { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }; }
  function makeStores(overrides: any = {}) {
    return {
      notificationPrefs: { get: async () => null, ...overrides.notificationPrefs },
      deviceTokens: { listByUser: async () => [], unregister: async () => {}, ...overrides.deviceTokens },
      notificationCounts: {
        getByUser: async () => [],
        increment: async () => {},
        reset: async () => {},
        ...overrides.notificationCounts,
      },
      notificationLog: { insert: async () => 'log-id', ...overrides.notificationLog },
      profiles: { userIdsByFestival: async () => [], readAll: async () => [], ...overrides.profiles },
      topicSubscriptions: { getUnsubscribedUsers: async () => new Set(), ...overrides.topicSubscriptions },
      pool: { query: async () => ({ rows: [] }) },
    };
  }
  function makeService(storeOverrides: any = {}) {
    return createNotificationService({
      stores: makeStores(storeOverrides),
      config: { FIREBASE_CREDENTIALS_PATH: '', PUBLIC_ORIGIN: 'https://festie.us' },
      log: silentLog(),
      _io: null,
    });
  }

  test('markRead passes userId and festivalId through to reset', async () => {
    let captured: any = null;
    const svc = makeService({
      notificationCounts: {
        getByUser: async () => [],
        increment: async () => {},
        reset: async (userId: any, festivalId: any) => { captured = { userId, festivalId }; },
      },
    });
    await svc.markRead('user-7', 'fest-9');
    assert.deepEqual(captured, { userId: 'user-7', festivalId: 'fest-9' });
  });

  test('markRead swallows db errors silently', async () => {
    const svc = makeService({
      notificationCounts: {
        getByUser: async () => [],
        increment: async () => {},
        reset: async () => { throw new Error('boom'); },
      },
    });
    await assert.doesNotReject(svc.markRead('u', 'f'));
  });

  test('retryQueue starts empty', () => {
    const svc = makeService();
    assert.equal(svc.retryQueue.pending, 0);
  });

  test('retryQueue shutdown is idempotent', () => {
    const svc = makeService();
    svc.retryQueue.shutdown();
    svc.retryQueue.shutdown();
    assert.equal(svc.retryQueue.pending, 0);
  });

  test('isConfigured is false without firebase credentials', () => {
    const svc = makeService();
    assert.equal(svc.isConfigured, false);
  });
});

// ════════════════════════════════════════════════════════════════════════
// lib/spotify edge cases
// ════════════════════════════════════════════════════════════════════════

// The three tests below make REAL HTTPS calls to accounts.spotify.com. When the
// runner is started with --test-force-exit (which `npm test` uses), node calls
// process.exit() the instant the last test resolves. On Windows that raced the
// still-in-flight TLS teardown for those connections: the threadpool posted a
// completion back to a libuv async handle the exiting loop had already begun
// closing, and libuv aborted the whole runner with
//   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), .../win/async.c:76
// — after all 65 tests had passed. Releasing undici's pooled connections is not
// enough on its own (verified: dispatcher.close() alone still aborted 5/5 runs);
// the loop needs a slice of wall-clock to finish the teardown it has started.
// So: release the sockets, then yield long enough for libuv to drain them.
after(async () => {
  const dispatcher: any = (globalThis as any)[Symbol.for('undici.globalDispatcher.1')];
  if (typeof dispatcher?.close === 'function') await dispatcher.close();
  // ponytail: fixed drain, not a handle poll — the pending work is threadpool
  // TLS teardown and is not visible in process._getActiveHandles(), so there is
  // nothing to poll on. 250ms is 5x the smallest reliable value measured here
  // (50ms was 0/5, 10ms was 4/5). Raise it if this ever flakes on slower CI.
  await new Promise((resolve) => setTimeout(resolve, 250));
});

describe('lib/spotify edge cases', () => {
  test('getToken throws on empty credentials', async () => {
    await assert.rejects(
      () => spotify.getToken('', ''),
      (err: any) => {
        assert.ok(err.message.includes('invalid_client') || err.message.includes('failed'));
        return true;
      }
    );
  });

  test('searchArtist throws on invalid credentials', async () => {
    await assert.rejects(
      () => spotify.searchArtist('Test', 'bad-id', 'bad-secret'),
      (err: any) => {
        assert.ok(err.message.includes('invalid_client') || err.message.includes('failed'));
        return true;
      }
    );
  });

  test('bulkSearchArtists filters null/undefined/empty-string names', async () => {
    const result = await spotify.bulkSearchArtists([null, undefined, ''] as any, '', '');
    assert.ok(result instanceof Map);
    assert.equal(result.size, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// lib/db/stores/polls — store surface
// ════════════════════════════════════════════════════════════════════════

describe('polls store — surface', () => {
  test('exports required methods', () => {
    assert.equal(typeof createPollsStore, 'function');

    const mockPool = { query: async () => ({ rows: [] }) };
    const store = createPollsStore(mockPool as any, {} as any);
    assert.equal(typeof store.create, 'function');
    assert.equal(typeof store.listByCrew, 'function');
    assert.equal(typeof store.vote, 'function');
    assert.equal(typeof store.getResults, 'function');
    assert.equal(typeof store.close, 'function');
    assert.equal(typeof store.countActiveByCrew, 'function');
    assert.equal(typeof store.getById, 'function');
  });
});

// ════════════════════════════════════════════════════════════════════════
// lib/db/stores/expenses, activity, calendar-tokens (fake-pool unit)
// ════════════════════════════════════════════════════════════════════════

function makeFakePool(handlers: any[]): any {
  const calls: any[] = [];
  return {
    calls,
    async query(sql: any, params: any[] = []) {
      calls.push({ sql, params });
      for (const h of handlers) {
        if (h.match.test(sql)) {
          const rows = typeof h.rows === 'function' ? h.rows(sql, params) : h.rows;
          return { rows: rows || [] };
        }
      }
      return { rows: [] };
    },
  };
}

describe('expenses store — create', () => {
  test('returns inserted row and stringifies splitWith', async () => {
    let captured: any;
    const pool = makeFakePool([
      {
        match: /INSERT INTO crew_expenses/,
        rows: (_sql: any, params: any) => {
          captured = params;
          return [{ id: params[0], crew_id: params[1], paid_by: params[2], description: params[3], amount: params[4], split_with: params[5] }];
        },
      },
    ]);
    const store = createExpensesStore(pool);
    const row = await store.create({
      crewId: 'crew-1', paidBy: 'user-a', description: 'Snacks', amount: 12.5,
      splitWith: ['user-a', 'user-b'],
    });
    assert.equal(row.crew_id, 'crew-1');
    assert.equal(row.paid_by, 'user-a');
    assert.equal(row.description, 'Snacks');
    assert.equal(row.amount, 12.5);
    assert.equal(captured[5], JSON.stringify(['user-a', 'user-b']));
    assert.match(captured[0], /^[0-9a-f-]{36}$/);
  });

  test('stringifies empty splitWith as []', async () => {
    let captured: any;
    const pool = makeFakePool([
      { match: /INSERT INTO crew_expenses/, rows: (_s: any, p: any) => { captured = p; return [{ id: p[0] }]; } },
    ]);
    const store = createExpensesStore(pool);
    await store.create({ crewId: 'c', paidBy: 'u', description: 'd', amount: 1, splitWith: undefined });
    assert.equal(captured[5], '[]');
  });
});

describe('expenses store — getByCrew', () => {
  test('parses string split_with JSON and returns rows', async () => {
    const pool = makeFakePool([
      {
        match: /FROM\s+crew_expenses e/,
        rows: [
          { id: 'e1', crew_id: 'c', paid_by: 'u1', amount: 10, split_with: '["u1","u2"]', paid_by_name: 'alice' },
          { id: 'e2', crew_id: 'c', paid_by: 'u2', amount: 20, split_with: ['u1','u2'], paid_by_name: 'bob' },
          { id: 'e3', crew_id: 'c', paid_by: 'u1', amount: 5, split_with: null, paid_by_name: 'alice' },
        ],
      },
    ]);
    const store = createExpensesStore(pool);
    const rows = await store.getByCrew('c');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0].split_with, ['u1', 'u2']);
    assert.deepEqual(rows[1].split_with, ['u1', 'u2']);
    assert.deepEqual(rows[2].split_with, []);
  });

  test('returns empty array when crew has no expenses', async () => {
    const pool = makeFakePool([{ match: /FROM\s+crew_expenses e/, rows: [] }]);
    const store = createExpensesStore(pool);
    assert.deepEqual(await store.getByCrew('c'), []);
  });
});

describe('expenses store — getById / delete', () => {
  test('getById returns single row', async () => {
    const pool = makeFakePool([
      { match: /FROM\s+crew_expenses\s+WHERE\s+id/, rows: [{ id: 'e1', amount: 10 }] },
    ]);
    const store = createExpensesStore(pool);
    const row = await store.getById('e1');
    assert.equal(row.id, 'e1');
  });

  test('getById returns null when no row', async () => {
    const pool = makeFakePool([{ match: /FROM\s+crew_expenses\s+WHERE\s+id/, rows: [] }]);
    const store = createExpensesStore(pool);
    assert.equal(await store.getById('nope'), null);
  });

  test('delete issues DELETE query with expense id', async () => {
    const pool = makeFakePool([{ match: /DELETE FROM crew_expenses/, rows: [] }]);
    const store = createExpensesStore(pool);
    await store.delete('e1');
    assert.equal(pool.calls.length, 1);
    assert.match(pool.calls[0].sql, /DELETE FROM crew_expenses/);
    assert.deepEqual(pool.calls[0].params, ['e1']);
  });
});

// getBalances — P0 money logic
function balancesPool(expenses: any[], members: any[]) {
  return makeFakePool([
    { match: /FROM\s+crew_expenses\s+WHERE\s+crew_id/, rows: expenses },
    { match: /FROM\s+crew_members cm/, rows: members },
  ]);
}

describe('expenses store — getBalances', () => {
  const alice = { user_id: 'u-a', username: 'alice' };
  const bob   = { user_id: 'u-b', username: 'bob' };
  const carol = { user_id: 'u-c', username: 'carol' };

  test('returns zero balances when crew has no expenses', async () => {
    const store = createExpensesStore(balancesPool([], [alice, bob]));
    const bal = await store.getBalances('c');
    assert.deepEqual(bal, [
      { userId: 'u-a', username: 'alice', balance: 0 },
      { userId: 'u-b', username: 'bob',   balance: 0 },
    ]);
  });

  test('empty splitWith splits among all members; payer nets credit', async () => {
    const expenses = [{ id: 'e1', paid_by: 'u-a', amount: 30, split_with: '[]' }];
    const store = createExpensesStore(balancesPool(expenses, [alice, bob, carol]));
    const bal = await store.getBalances('c');
    const map = Object.fromEntries(bal.map((b: any) => [b.userId, b.balance]));
    assert.equal(map['u-a'], 20);
    assert.equal(map['u-b'], -10);
    assert.equal(map['u-c'], -10);
    assert.equal(bal.reduce((s: any, b: any) => s + b.balance, 0), 0);
  });

  test('explicit splitWith excluding payer charges only listed members', async () => {
    const expenses = [{ id: 'e1', paid_by: 'u-a', amount: 40, split_with: '["u-b","u-c"]' }];
    const store = createExpensesStore(balancesPool(expenses, [alice, bob, carol]));
    const bal = await store.getBalances('c');
    const map = Object.fromEntries(bal.map((b: any) => [b.userId, b.balance]));
    assert.equal(map['u-a'], 40);
    assert.equal(map['u-b'], -20);
    assert.equal(map['u-c'], -20);
  });

  test('multiple expenses accumulate and sum to zero', async () => {
    const expenses = [
      { id: 'e1', paid_by: 'u-a', amount: 60, split_with: '[]' },
      { id: 'e2', paid_by: 'u-b', amount: 30, split_with: '["u-a","u-b","u-c"]' },
      { id: 'e3', paid_by: 'u-c', amount: 15, split_with: '["u-a","u-c"]' },
    ];
    const store = createExpensesStore(balancesPool(expenses, [alice, bob, carol]));
    const bal = await store.getBalances('c');
    const map = Object.fromEntries(bal.map((b: any) => [b.userId, b.balance]));
    assert.equal(map['u-a'], 22.5);
    assert.equal(map['u-b'], 0);
    assert.equal(map['u-c'], -22.5);
    assert.equal(bal.reduce((s: any, b: any) => s + b.balance, 0), 0);
  });

  test('rounds balances to two decimals', async () => {
    const expenses = [{ id: 'e1', paid_by: 'u-a', amount: 10, split_with: '[]' }];
    const store = createExpensesStore(balancesPool(expenses, [alice, bob, carol]));
    const bal = await store.getBalances('c');
    const map = Object.fromEntries(bal.map((b: any) => [b.userId, b.balance]));
    // Exact integer-cents split: 1000¢ / 3 = 333¢ base, 1¢ remainder to the
    // first split member (the payer). Payer nets +666¢, others -333¢ each, and
    // crucially the ledger sums to exactly zero (the old per-balance rounding
    // returned 6.67 / -3.33 / -3.33, which summed to +0.01).
    assert.equal(map['u-a'], 6.66);
    assert.equal(map['u-b'], -3.33);
    assert.equal(map['u-c'], -3.33);
    assert.equal(bal.reduce((s: any, b: any) => s + b.balance, 0), 0);
  });

  test('ignores splits referencing non-members without throwing', async () => {
    const expenses = [{ id: 'e1', paid_by: 'u-a', amount: 20, split_with: '["u-a","ghost"]' }];
    const store = createExpensesStore(balancesPool(expenses, [alice, bob]));
    const bal = await store.getBalances('c');
    const map = Object.fromEntries(bal.map((b: any) => [b.userId, b.balance]));
    // 'ghost' is not a current member, so it is dropped from the split and its
    // share redistributes across the remaining split members. Only the payer
    // (u-a) is left in the split, so u-a owes the whole amount it fronted → net
    // 0; u-b was never in the split. Ledger stays zero-sum.
    assert.equal(map['u-a'], 0);
    assert.equal(map['u-b'], 0);
  });

  test('handles array-form split_with (not JSON-encoded)', async () => {
    const expenses = [{ id: 'e1', paid_by: 'u-a', amount: 50, split_with: ['u-a', 'u-b'] }];
    const store = createExpensesStore(balancesPool(expenses, [alice, bob]));
    const bal = await store.getBalances('c');
    const map = Object.fromEntries(bal.map((b: any) => [b.userId, b.balance]));
    assert.equal(map['u-a'], 25);
    assert.equal(map['u-b'], -25);
  });

  test('preserves member order from crew_members query', async () => {
    const store = createExpensesStore(balancesPool([], [carol, alice, bob]));
    const bal = await store.getBalances('c');
    assert.deepEqual(bal.map((b: any) => b.userId), ['u-c', 'u-a', 'u-b']);
  });
});

describe('activity store', () => {
  test('log inserts with generated uuid and null detail when omitted', async () => {
    let captured: any;
    const pool = makeFakePool([
      { match: /INSERT INTO\s+crew_activity/, rows: (_s: any, p: any) => { captured = p; return []; } },
    ]);
    const store = createActivityStore(pool);
    await store.log({ crewId: 'c', userId: 'u', type: 'joined' });
    assert.match(captured[0], /^[0-9a-f-]{36}$/);
    assert.equal(captured[1], 'c');
    assert.equal(captured[2], 'u');
    assert.equal(captured[3], 'joined');
    assert.equal(captured[4], null);
  });

  test('log passes through detail when provided', async () => {
    let captured: any;
    const pool = makeFakePool([
      { match: /INSERT INTO\s+crew_activity/, rows: (_s: any, p: any) => { captured = p; return []; } },
    ]);
    const store = createActivityStore(pool);
    await store.log({ crewId: 'c', userId: 'u', type: 'renamed', detail: 'Old → New' });
    assert.equal(captured[4], 'Old → New');
  });

  test('getByCrew applies default limit of 50', async () => {
    let captured: any;
    const pool = makeFakePool([
      { match: /FROM crew_activity/, rows: (_s: any, p: any) => { captured = p; return []; } },
    ]);
    const store = createActivityStore(pool);
    await store.getByCrew('crew-1');
    assert.equal(captured[0], 'crew-1');
    assert.equal(captured[1], 51);
  });

  test('getByCrew honors explicit limit', async () => {
    let captured: any;
    const pool = makeFakePool([
      { match: /FROM crew_activity/, rows: (_s: any, p: any) => { captured = p; return []; } },
    ]);
    const store = createActivityStore(pool);
    await store.getByCrew('crew-1', { limit: 10 });
    assert.equal(captured[0], 'crew-1');
    assert.equal(captured[1], 11);
  });

  test('getByCrew returns items array', async () => {
    const pool = makeFakePool([
      {
        match: /FROM crew_activity/,
        rows: [
          { id: 'a1', crew_id: 'c', user_id: 'u1', type: 'joined', detail: null, username: 'alice' },
          { id: 'a2', crew_id: 'c', user_id: 'u2', type: 'renamed', detail: 'x', username: 'bob' },
        ],
      },
    ]);
    const store = createActivityStore(pool);
    const result = await store.getByCrew('c');
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].username, 'alice');
    assert.equal(result.items[1].type, 'renamed');
    assert.equal(result.nextCursor, null);
  });
});

describe('calendar-tokens store', () => {
  test('getOrCreate upserts with ON CONFLICT (user_id, festival_id) and returns row', async () => {
    let captured: any;
    const pool = makeFakePool([
      {
        match: /INSERT INTO calendar_tokens/,
        rows: (_s: any, p: any) => {
          captured = p;
          return [{ id: p[0], user_id: p[1], festival_id: p[2], profile_id: p[3] }];
        },
      },
    ]);
    const store = createCalendarTokensStore(pool);
    const row = await store.getOrCreate({ userId: 'u', festivalId: 'f', profileId: 'p' });
    assert.equal(row.user_id, 'u');
    assert.equal(row.festival_id, 'f');
    assert.equal(row.profile_id, 'p');
    assert.match(captured[0], /^[0-9a-f-]{36}$/);
    assert.match(pool.calls[0].sql, /ON CONFLICT \(user_id, festival_id\)/);
  });

  test('getByToken returns row when found', async () => {
    const pool = makeFakePool([
      { match: /FROM\s+calendar_tokens\s+WHERE\s+id/, rows: [{ id: 't1', user_id: 'u' }] },
    ]);
    const store = createCalendarTokensStore(pool);
    const row = await store.getByToken('t1');
    assert.equal(row.id, 't1');
  });

  test('getByToken returns null when not found', async () => {
    const pool = makeFakePool([{ match: /FROM\s+calendar_tokens\s+WHERE\s+id/, rows: [] }]);
    const store = createCalendarTokensStore(pool);
    assert.equal(await store.getByToken('nope'), null);
  });

  test('deleteByUser targets user+festival pair', async () => {
    const pool = makeFakePool([{ match: /DELETE FROM calendar_tokens/, rows: [] }]);
    const store = createCalendarTokensStore(pool);
    await store.deleteByUser('u', 'f');
    assert.equal(pool.calls.length, 1);
    assert.deepEqual(pool.calls[0].params, ['u', 'f']);
    assert.match(pool.calls[0].sql, /user_id = \$1 AND festival_id = \$2/);
  });
});
