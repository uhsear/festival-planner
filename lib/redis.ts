import Redis from 'ioredis';
import { loadConfig } from './config.js';

// Config centralized — all values flow through lib/config.js DEFAULTS
const _cfg = loadConfig();
const REDIS_URL = _cfg.REDIS_URL;
const REDIS_PREFIX = _cfg.REDIS_PREFIX;
const REDIS_ENABLED = _cfg.REDIS_ENABLED;

// ─── Connection tuning ───────────────────────────────────────────────────────

/**
 * Hard ceiling on how long any single Redis command may stay unsettled.
 * Healthy p99 for this deployment is single-digit milliseconds, so 1.5s is
 * ~200x headroom while still covering several reconnect attempts.
 */
const COMMAND_TIMEOUT_MS = 1500;

/**
 * Reconnect backoff: linear ramp capped at 5s that NEVER gives up.
 * The previous strategy returned null after 10 attempts, which puts the client
 * in the terminal "end" state — a 15-second Redis restart would then disable
 * rate limiting, presence and the Socket.IO adapter until the worker itself was
 * restarted. A backend worker outlives any Redis restart, so it must keep
 * trying. Always non-negative, always <= 5000, never null.
 */
function redisRetryDelay(times: number): number {
  return Math.min(Math.max(1, times) * 200, 5000);
}

/**
 * Reconnect — but never resend — when the server answers READONLY, i.e. this
 * connection now points at a replica after a failover.
 * Returning 2 (reconnect AND resend) is unsafe here: our Redis traffic is
 * INCR/HSET, not idempotent reads, so a resent rate-limit INCR double-counts.
 */
function shouldReconnectOnError(err: Error): boolean {
  return /READONLY/i.test(err?.message ?? '');
}

/**
 * Connection-level failures expected during a Redis restart or failover.
 * retryStrategy is already handling these, so they are warn-worthy, not
 * error-worthy — logging every reconnect attempt at error level buries the
 * real bugs (this is what produced the repeated prod noise).
 */
const TRANSIENT_REDIS_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function isTransientRedisError(err: any): boolean {
  if (!err) return false;
  if (err.code && TRANSIENT_REDIS_ERROR_CODES.has(err.code)) return true;
  return /Connection is closed|Command timed out|READONLY/i.test(err.message ?? '');
}

/**
 * Create a Redis client (or null if disabled).
 * SECURITY: every Redis-backed subsystem must still fail OPEN when this client
 * cannot reach the server — see createRedisRateLimiter, redisRateCheck and
 * createRedisCircuitBreaker. The options below are chosen so those catch blocks
 * are reachable in bounded time rather than being bypassed by a hung promise.
 */
