'use strict';

const Redis = require('ioredis');
const { loadConfig } = require('./config');

// Config centralized — all values flow through lib/config.js DEFAULTS
const _cfg = loadConfig();
const REDIS_URL = _cfg.REDIS_URL;
const REDIS_PREFIX = _cfg.REDIS_PREFIX;
const REDIS_ENABLED = _cfg.REDIS_ENABLED;

/**
 * Create a Redis client (or null if disabled).
 * SECURITY: Redis client has built-in failover via ioredis retry strategy.
 * When Redis is unavailable, the client will retry up to 10 times with exponential backoff.
 * Callers must implement fallback logic to in-memory storage when Redis operations fail.
 * @param {object} opts
 * @param {Function} opts.log
 * @returns {import('ioredis').Redis | null}
 */
function createRedisClient(opts = {}) {
  const enabled = opts.enabled !== undefined ? opts.enabled : REDIS_ENABLED;
  if (!enabled) return null;

  const log = opts.log || { info() {}, warn() {}, error() {} };
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) return null; // stop retrying after 10 attempts
      return Math.min(times * 200, 5000); // exponential backoff with 5s max
    },
    lazyConnect: false,
    enableReadyCheck: true,
    keyPrefix: REDIS_PREFIX,
  });

  client.on('connect', () => log.info('redis connected', { url: REDIS_URL.replace(/\/\/.*@/, '//***@') }));
  client.on('error', (err) => log.error('redis error', { error: err.message }));
  client.on('close', () => log.warn('redis connection closed'));

  return client;
}

/**
 * Create a duplicate Redis client for Socket.IO adapter (needs two connections).
 * @param {import('ioredis').Redis} client
 * @returns {import('ioredis').Redis}
 */
function duplicateClient(client) {
  // Socket.IO adapter + pub/sub clients must use maxRetriesPerRequest: null
  // so ioredis retries via retryStrategy instead of throwing
  // MaxRetriesPerRequestError (which becomes an unhandled rejection inside
  // the adapter and crashes the worker).
  const dup = client.duplicate({ maxRetriesPerRequest: null });
  dup.on('error', () => {});
  return dup;
}

// ─── Rate Limiter (Redis-backed) ──────────────────────────────────────────────

/**
 * Create a Redis-backed rate limiter that shares state across processes.
 * SECURITY: Graceful fallback to no rate limiting (returns "not limited") when Redis is unavailable.
 * Callers must implement in-memory rate limiting as secondary defense.
 * Falls back to the provided in-memory Map when Redis is unavailable.
 */
function createRedisRateLimiter(redis, { windowMs, maxRequests, prefix = 'rl' }) {
  if (!redis) return null;

  return {
    /**
     * Check if a key is rate-limited.
     * @param {string} key - IP address or userId
     * @returns {Promise<{ limited: boolean, remaining: number, resetMs: number }>}
     */
    async check(key) {
      const redisKey = `${prefix}:${key}`;
      try {
        const pipeline = redis.pipeline();
        pipeline.incr(redisKey);
        pipeline.pttl(redisKey);
        const results = await pipeline.exec();
        const count = results[0][1];
        let ttl = results[1][1];

        // First request — set expiry
        if (count === 1 || ttl < 0) {
          await redis.pexpire(redisKey, windowMs);
          ttl = windowMs;
        }

        const remaining = Math.max(0, maxRequests - count);
        return {
          limited: count > maxRequests,
          remaining,
          resetMs: ttl > 0 ? ttl : windowMs,
        };
      } catch {
        // Redis down — return not limited (fail open, fall through to in-memory or global rate limit)
        return { limited: false, remaining: maxRequests, resetMs: windowMs, fallback: true };
      }
    },
  };
}

// ─── Presence Store (Redis-backed) ────────────────────────────────────────────

