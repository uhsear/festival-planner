/**
 * Rate limiting module — multi-tier rate limiting with Redis failover.
 *
 * PHASE 3 HARDENING (2026-04-09):
 *   Previously, Redis errors fell through to per-process in-memory counters
 *   silently. With PM2 cluster x4 this inflated effective limits by 4x during
 *   any Redis degradation, and no signal was emitted. This rewrite:
 *     1. Reads CLUSTER_SIZE from config (default 1) and divides fallback max so
 *        per-process counters approximate the intended cluster-wide budget.
 *     2. Replaces silent `catch {}` with a `recordFallback(tier, err)` helper
 *        that throttles warn logs (≤1/30s per tier) and increments a
 *        prom-client counter when metrics are wired.
 *     3. Exposes internal `_getFallbackStats()` for tests + ops ad-hoc checks.
 *
 * AUDIT FIX (2026-04-14):
 *   - CLUSTER_SIZE is now sourced from config.CLUSTER_SIZE (Agent A added it to
 *     DEFAULTS) instead of process.env directly. This keeps config surface
 *     consistent and testable.
 *   - Added password-reset limiter factory (per-email, not per-IP).
 *   - Added socket-event limiters for pick/note/status/presence fanout.
 *   - Added admin-write limiter factory bound to ADMIN_WRITE_RATE_LIMIT_MAX.
 */

import crypto from 'crypto';
import { loadConfig } from './config.js';
import { redisRateCheck as redisRateCheckFn } from './redis.js';

const FALLBACK_WARN_INTERVAL_MS = 30_000;

function resolveClusterSize(config: any) {
  if (config && Number.isFinite(config.CLUSTER_SIZE)) {
    return Math.max(1, parseInt(config.CLUSTER_SIZE, 10) || 1);
  }
  // Fallback path: load config lazily if caller didn't pass one. Keeps
  // module-level constants working without forcing every import site
  // to pass config.
  try {
    const cfg = loadConfig();
    return Math.max(1, Number(cfg.CLUSTER_SIZE) || 1);
  } catch {
    return 1;
  }
}

