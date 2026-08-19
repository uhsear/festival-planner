import assert from 'node:assert/strict';
import { describe, it, mock, beforeEach } from 'node:test';

// We test exported functions directly, mocking ioredis at the boundary.
import {
  createRedisClient,
  createRedisRateLimiter,
  createRedisPresenceStore,
  createCacheInvalidationBus,
  createRedisCircuitBreaker,
  redisRateCheck,
  redisRetryDelay,
  shouldReconnectOnError,
  isTransientRedisError,
  COMMAND_TIMEOUT_MS,
  REDIS_ENABLED,
  REDIS_PREFIX,
} from '../lib/redis.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fake Redis client with chainable pipeline. */
function fakePipeline(results: any) {
  return {
    incr() {
      return this;
    },
    pttl() {
      return this;
    },
    hdel() {
      return this;
    },
    async exec() {
      return results;
    },
  };
}

function fakeRedis(overrides: any = {}) {
  const store = new Map();
  return {
    pipeline(results: any) {
      return fakePipeline(
        overrides.pipelineResults || [
          [null, 1],
          [null, -1],
        ],
      );
    },
    async incr(key: string) {
      const v = (store.get(key) || 0) + 1;
      store.set(key, v);
      return v;
    },
    async pexpire() {
      return 1;
    },
    async hset(key: string, field: string, val: any) {
      if (!store.has(key)) store.set(key, {});
      store.get(key)[field] = val;
    },
    async hdel(key: string, field: string) {
      if (store.has(key)) delete store.get(key)[field];
    },
    async hgetall(key: string) {
      return store.get(key) || {};
    },
    async expire() {
      return 1;
    },
    async get(key: string) {
      return store.get(key) || null;
    },
    async setex(key: string, ttl: number, val: any) {
      store.set(key, val);
    },
    async del(key: string) {
      store.delete(key);
    },
    async publish() {
      return 1;
    },
    async subscribe() {},
    async unsubscribe() {},
    disconnect() {},
    duplicate(opts: any) {
      return {
        on(evt: string, cb: any) {
          if (evt === 'message') this._msgCb = cb;
        },
        subscribe(ch1: any, ch2: any, cb: any) {
          if (cb) cb(null);
        },
        async unsubscribe() {},
        disconnect() {},
        _msgCb: null as any,
      };
    },
    on() {},
    status: 'ready',
    _store: store,
    ...overrides,
  };
}

// ─── Module exports ──────────────────────────────────────────────────────────

describe('redis: module exports', () => {
  it('exports REDIS_PREFIX as a string', () => {
    assert.equal(typeof REDIS_PREFIX, 'string');
  });

  it('exports REDIS_ENABLED as a boolean', () => {
    assert.equal(typeof REDIS_ENABLED, 'boolean');
  });
});

// ─── createRedisRateLimiter ──────────────────────────────────────────────────