function createRedisPresenceStore(redis) {
  if (!redis) return null;

  const PRESENCE_TTL = 120; // seconds — auto-expire if not refreshed

  return {
    async setOnline(festivalId, userId, username, socketId) {
      const key = `presence:${festivalId}`;
      const value = JSON.stringify({ userId, username, socketId });
      await redis.hset(key, socketId, value);
      await redis.expire(key, PRESENCE_TTL);
    },

    async setOffline(festivalId, socketId) {
      const key = `presence:${festivalId}`;
      await redis.hdel(key, socketId);
    },

    async getOnline(festivalId) {
      const key = `presence:${festivalId}`;
      const entries = await redis.hgetall(key);
      const users = new Map();
      for (const [, val] of Object.entries(entries)) {
        try {
          const { userId, username, socketId } = JSON.parse(val);
          if (!users.has(userId)) {
            users.set(userId, { userId, username, socketId });
          }
        } catch { /* skip corrupt entries */ }
      }
      return [...users.values()];
    },

    async removeBySocketId(socketId, festivalIds) {
      const pipeline = redis.pipeline();
      for (const fid of festivalIds) {
        pipeline.hdel(`presence:${fid}`, socketId);
      }
      await pipeline.exec();
    },

    async refresh(festivalId) {
      await redis.expire(`presence:${festivalId}`, PRESENCE_TTL);
    },
  };
}

// ─── Cache Invalidation (Redis Pub/Sub) ─────────────────────────────────────

/**
 * Create a Redis-backed cache invalidation bus for cross-worker cache sync.
 * When a worker mutates users or festivals, it publishes an invalidation event.
 * All workers (including the publisher) subscribe and bump their local version.
 */