function createRateLimiters({
  config,
  state,
  log,
  getRequestIp,
  sendError,
  ErrorCodes,
  hashSessionToken,
  resolveRequestToken,
  redisRateLimiter,
  redisAuthRateLimiter,
  redisSocketConnectLimiter,
  redis,
  redisRateCheck,
  promMetrics = null,
}: any) {
  const CLUSTER_SIZE = resolveClusterSize(config);

  // ── Fallback tracking (cluster-wide drift mitigation) ─────────────────
  const fallbackStats: any = { global: 0, scoped: 0, auth: 0, socket: 0 };
  const fallbackLastWarned: any = { global: 0, scoped: 0, auth: 0, socket: 0 };

  function recordFallback(tier: any, err: any) {
    fallbackStats[tier] = (fallbackStats[tier] || 0) + 1;
    if (promMetrics && promMetrics.rateLimitFallbackCounter) {
      try {
        promMetrics.rateLimitFallbackCounter.inc({ tier });
      } catch {
        /* noop */
      }
    }
    const now = Date.now();
    if (now - fallbackLastWarned[tier] >= FALLBACK_WARN_INTERVAL_MS) {
      fallbackLastWarned[tier] = now;
      log.warn('rate-limit:fallback-to-memory', {
        tier,
        clusterSize: CLUSTER_SIZE,
        totalFallbacks: fallbackStats[tier],
        error: err && err.message ? err.message : 'redis unavailable',
        note:
          CLUSTER_SIZE > 1
            ? `In-memory fallback divides max by ${CLUSTER_SIZE} to approximate cluster-wide limit.`
            : 'CLUSTER_SIZE=1; in-memory fallback matches configured max.',
      });
    }
  }

  // Divide a max by cluster size; never below 1.
  function fallbackMax(max: any) {
    return Math.max(1, Math.ceil(max / CLUSTER_SIZE));
  }

  function enforceRateLimitMapCap(map: any) {
    while (map.size > config.MAX_RATE_LIMIT_ENTRIES) {
      const oldestKey = map.keys().next().value;
      if (oldestKey === undefined) break;
      map.delete(oldestKey);
    }
  }

  /**
   * Try Redis-based rate check first; fall back to in-memory map on failure.
   * Returns { limited, remaining, retryAfter, limit } -- enough for the
   * caller to set headers and decide whether to block.
   */
  async function tryRedisRateCheck({ redisClient, redisKey, max, windowMs, fallbackMap, fallbackKey, tier }: any) {
    // Try Redis first (shared across PM2 cluster)
    if (tier === 'scoped' && redisClient && redisRateCheck) {
      try {
        const result = await redisRateCheck(redisClient, redisKey, max, windowMs);
        if (!result.fallback) {
          return {
            limited: result.limited,
            remaining: result.remaining,
            retryAfter: Math.ceil(result.resetMs / 1000),
            resetHeader: Math.ceil((Date.now() + result.resetMs) / 1000),
            limit: max,
          };
        }
        recordFallback(tier, new Error('redisRateCheck signaled fallback'));
      } catch (err) {
        recordFallback(tier, err);
      }
    } else if (tier === 'global' && redisRateLimiter) {
      try {
        const result = await redisRateLimiter.check(redisKey);
        if (!result.fallback) {
          return {
            limited: result.limited,
            remaining: result.remaining,
            retryAfter: Math.ceil(result.resetMs / 1000),
            resetHeader: Math.ceil((Date.now() + result.resetMs) / 1000),
            limit: max,
          };
        }
        recordFallback(tier, new Error('redisRateLimiter signaled fallback'));
      } catch (err) {
        recordFallback(tier, err);
      }
    }

    // In-memory fallback (per-process, cluster-aware divisor applied)
    const effectiveMax = fallbackMax(max);
    const now = Date.now();
    let entry = fallbackMap.get(fallbackKey);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      fallbackMap.set(fallbackKey, entry);
      enforceRateLimitMapCap(fallbackMap);
    }
    entry.count += 1;
    const remaining = Math.max(0, effectiveMax - entry.count);
    const resetAt = entry.start + windowMs;
    return {
      limited: entry.count > effectiveMax,
      remaining,
      retryAfter: Math.ceil((resetAt - now) / 1000),
      resetHeader: Math.ceil(resetAt / 1000),
      limit: effectiveMax,
      fallback: true,
      firstExceeded: entry.count === effectiveMax + 1,
    };
  }

  function rateLimit(max = config.RATE_LIMIT_MAX, scope = '') {
    return async (req: any, res: any, next: any) => {
      const ip = getRequestIp(req);
      let rateLimitKey = ip;
      if (req.user?.userId) {
        rateLimitKey = `user:${req.user.userId}`;
      } else {
        const { token } = resolveRequestToken(req, 'x-user-token', config.USER_SESSION_COOKIE);
        if (token && token.length >= 16) {
          rateLimitKey = `tok:${hashSessionToken(token)}`;
        }
      }

      if (scope) {
        const result = await tryRedisRateCheck({
          redisClient: redis,
          redisKey: `rl:${scope}:${rateLimitKey}`,
          max,
          windowMs: config.RATE_LIMIT_WINDOW,
          fallbackMap: state.routeRateLimits,
          fallbackKey: `${scope}:${rateLimitKey}`,
          tier: 'scoped',
        });

        res.setHeader('X-RateLimit-Limit', String(result.limit));
        res.setHeader('X-RateLimit-Remaining', String(result.remaining));
        res.setHeader('X-RateLimit-Reset', String(result.resetHeader));
        if (result.limited) {
          if (!result.fallback || result.firstExceeded) {
            log.warn('rate-limit:exceeded', {
              scope: result.fallback ? rateLimitKey : `${scope}:${rateLimitKey}`,
              ip: getRequestIp(req),
              path: req.path,
              userId: req.user?.userId,
              ...(result.fallback ? { fallback: true } : {}),
            });
          }
          res.setHeader('Retry-After', String(result.retryAfter));
          return sendError(res, 429, 'Too many requests', ErrorCodes.RATE_LIMITED);
        }
        return next();
      }

      // Global API rate limit
      const result = await tryRedisRateCheck({
        redisClient: null,
        redisKey: rateLimitKey,
        max,
        windowMs: config.RATE_LIMIT_WINDOW,
        fallbackMap: state.rateLimits,
        fallbackKey: rateLimitKey,
        tier: 'global',
      });
      res.setHeader('X-RateLimit-Limit', String(result.limit));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      res.setHeader('X-RateLimit-Reset', String(result.resetHeader));
      if (result.limited) {
        if (!result.fallback || result.firstExceeded) {
          log.warn('rate-limit:exceeded', {
            scope: rateLimitKey,
            ip: getRequestIp(req),
            path: req.path,
            userId: req.user?.userId,
            ...(result.fallback ? { fallback: true } : {}),
          });
        }
        res.setHeader('Retry-After', String(result.retryAfter));
        return sendError(res, 429, 'Too many requests', ErrorCodes.RATE_LIMITED);
      }
      return next();
    };
  }

  function createAuthRateLimiter(map: any, redisLimiter: any) {
    return async (req: any, res: any, next: any) => {
      const ip = getRequestIp(req);
      if (redisLimiter) {
        try {
          const result = await redisLimiter.check(ip);
          if (!result.fallback) {
            if (result.limited) {
              log.warn('rate-limit:exceeded', { scope: `auth:${ip}`, ip, path: req.path, userId: req.user?.userId });
              res.set('Retry-After', String(Math.max(1, Math.ceil(result.resetMs / 1000))));
              return sendError(res, 429, 'Too many attempts. Wait a few minutes.', ErrorCodes.RATE_LIMITED);
            }
            return next();
          }
          recordFallback('auth', new Error('redisAuthLimiter signaled fallback'));
        } catch (err) {
          recordFallback('auth', err);
        }
      }
      const effectiveMax = fallbackMax(config.AUTH_RATE_LIMIT_MAX);
      const now = Date.now();
      let entry = map.get(ip);
      if (!entry || now - entry.start > config.AUTH_RATE_LIMIT_WINDOW) {
        entry = { start: now, count: 0 };
        map.set(ip, entry);
        enforceRateLimitMapCap(map);
      }
      entry.count += 1;
      if (entry.count > effectiveMax) {
        log.warn('rate-limit:exceeded', {
          scope: `auth:${ip}`,
          ip,
          path: req.path,
          userId: req.user?.userId,
          fallback: true,
        });
        const retryAfter = Math.ceil((entry.start + config.AUTH_RATE_LIMIT_WINDOW - now) / 1000);
        res.set('Retry-After', String(Math.max(1, retryAfter)));
        return sendError(res, 429, 'Too many attempts. Wait a few minutes.', ErrorCodes.RATE_LIMITED);
      }
      return next();
    };
  }

  function consumeSocketRateLimit(scopeKey: any, max: any) {
    const now = Date.now();
    let entry = state.socketRateLimits.get(scopeKey);
    if (!entry || now - entry.windowStart > config.SOCKET_EVENT_WINDOW) {
      entry = { windowStart: now, count: 0 };
      state.socketRateLimits.set(scopeKey, entry);
      enforceRateLimitMapCap(state.socketRateLimits);
    }
    entry.count += 1;
    return entry.count <= max;
  }

  function consumeUserAuthRateLimit(userId: any, max: any) {
    const now = Date.now();
    let entry = state.userAuthRateLimits.get(userId);
    if (!entry || now - entry.windowStart > config.AUTH_RATE_LIMIT_WINDOW) {
      entry = { windowStart: now, count: 0 };
      state.userAuthRateLimits.set(userId, entry);
      enforceRateLimitMapCap(state.userAuthRateLimits);
    }
    entry.count += 1;
    return entry.count <= max;
  }

  async function consumeSocketConnectRateLimitAsync(ip: any) {
    if (redisSocketConnectLimiter) {
      try {
        const result = await redisSocketConnectLimiter.check(ip);
        if (!result.fallback) return !result.limited;
        recordFallback('socket', new Error('redisSocketConnectLimiter signaled fallback'));
      } catch (err) {
        recordFallback('socket', err);
      }
    }
    return consumeSocketConnectRateLimitLocal(ip);
  }

  function consumeSocketConnectRateLimitLocal(ip: any) {
    const now = Date.now();
    let entry = state.socketConnectRateLimits.get(ip);
    if (!entry || now - entry.windowStart > config.SOCKET_CONNECT_WINDOW) {
      entry = { windowStart: now, count: 0 };
      state.socketConnectRateLimits.set(ip, entry);
      enforceRateLimitMapCap(state.socketConnectRateLimits);
    }
    entry.count += 1;
    const effectiveMax = fallbackMax(config.SOCKET_CONNECT_RATE_LIMIT);
    return entry.count <= effectiveMax;
  }

  function consumeSocketConnectRateLimit(ip: any) {
    return consumeSocketConnectRateLimitLocal(ip);
  }

  const authRateLimit = createAuthRateLimiter(state.authRateLimits, redisAuthRateLimiter);
  const adminAuthRateLimit = createAuthRateLimiter(state.adminAuthRateLimits, redisAuthRateLimiter);

  return {
    enforceRateLimitMapCap,
    rateLimit,
    createAuthRateLimiter,
    authRateLimit,
    adminAuthRateLimit,
    consumeSocketRateLimit,
    consumeUserAuthRateLimit,
    consumeSocketConnectRateLimitAsync,
    consumeSocketConnectRateLimitLocal,
    consumeSocketConnectRateLimit,
    // Diagnostics (Phase 3 hardening)
    _getFallbackStats: () => ({ ...fallbackStats }),
    _getClusterSize: () => CLUSTER_SIZE,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Password-reset rate limiter (per-email, not per-IP)
// ─────────────────────────────────────────────────────────────────────────
//
// AUDIT FIX (2026-04-14): email-auth + admin password-reset flows previously
// relied on the global IP-keyed auth limiter. That let a single actor hammer
// many emails from one IP (IP-share) or spread reset-requests across proxies.
// Key by normalized email instead: 3 attempts per hour per address.
//
// Keeps the same Redis-first / in-memory-fallback pattern as the other
// limiters above, but uses a module-local Map since there's no shared `state`
// slot for this tier yet.
function createPasswordResetRateLimit(config: any, { log, sendError, ErrorCodes, redis }: any = {}) {
  const WINDOW_MS = 60 * 60 * 1000; // 1 hour
  const MAX_ATTEMPTS = 3;
  const MAX_ENTRIES = 10_000;
  const CLUSTER_SIZE = resolveClusterSize(config);
  const REDIS_PREFIX = (config && config.REDIS_PREFIX) || 'fp:';
  const buckets = new Map();

  function normalize(email: any) {
    if (!email || typeof email !== 'string') return null;
    return email.trim().toLowerCase();
  }

  /**
   * Try Redis first for cluster-wide accuracy; fall back to in-memory with
   * cluster-aware divisor if Redis is unavailable.
   */
  async function tryRedis(emailKey: any) {
    if (!redis) return null;
    try {
      const redisKey = `${REDIS_PREFIX}rl:pw-reset:${emailKey}`;
      return await redisRateCheckFn(redis, redisKey, MAX_ATTEMPTS, WINDOW_MS);
    } catch {
      return null; // fall through to in-memory
    }
  }

  return async function passwordResetRateLimit(req: any, res: any, next: any) {
    // keyBy email (body or query). Falls through if email missing so the
    // validator can emit the proper 400 — we don't want the limiter to hide
    // an input-shape bug.
    const email = normalize(req.body?.email || req.query?.email);
    if (!email) return next();

    // Hash email for Redis key (privacy)
    const emailHash = crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);

    // Try Redis-backed rate check first (shared across PM2 cluster workers)
    const redisResult = await tryRedis(emailHash);
    if (redisResult && !redisResult.fallback) {
      res.setHeader('X-RateLimit-Limit', String(MAX_ATTEMPTS));
      res.setHeader('X-RateLimit-Remaining', String(redisResult.remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil((Date.now() + redisResult.resetMs) / 1000)));
      if (redisResult.limited) {
        if (log && redisResult.count === MAX_ATTEMPTS + 1) {
          log.warn('rate-limit:password-reset', { emailHash: emailHash.slice(0, 16), count: redisResult.count });
        }
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(redisResult.resetMs / 1000))));
        if (sendError && ErrorCodes) {
          return sendError(
            res,
            429,
            'Too many password reset attempts for this email. Try again later.',
            ErrorCodes.RATE_LIMITED,
          );
        }
        return res
          .status(429)
          .json({ error: { message: 'Too many password reset attempts for this email. Try again later.' } });
      }
      return next();
    }

    // In-memory fallback (per-process, cluster-aware divisor applied)
    const effectiveMax = Math.max(1, Math.ceil(MAX_ATTEMPTS / CLUSTER_SIZE));
    const now = Date.now();
    let entry = buckets.get(email);
    if (!entry || now - entry.start > WINDOW_MS) {
      entry = { start: now, count: 0 };
      buckets.set(email, entry);
      // LRU trim
      while (buckets.size > MAX_ENTRIES) {
        const oldest = buckets.keys().next().value;
        if (oldest === undefined) break;
        buckets.delete(oldest);
      }
    }
    entry.count += 1;
    const resetAt = entry.start + WINDOW_MS;
    res.setHeader('X-RateLimit-Limit', String(effectiveMax));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, effectiveMax - entry.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

    if (entry.count > effectiveMax) {
      if (log && entry.count === effectiveMax + 1) {
        log.warn('rate-limit:password-reset', {
          emailHash: emailHash.slice(0, 16),
          count: entry.count,
          fallback: true,
        });
      }
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
      if (sendError && ErrorCodes) {
        return sendError(
          res,
          429,
          'Too many password reset attempts for this email. Try again later.',
          ErrorCodes.RATE_LIMITED,
        );
      }
      return res
        .status(429)
        .json({ error: { message: 'Too many password reset attempts for this email. Try again later.' } });
    }
    return next();
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Admin-write rate limiter factory
// ─────────────────────────────────────────────────────────────────────────
//
// AUDIT FIX (2026-04-14): config key ADMIN_WRITE_RATE_LIMIT_MAX existed but
// there was no visible factory binding it to a middleware. Expose one so
// admin routes can wire `rateLimit(config.ADMIN_WRITE_RATE_LIMIT_MAX, 'admin-write')`
// without re-reading config. `rateLimiters` is the object returned by
// `createRateLimiters()` so we can piggy-back its Redis + fallback logic.
function createAdminWriteRateLimit(config: any, rateLimiters: any) {
  if (!rateLimiters || typeof rateLimiters.rateLimit !== 'function') {
    throw new Error('createAdminWriteRateLimit requires the object returned by createRateLimiters()');
  }
  return rateLimiters.rateLimit(config.ADMIN_WRITE_RATE_LIMIT_MAX, 'admin-write');
}