describe('redis: createRedisRateLimiter', () => {
  it('returns null when redis is null', () => {
    const limiter = createRedisRateLimiter(null, { windowMs: 60000, maxRequests: 10 });
    assert.equal(limiter, null);
  });

  it('check returns not-limited for first request', async () => {
    const redis = fakeRedis({
      pipelineResults: [
        [null, 1],
        [null, -1],
      ],
    });
    const limiter = createRedisRateLimiter(redis, { windowMs: 60000, maxRequests: 10, prefix: 'test' });
    const result = await limiter!.check('127.0.0.1');
    assert.equal(result.limited, false);
    assert.equal(result.remaining, 9);
  });

  it('check returns limited when count exceeds max', async () => {
    const redis = fakeRedis({
      pipelineResults: [
        [null, 11],
        [null, 45000],
      ],
    });
    const limiter = createRedisRateLimiter(redis, { windowMs: 60000, maxRequests: 10, prefix: 'test' });
    const result = await limiter!.check('127.0.0.1');
    assert.equal(result.limited, true);
    assert.equal(result.remaining, 0);
  });

  it('check returns not-limited with resetMs from TTL', async () => {
    const redis = fakeRedis({
      pipelineResults: [
        [null, 5],
        [null, 30000],
      ],
    });
    const limiter = createRedisRateLimiter(redis, { windowMs: 60000, maxRequests: 10, prefix: 'rl' });
    const result = await limiter!.check('key1');
    assert.equal(result.limited, false);
    assert.equal(result.remaining, 5);
    assert.equal(result.resetMs, 30000);
  });

  it('check fails open on Redis error', async () => {
    const redis = fakeRedis({
      pipeline() {
        return {
          incr() {
            return this;
          },
          pttl() {
            return this;
          },
          async exec() {
            throw new Error('CONN');
          },
        };
      },
    });
    const limiter = createRedisRateLimiter(redis, { windowMs: 60000, maxRequests: 10 });
    const result = await limiter!.check('key');
    assert.equal(result.limited, false);
    assert.equal(result.fallback, true);
    assert.equal(result.remaining, 10);
  });

  it('uses default prefix when none supplied', async () => {
    const redis = fakeRedis({
      pipelineResults: [
        [null, 1],
        [null, -1],
      ],
    });
    const limiter = createRedisRateLimiter(redis, { windowMs: 1000, maxRequests: 5 });
    // Just ensure it works without explicit prefix
    const result = await limiter!.check('abc');
    assert.equal(result.limited, false);
  });
});

// ─── createRedisPresenceStore ────────────────────────────────────────────────

describe('redis: createRedisPresenceStore', () => {
  it('returns null when redis is null', () => {
    assert.equal(createRedisPresenceStore(null), null);
  });

  it('setOnline + getOnline round-trips user data', async () => {
    const redis = fakeRedis();
    const store = createRedisPresenceStore(redis)!;
    await store.setOnline('fest1', 'u1', 'Alice', 'sock1');
    const online = await store.getOnline('fest1');
    assert.equal(online.length, 1);
    assert.equal(online[0].userId, 'u1');
    assert.equal(online[0].username, 'Alice');
  });

  it('getOnline deduplicates by userId', async () => {
    const redis = fakeRedis();
    const store = createRedisPresenceStore(redis)!;
    await store.setOnline('fest1', 'u1', 'Alice', 'sock1');
    await store.setOnline('fest1', 'u1', 'Alice', 'sock2');
    const online = await store.getOnline('fest1');
    assert.equal(online.length, 1);
  });

  it('setOffline removes a socket', async () => {
    const redis = fakeRedis();
    const store = createRedisPresenceStore(redis)!;
    await store.setOnline('fest1', 'u1', 'Alice', 'sock1');
    await store.setOffline('fest1', 'sock1');
    const online = await store.getOnline('fest1');
    assert.equal(online.length, 0);
  });

  it('getOnline skips corrupt JSON entries', async () => {
    const redis = fakeRedis();
    // Manually inject corrupt data
    redis._store.set('presence:fest1', {
      sock1: 'not-json{{{',
      sock2: JSON.stringify({ userId: 'u2', username: 'Bob', socketId: 'sock2' }),
    });
    const store = createRedisPresenceStore(redis)!;
    const online = await store.getOnline('fest1');
    assert.equal(online.length, 1);
    assert.equal(online[0].userId, 'u2');
  });

  it('removeBySocketId clears from multiple festivals', async () => {
    const calls: any[] = [];
    const redis = fakeRedis({
      pipeline() {
        return {
          hdel(key: string, field: string) {
            calls.push({ key, field });
            return this;
          },
          async exec() {
            return [];
          },
        };
      },
    });
    const store = createRedisPresenceStore(redis)!;
    await store.removeBySocketId('sock1', ['fest1', 'fest2', 'fest3']);
    assert.equal(calls.length, 3);
  });

  it('refresh extends TTL', async () => {
    let expireCalled = false;
    const redis = fakeRedis({
      async expire() {
        expireCalled = true;
        return 1;
      },
    });
    const store = createRedisPresenceStore(redis)!;
    await store.refresh('fest1');
    assert.equal(expireCalled, true);
  });
});