function createCacheInvalidationBus(redis, { log, onInvalidateUsers, onInvalidateFestivals }) {
  if (!redis) return null;

  const CHANNEL_USERS = 'cache:invalidate:users';
  const CHANNEL_FESTIVALS = 'cache:invalidate:festivals';

  // Need a dedicated subscriber connection (ioredis in subscribe mode can't do commands)
  const sub = redis.duplicate();
  sub.on('error', (err) => log.error('cache-bus subscriber error', { error: err.message }));

  sub.subscribe(CHANNEL_USERS, CHANNEL_FESTIVALS, (err) => {
    if (err) {
      log.error('cache-bus subscribe failed', { error: err.message });
    } else {
      log.info('cache-bus subscribed', { channels: [CHANNEL_USERS, CHANNEL_FESTIVALS] });
    }
  });

  sub.on('message', (channel, _message) => {
    if (channel === CHANNEL_USERS && typeof onInvalidateUsers === 'function') {
      onInvalidateUsers();
    } else if (channel === CHANNEL_FESTIVALS && typeof onInvalidateFestivals === 'function') {
      onInvalidateFestivals();
    }
  });

  return {
    publishUserInvalidation() {
      redis.publish(CHANNEL_USERS, String(Date.now())).catch(() => {});
    },
    publishFestivalInvalidation() {
      redis.publish(CHANNEL_FESTIVALS, String(Date.now())).catch(() => {});
    },
    async close() {
      try { await sub.unsubscribe(); } catch { /* ignore */ }
      try { sub.disconnect(); } catch { /* ignore */ }
    },
  };
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

/**
 * Wraps a Redis client with a circuit breaker that fails open after consecutive errors.
 * When the circuit is open, all operations silently return null/defaults instead of
 * hitting Redis, preventing cascade failures when Redis is down.
 */
function createRedisCircuitBreaker(redis, { maxFailures = 3, resetTimeMs = 30000, log } = {}) {
  if (!redis) return null;

  let failures = 0;
  let circuitOpen = false;
  let lastFailure = 0;

  function recordSuccess() {
    if (failures > 0) {
      failures = 0;
      if (circuitOpen) {
        circuitOpen = false;
        log?.info('redis circuit breaker closed — connection restored');
      }
    }
  }

  function recordFailure(_err) {
    failures++;
    lastFailure = Date.now();
    if (!circuitOpen && failures >= maxFailures) {
      circuitOpen = true;
      log?.warn('redis circuit breaker OPEN — failing open after consecutive errors', { failures, resetTimeMs });
    }
  }

  function isOpen() {
    if (!circuitOpen) return false;
    // Auto-reset after resetTimeMs to allow a probe
    if (Date.now() - lastFailure >= resetTimeMs) {
      circuitOpen = false;
      failures = 0;
      log?.info('redis circuit breaker half-open — allowing probe');
      return false;
    }
    return true;
  }

  /**
   * Execute a Redis operation with circuit breaker protection.
   * @param {Function} fn - Async function that performs the Redis operation
   * @param {*} fallback - Value to return when circuit is open
   * @returns {Promise<*>}
   */
  async function exec(fn, fallback = null) {
    if (isOpen()) return fallback;
    try {
      const result = await fn();
      recordSuccess();
      return result;
    } catch (err) {
      recordFailure(err);
      return fallback;
    }
  }

  return {
    exec,
    isOpen,
    getState: () => ({ failures, circuitOpen, lastFailure }),
  };
}

// ─── Query Result Caching (Redis-backed with in-memory fallback) ───────────────

/**
 * Create a cached query fetcher with Redis + in-memory fallback
 * Pattern: check Redis first, fall back to in-memory cache, populate Redis on miss
 * Useful for expensive queries like festival load, profile load, user maps
 * @param {Object} opts - Options
 * @param {import('ioredis').Redis} opts.redis - Redis client (optional)
 * @param {Function} opts.fetcher - Async function that fetches fresh data
 * @param {number} opts.ttl - TTL in seconds (default: 60)
 * @param {string} opts.key - Redis key prefix
 * @returns {Object} - { get(), invalidate() }
 */
function createCachedFetcher({ redis, fetcher, ttl = 60, key }) {
  let inMemoryCache = null;
  let inMemoryExpires = 0;

  return {
    /**
     * Get value from cache or fetch fresh
     * @returns {Promise<any>} - Cached or fresh data
     */
    async get() {
      const now = Date.now();

      // Check in-memory cache first (fast path)
      if (inMemoryCache !== null && now < inMemoryExpires) {
        return inMemoryCache;
      }

      // Try Redis (distributed cache)
      if (redis) {
        try {
          const cached = await redis.get(key);
          if (cached) {
            const parsed = JSON.parse(cached);
            // Populate in-memory cache
            // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
            inMemoryCache = parsed;
            // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
            inMemoryExpires = now + (ttl * 1000);
            return parsed;
          }
        } catch {
          // Redis error or parse error — continue to fetcher
        }
      }

      // Cache miss — fetch fresh data
      const fresh = await fetcher();

      // Populate both caches
      if (redis) {
        try {
          await redis.setex(key, ttl, JSON.stringify(fresh));
        } catch {
          // Redis write failed — still have in-memory cache
        }
      }
      // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
      inMemoryCache = fresh;
      // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
      inMemoryExpires = now + (ttl * 1000);

      return fresh;
    },

    /**
     * Invalidate cache (both Redis and in-memory)
     */
    async invalidate() {
      inMemoryCache = null;
      inMemoryExpires = 0;
      if (redis) {
        try {
          await redis.del(key);
        } catch {
          // Ignore Redis errors
        }
      }
    },
  };
}

// ─── Generic Rate Check (Redis-backed, per-call max) ─────────────────────────

/**
 * Atomic rate limit check using Redis INCR + PEXPIRE.
 * Unlike createRedisRateLimiter (fixed max), this accepts max per-call —
 * needed for scoped route limits where each scope has a different cap.
 * @param {import('ioredis').Redis} redis
 * @param {string} key - Full Redis key (caller must include scope + identity)
 * @param {number} max - Maximum requests allowed in the window
 * @param {number} windowMs - Window duration in milliseconds
 * @returns {Promise<{ limited: boolean, count: number, remaining: number, resetMs: number, fallback?: boolean }>}
 */
async function redisRateCheck(redis, key, max, windowMs) {
  if (!redis) return { limited: false, count: 0, remaining: max, resetMs: windowMs, fallback: true };
  try {
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.pttl(key);
    const results = await pipeline.exec();
    const count = results[0][1];
    let ttl = results[1][1];
    if (count === 1 || ttl < 0) {
      await redis.pexpire(key, windowMs);
      ttl = windowMs;
    }
    return {
      limited: count > max,
      count,
      remaining: Math.max(0, max - count),
      resetMs: ttl > 0 ? ttl : windowMs,
    };
  } catch {
    return { limited: false, count: 0, remaining: max, resetMs: windowMs, fallback: true };
  }
}

module.exports = {
  createRedisClient,
  duplicateClient,
  createRedisRateLimiter,
  createRedisPresenceStore,
  createCacheInvalidationBus,
  createRedisCircuitBreaker,
  createCachedFetcher,
  redisRateCheck,
  REDIS_ENABLED,
  REDIS_PREFIX,
};