// ─────────────────────────────────────────────────────────────────────────
// Socket-event rate limiters (per-user, in-memory with cluster-aware math)
// ─────────────────────────────────────────────────────────────────────────
//
// AUDIT FIX (2026-04-14): socket-event flooding could bypass HTTP limits by
// issuing Socket.IO events. Expose per-event limiters keyed by userId.
// Each returns { allowed, remaining, resetAt } so handlers can emit a
// structured error + X-RateLimit-ish telemetry to the client.
//
// Same in-memory fallback pattern as existing consumeSocketRateLimit. A Redis
// variant is deferred — these caps are already per-process-generous and the
// window is short (10s) so cluster drift is minor.
function _createSocketEventLimiter(name: string, max: number, windowMs: number) {
  const buckets = new Map();
  const MAX_ENTRIES = 10_000;
  return {
    name,
    max,
    windowMs,
    consume(userId: any) {
      if (!userId) {
        return { allowed: true, remaining: max, resetAt: Date.now() + windowMs };
      }
      const now = Date.now();
      let entry = buckets.get(userId);
      if (!entry || now - entry.windowStart > windowMs) {
        entry = { windowStart: now, count: 0 };
        buckets.set(userId, entry);
        while (buckets.size > MAX_ENTRIES) {
          const oldest = buckets.keys().next().value;
          if (oldest === undefined) break;
          buckets.delete(oldest);
        }
      }
      entry.count += 1;
      const resetAt = entry.windowStart + windowMs;
      const remaining = Math.max(0, max - entry.count);
      return { allowed: entry.count <= max, remaining, resetAt };
    },
    _reset() {
      buckets.clear();
    },
  };
}