function createRedisClient(opts: any = {}): Redis | null {
  const enabled = opts.enabled !== undefined ? opts.enabled : REDIS_ENABLED;
  if (!enabled) return null;

  const log = opts.log || { info() {}, warn() {}, error() {} };
  const client = new Redis(REDIS_URL, {
    // WHY THESE OPTIONS — single-worker backend where Redis backs rate
    // limiting, sessions, the Socket.IO adapter, presence and the
    // live-location cache:
    //
    // maxRetriesPerRequest: null — the ioredis default of 3 makes ioredis flush
    //   the entire command queue with MaxRetriesPerRequestError from its own
    //   `close` handler on every 4th reconnect attempt. Those rejections land
    //   on callers that do not all have a catch (presence writes, adapter
    //   publishes) and surfaced in production as unhandled rejections. null
    //   hands reconnect ownership to retryStrategy; commandTimeout below is
    //   what guarantees a command still settles.
    // enableOfflineQueue: FALSE — deliberately off, and it must stay off while
    //   maxRetriesPerRequest is null. Buffering looks attractive (a short blip
    //   becomes invisible) but the two options interact badly:
    //     * commandTimeout rejects the CALLER after 1.5s, but ioredis never
    //       splices the timed-out command out of offlineQueue
    //       (Command.js only calls this.reject()).
    //     * the periodic flushQueue(MaxRetriesPerRequestError) that used to
    //       drain that queue is guarded by
    //       `typeof maxRetriesPerRequest === "number"`, so null disables it.
    //   Together those make the queue grow unbounded for the length of an
    //   outage and then REPLAY the whole backlog on reconnect — stale rate-limit
    //   INCRs and stale presence writes applied minutes late. Failing fast is
    //   strictly better here because every consumer already fails open:
    //   lib/redis.ts:171-173/:349-351/:388-389 return { limited:false,
    //   fallback:true } and lib/presence.ts:15/32/42 all catch. A dropped
    //   presence tick self-heals on the next one; a replayed one lies.
    // commandTimeout — still the backstop for the connected-but-wedged case, so
    //   a command always settles and the fail-open catches engage.
    // retryStrategy / reconnectOnError — see the functions above.
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    commandTimeout: COMMAND_TIMEOUT_MS,
    retryStrategy: redisRetryDelay,
    reconnectOnError: shouldReconnectOnError,
    lazyConnect: false,
    enableReadyCheck: true,
    keyPrefix: REDIS_PREFIX,
  });

  client.on('connect', () => log.info('redis connected', { url: REDIS_URL.replace(/\/\/.*@/, '//***@') }));
  client.on('error', (err: any) => {
    // Expected reconnect churn is a warn; anything else is a real error.
    const level = isTransientRedisError(err) ? 'warn' : 'error';
    log[level]('redis error', { error: err.message, code: err.code });
  });
  client.on('close', () => log.warn('redis connection closed'));

  return client;
}

/**
 * Create a duplicate Redis client for Socket.IO adapter (needs two connections).
 */