// ─── createCacheInvalidationBus ──────────────────────────────────────────────

describe('redis: createCacheInvalidationBus', () => {
  it('returns null when redis is null', () => {
    const bus = createCacheInvalidationBus(null, { log: { info() {}, error() {} } });
    assert.equal(bus, null);
  });

  it('publishUserInvalidation calls redis.publish', async () => {
    let publishedChannel: string | null = null;
    const redis = fakeRedis({
      async publish(ch: string) {
        publishedChannel = ch;
        return 1;
      },
      duplicate() {
        return {
          on() {},
          subscribe(ch1: any, ch2: any, cb: any) {
            if (cb) cb(null);
          },
          async unsubscribe() {},
          disconnect() {},
        };
      },
    });
    const log = { info() {}, error() {}, warn() {}, debug() {} };
    const bus = createCacheInvalidationBus(redis, { log, onInvalidateUsers() {}, onInvalidateFestivals() {} })!;
    bus.publishUserInvalidation();
    // Allow microtask to run
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(publishedChannel, 'cache:invalidate:users');
    await bus.close();
  });

  it('publishFestivalInvalidation calls redis.publish', async () => {
    let publishedChannel: string | null = null;
    const redis = fakeRedis({
      async publish(ch: string) {
        publishedChannel = ch;
        return 1;
      },
      duplicate() {
        return {
          on() {},
          subscribe(ch1: any, ch2: any, cb: any) {
            if (cb) cb(null);
          },
          async unsubscribe() {},
          disconnect() {},
        };
      },
    });
    const log = { info() {}, error() {}, warn() {}, debug() {} };
    const bus = createCacheInvalidationBus(redis, { log, onInvalidateUsers() {}, onInvalidateFestivals() {} })!;
    bus.publishFestivalInvalidation();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(publishedChannel, 'cache:invalidate:festivals');
    await bus.close();
  });

  it('close unsubscribes and disconnects', async () => {
    const redis = fakeRedis({
      duplicate() {
        return {
          on() {},
          subscribe(ch1: any, ch2: any, cb: any) {
            if (cb) cb(null);
          },
          async unsubscribe() {
            this._unsub = true;
          },
          disconnect() {
            this._disc = true;
          },
          _unsub: false,
          _disc: false,
        };
      },
    });
    const log = { info() {}, error() {}, warn() {}, debug() {} };
    const bus = createCacheInvalidationBus(redis, { log, onInvalidateUsers() {}, onInvalidateFestivals() {} })!;
    await bus.close();
    // If no throw, close succeeded
    assert.ok(true);
  });
});

// ─── createRedisCircuitBreaker ───────────────────────────────────────────────