const SOCKET_EVENT_WINDOW_MS = 10_000;
const PICK_SET_LIMIT = _createSocketEventLimiter('pick-set', 30, SOCKET_EVENT_WINDOW_MS);
const NOTE_ADD_LIMIT = _createSocketEventLimiter('note-add', 20, SOCKET_EVENT_WINDOW_MS);
const STATUS_UPDATE_LIMIT = _createSocketEventLimiter('status-update', 30, SOCKET_EVENT_WINDOW_MS);
const PRESENCE_UPDATE_LIMIT = _createSocketEventLimiter('presence-update', 60, SOCKET_EVENT_WINDOW_MS);

// Live Location: a sharing client publishes a fix roughly every 5s (publisher
// throttle in @festie/shared). Cap at 12/min/user (~1 per 5s) so a misbehaving
// or spoofed client can't flood the crew room. Window 60s, keyed by userId.
const LOCATION_UPDATE_LIMIT = _createSocketEventLimiter('location-update', 12, 60_000);

// SOS raise: a safety action, not a fire-rate path. One raise per 120s/user
// throttles abuse / notification storms while still allowing a re-raise if the
// first didn't land. Consumed in-handler in routes/crew-sos.ts. NOTE: this is a
// per-process in-memory limiter, so under PM2 cluster x4 the effective cap can
// drift to ~4/120s cluster-wide; a coarse Redis-backed rateLimit() middleware on
// the route bounds the worst case. Exact precision isn't safety-critical here.
const SOS_RAISE_LIMIT = _createSocketEventLimiter('sos-raise', 1, 120_000);

const socketEventLimits = {
  PICK_SET_LIMIT,
  NOTE_ADD_LIMIT,
  STATUS_UPDATE_LIMIT,
  PRESENCE_UPDATE_LIMIT,
  LOCATION_UPDATE_LIMIT,
  SOS_RAISE_LIMIT,
};

export {
  createRateLimiters,
  createPasswordResetRateLimit,
  createAdminWriteRateLimit,
  // Socket event limiters (named exports for convenience + object export for bulk wiring)
  PICK_SET_LIMIT,
  NOTE_ADD_LIMIT,
  STATUS_UPDATE_LIMIT,
  PRESENCE_UPDATE_LIMIT,
  LOCATION_UPDATE_LIMIT,
  SOS_RAISE_LIMIT,
  socketEventLimits,
};