function duplicateClient(client: Redis): Redis {
  // maxRetriesPerRequest: null is now inherited from the parent, but keep it
  // explicit — an adapter/pub-sub client must never throw
  // MaxRetriesPerRequestError, which becomes an unhandled rejection inside the
  // adapter and crashes the worker.
  const dup = client.duplicate({ maxRetriesPerRequest: null });
  // Swallowed on purpose: this connection targets the same server as the
  // parent, whose `error` handler already logs every connectivity failure.
  // Logging here only duplicates it. The listener itself is required — an
  // ioredis client with no `error` listener throws on emit.
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
function createRedisRateLimiter(redis: Redis | null, { windowMs, maxRequests, prefix = 'rl' }: any) {
  if (!redis) return null;

  return {
    /**
     * Check if a key is rate-limited.
     */
    async check(key: string) {
      const redisKey = `${prefix}:${key}`;
      try {
        const pipeline = redis.pipeline();
        pipeline.incr(redisKey);
        pipeline.pttl(redisKey);
        const results = await pipeline.exec();
        const count = results![0]![1] as number;
        let ttl = results![1]![1] as number;

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

function createRedisPresenceStore(redis: Redis | null) {
  if (!redis) return null;

  const PRESENCE_TTL = 120; // seconds — auto-expire if not refreshed

  return {
    async setOnline(festivalId: any, userId: any, username: any, socketId: any) {
      const key = `presence:${festivalId}`;
      const value = JSON.stringify({ userId, username, socketId });
      await redis.hset(key, socketId, value);
      await redis.expire(key, PRESENCE_TTL);
    },

    async setOffline(festivalId: any, socketId: any) {
      const key = `presence:${festivalId}`;
      await redis.hdel(key, socketId);
    },

    async getOnline(festivalId: any) {
      const key = `presence:${festivalId}`;
      const entries = await redis.hgetall(key);
      const users = new Map();
      for (const [, val] of Object.entries(entries)) {
        try {
          const { userId, username, socketId } = JSON.parse(val);
          if (!users.has(userId)) {
            users.set(userId, { userId, username, socketId });
          }
        } catch {
          /* skip corrupt entries */
        }
      }
      return [...users.values()];
    },

    async removeBySocketId(socketId: any, festivalIds: any[]) {
      const pipeline = redis.pipeline();
      for (const fid of festivalIds) {
        pipeline.hdel(`presence:${fid}`, socketId);
      }
      await pipeline.exec();
    },

    async refresh(festivalId: any) {
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
function createCacheInvalidationBus(redis: Redis | null, { log, onInvalidateUsers, onInvalidateFestivals }: any) {
  if (!redis) return null;

  const CHANNEL_USERS = 'cache:invalidate:users';
  const CHANNEL_FESTIVALS = 'cache:invalidate:festivals';

  // Need a dedicated subscriber connection (ioredis in subscribe mode can't do commands)
  // Must use maxRetriesPerRequest: null so ioredis retries via retryStrategy
  // instead of throwing MaxRetriesPerRequestError (unhandled rejection → crash).
  const sub = redis.duplicate({ maxRetriesPerRequest: null });
  sub.on('error', (err: any) => {
    // Same rule as the primary client: reconnect churn is warn, not error.
    const level = isTransientRedisError(err) ? 'warn' : 'error';
    log[level]('cache-bus subscriber error', { error: err.message, code: err.code });
  });

  sub.subscribe(CHANNEL_USERS, CHANNEL_FESTIVALS, (err: any) => {
    if (err) {
      log.error('cache-bus subscribe failed', { error: err.message });
    } else {
      log.info('cache-bus subscribed', { channels: [CHANNEL_USERS, CHANNEL_FESTIVALS] });
    }
  });

  sub.on('message', (channel: string, _message: string) => {
    if (channel === CHANNEL_USERS && typeof onInvalidateUsers === 'function') {
      onInvalidateUsers();
    } else if (channel === CHANNEL_FESTIVALS && typeof onInvalidateFestivals === 'function') {
      onInvalidateFestivals();
    }
  });

  return {
    publishUserInvalidation() {
      redis
        .publish(CHANNEL_USERS, String(Date.now()))
        .catch((err) => log.warn('cache-bus invalidation publish failed', { error: err.message }));
    },
    publishFestivalInvalidation() {
      redis
        .publish(CHANNEL_FESTIVALS, String(Date.now()))
        .catch((err) => log.warn('cache-bus invalidation publish failed', { error: err.message }));
    },
    async close() {
      try {
        await sub.unsubscribe();
      } catch {
        /* ignore */
      }
      try {
        sub.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

/**
 * Wraps a Redis client with a circuit breaker that fails open after consecutive errors.
 * When the circuit is open, all operations silently return null/defaults instead of
 * hitting Redis, preventing cascade failures when Redis is down.
 */
function createRedisCircuitBreaker(redis: Redis | null, { maxFailures = 3, resetTimeMs = 30000, log }: any = {}) {
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

  function recordFailure(_err: any) {
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
   */
  async function exec(fn: () => Promise<any>, fallback: any = null) {
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

// ─── Generic Rate Check (Redis-backed, per-call max) ─────────────────────────

/**
 * Atomic rate limit check using Redis INCR + PEXPIRE.
 * Unlike createRedisRateLimiter (fixed max), this accepts max per-call —
 * needed for scoped route limits where each scope has a different cap.
 */
async function redisRateCheck(redis: Redis | null, key: string, max: number, windowMs: number) {
  if (!redis) return { limited: false, count: 0, remaining: max, resetMs: windowMs, fallback: true };
  try {
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.pttl(key);
    const results = await pipeline.exec();
    const count = results![0]![1] as number;
    let ttl = results![1]![1] as number;
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

export {
  createRedisClient,
  duplicateClient,
  createRedisRateLimiter,
  createRedisPresenceStore,
  createCacheInvalidationBus,
  createRedisCircuitBreaker,
  redisRateCheck,
  // Exported for tests — pure connection-tuning helpers, no Redis required.
  redisRetryDelay,
  shouldReconnectOnError,
  isTransientRedisError,
  COMMAND_TIMEOUT_MS,
  REDIS_ENABLED,
  REDIS_PREFIX,
};