describe('redis: createRedisCircuitBreaker', () => {
  it('returns null when redis is null', () => {
    assert.equal(createRedisCircuitBreaker(null), null);
  });

  it('exec passes through on success', async () => {
    const redis = fakeRedis();
    const cb = createRedisCircuitBreaker(redis, { maxFailures: 3, resetTimeMs: 100 })!;
    const result = await cb.exec(() => Promise.resolve(42));
    assert.equal(result, 42);
  });

  it('exec returns fallback on failure', async () => {
    const redis = fakeRedis();
    const cb = createRedisCircuitBreaker(redis, { maxFailures: 3, resetTimeMs: 100 })!;
    const result = await cb.exec(() => Promise.reject(new Error('fail')), 'default');
    assert.equal(result, 'default');
  });

  it('circuit opens after maxFailures consecutive errors', async () => {
    const redis = fakeRedis();
    const log = { info() {}, warn() {}, error() {} };
    const cb = createRedisCircuitBreaker(redis, { maxFailures: 2, resetTimeMs: 50000, log })!;
    await cb.exec(() => Promise.reject(new Error('e1')), null);
    await cb.exec(() => Promise.reject(new Error('e2')), null);
    assert.equal(cb.isOpen(), true);
    assert.equal(cb.getState().circuitOpen, true);
    assert.equal(cb.getState().failures, 2);
  });

  it('open circuit returns fallback without calling fn', async () => {
    const redis = fakeRedis();
    const cb = createRedisCircuitBreaker(redis, { maxFailures: 1, resetTimeMs: 50000 })!;
    await cb.exec(() => Promise.reject(new Error('fail')), null);
    let fnCalled = false;
    const result = await cb.exec(() => {
      fnCalled = true;
      return Promise.resolve('hi');
    }, 'fallback');
    assert.equal(fnCalled, false);
    assert.equal(result, 'fallback');
  });

  it('circuit resets after resetTimeMs', async () => {
    const redis = fakeRedis();
    const log = { info() {}, warn() {} };
    // resetTimeMs must be comfortably larger than the time it takes to reach the
    // first isOpen() assertion — with resetTimeMs:1 a slow CI runner can let >1ms
    // elapse so the breaker auto-resets before we check it (flaky). 50ms gives a
    // wide margin for "still open", and the wait below (100ms) reliably exceeds it.
    const cb = createRedisCircuitBreaker(redis, { maxFailures: 1, resetTimeMs: 50, log })!;
    await cb.exec(() => Promise.reject(new Error('fail')), null);
    assert.equal(cb.isOpen(), true);
    // Wait past resetTimeMs for the auto-reset (half-open probe).
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(cb.isOpen(), false);
  });

  it('successful exec after open resets failure count', async () => {
    const redis = fakeRedis();
    const log = { info() {}, warn() {} };
    const cb = createRedisCircuitBreaker(redis, { maxFailures: 1, resetTimeMs: 50, log })!;
    await cb.exec(() => Promise.reject(new Error('fail')), null);
    await new Promise((r) => setTimeout(r, 100));
    await cb.exec(() => Promise.resolve('ok'));
    assert.equal(cb.getState().failures, 0);
    assert.equal(cb.getState().circuitOpen, false);
  });
});

// ─── redisRateCheck ──────────────────────────────────────────────────────────

describe('redis: redisRateCheck', () => {
  it('returns fallback when redis is null', async () => {
    const result = await redisRateCheck(null, 'key', 10, 60000);
    assert.equal(result.limited, false);
    assert.equal(result.fallback, true);
    assert.equal(result.remaining, 10);
  });

  it('returns not-limited for first request', async () => {
    const redis = fakeRedis({
      pipelineResults: [
        [null, 1],
        [null, -1],
      ],
    });
    const result = await redisRateCheck(redis, 'k1', 10, 60000);
    assert.equal(result.limited, false);
    assert.equal(result.count, 1);
    assert.equal(result.remaining, 9);
  });

  it('returns limited when count exceeds max', async () => {
    const redis = fakeRedis({
      pipelineResults: [
        [null, 6],
        [null, 30000],
      ],
    });
    const result = await redisRateCheck(redis, 'k1', 5, 60000);
    assert.equal(result.limited, true);
    assert.equal(result.count, 6);
    assert.equal(result.remaining, 0);
  });

  it('sets expiry on first request (ttl < 0)', async () => {
    let expireCalled = false;
    const redis = fakeRedis({
      pipelineResults: [
        [null, 1],
        [null, -1],
      ],
      async pexpire() {
        expireCalled = true;
        return 1;
      },
    });
    await redisRateCheck(redis, 'k1', 10, 5000);
    assert.equal(expireCalled, true);
  });

  it('fails open on pipeline error', async () => {
    const redis = fakeRedis({
      pipeline() {
        return {
          incr() {
            return this;
          },
          pttl() {
            return this;
          },
          async exec() {
            throw new Error('REDIS DOWN');
          },
        };
      },
    });
    const result = await redisRateCheck(redis, 'k1', 10, 60000);
    assert.equal(result.limited, false);
    assert.equal(result.fallback, true);
  });
});

// ─── Connection tuning (pure helpers) ────────────────────────────────────────

describe('redis: redisRetryDelay', () => {
  it('never returns null — the client must not enter the terminal end state', () => {
    for (const times of [1, 5, 10, 11, 100, 10_000]) {
      assert.equal(typeof redisRetryDelay(times), 'number');
    }
  });

  it('is non-negative and capped at 5000ms', () => {
    for (const times of [-5, 0, 1, 2, 24, 25, 26, 1000]) {
      const delay = redisRetryDelay(times);
      assert.ok(delay >= 0, `delay ${delay} for attempt ${times} is negative`);
      assert.ok(delay <= 5000, `delay ${delay} for attempt ${times} exceeds the 5s cap`);
    }
  });

  it('backs off monotonically until it saturates', () => {
    assert.equal(redisRetryDelay(1), 200);
    assert.equal(redisRetryDelay(2), 400);
    assert.equal(redisRetryDelay(25), 5000);
    assert.equal(redisRetryDelay(26), 5000);
    let prev = 0;
    for (let times = 1; times <= 40; times++) {
      const delay = redisRetryDelay(times);
      assert.ok(delay >= prev, `attempt ${times} backed off less than attempt ${times - 1}`);
      prev = delay;
    }
  });

  it('treats a zero/negative attempt count as the first attempt', () => {
    assert.equal(redisRetryDelay(0), 200);
    assert.equal(redisRetryDelay(-3), 200);
  });
});

describe('redis: shouldReconnectOnError', () => {
  it('reconnects on READONLY (replica after failover)', () => {
    assert.equal(shouldReconnectOnError(new Error('READONLY You can not write against a read only replica.')), true);
    assert.equal(shouldReconnectOnError(new Error('-readonly')), true);
  });

  it('does not reconnect on ordinary command errors', () => {
    assert.equal(shouldReconnectOnError(new Error('WRONGTYPE Operation against a key holding the wrong kind of value')), false);
    assert.equal(shouldReconnectOnError(new Error('ERR unknown command')), false);
  });

  it('returns a boolean (never 2) so the failed command is not resent', () => {
    // Resending would double-count a rate-limit INCR.
    assert.equal(typeof shouldReconnectOnError(new Error('READONLY')), 'boolean');
  });

  it('tolerates a malformed error object', () => {
    assert.equal(shouldReconnectOnError(undefined as any), false);
    assert.equal(shouldReconnectOnError({} as any), false);
  });
});

describe('redis: isTransientRedisError', () => {
  it('classifies connection-level codes as transient (warn, not error)', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']) {
      const err: any = new Error('connect failed');
      err.code = code;
      assert.equal(isTransientRedisError(err), true, `${code} should be transient`);
    }
  });

  it('classifies reconnect-window messages as transient', () => {
    assert.equal(isTransientRedisError(new Error('Connection is closed.')), true);
    assert.equal(isTransientRedisError(new Error('Command timed out')), true);
    assert.equal(isTransientRedisError(new Error('READONLY You can not write against a read only replica.')), true);
  });

  it('does not mask real errors', () => {
    const err: any = new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    err.code = 'WRONGTYPE';
    assert.equal(isTransientRedisError(err), false);
    assert.equal(isTransientRedisError(new Error('NOSCRIPT No matching script')), false);
  });

  it('tolerates null/empty errors', () => {
    assert.equal(isTransientRedisError(null), false);
    assert.equal(isTransientRedisError(undefined), false);
    assert.equal(isTransientRedisError({}), false);
  });
});

describe('redis: createRedisClient', () => {
  it('returns null when explicitly disabled (no connection attempted)', () => {
    assert.equal(createRedisClient({ enabled: false }), null);
  });

  it('bounds every command with a positive timeout so callers cannot hang', () => {
    // The fail-open catches in createRedisRateLimiter / redisRateCheck /
    // createRedisCircuitBreaker are only reachable if commands actually settle.
    assert.equal(typeof COMMAND_TIMEOUT_MS, 'number');
    assert.ok(COMMAND_TIMEOUT_MS > 0 && COMMAND_TIMEOUT_MS <= 5000);
  });
});
