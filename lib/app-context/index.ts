/**
 * App context composer — the `createAppContext(overrides)` entry point.
 *
 * Historical arc:
 *   - pre-sprint-4: single ~900-line `lib/app-context.js`
 *   - sprint-4: CSP helpers carved out to `./csp`
 *   - sprint-6: avatar, request-helpers (IP/origin/CSRF), and cookie
 *     helpers carved out to `./avatar`, `./request-helpers`, `./cookies`
 *   - sprint-8: cache management (version counters, user/festival caches,
 *     data-access helpers) carved out to `./cache`; session management
 *     (create/validate/invalidate + auth middleware) carved out to
 *     `./session`
 *
 * The context object returned here is the dependency-injection surface
 * for every route module and middleware. Do NOT add or rename keys on
 * it without auditing `routes/*`, `lib/middleware.js`, and
 * `lib/socket-setup.js`.
 */
import crypto from 'crypto';

import express from 'express';

import { createStores, openPlannerDatabase, createDbLatencyTracker } from '../planner-db-pg';
import { loadConfig } from '../config';
import { createRedisClient, createRedisRateLimiter, createRedisPresenceStore, createRedisCircuitBreaker, redisRateCheck } from '../redis';
import { ErrorCodes, sendSuccess, sendError } from '../response';
import { generateOpenAPISpec } from '../openapi';
import {
  schemas, validate, validateQuery, validateParams,
  normalizePickPayload as _normalizePickPayload,
  normalizeNotePayload as _normalizeNotePayload,
  normalizeReminderPayload as _normalizeReminderPayload,
  sanitizeFestivalPayload as _sanitizeFestivalPayload,
} from '../schemas';
import {
  ALLOWED_PICK_PRIORITIES,
  ALLOWED_REMINDER_MINUTES,
  ALLOWED_AVATAR_MIME_TYPES,
} from '../constants';
import {
  encodeContentDispositionFilename,
  sanitizeString,
  normalizeRecordKey,
  sanitizeIdentifier,
  parseCookies,
  validateTime,
  validateColor,
  validateUsername,
  validatePasswordStrength,
  validateFestival,
  createOpaqueId,
  createVersionToken,
  formatTime,
  buildAvatarUrl,
  serializePublicUser,
  escapeHtml,
  serializeOwnProfile,
  serializeProfileForViewer,
  buildExportHtml,
  serializeExportCrewProfile,
  createAuditLog,
  getLogSafeRequestInfo,
} from '../helpers';
import { createLogger } from '../logger';
import { SCRYPT_KEYLEN, hashSessionToken, DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH, timingSafeEqualString, hashPassword, verifyPassword, setLogger as setCryptoLogger } from '../crypto-auth';

import { buildCspPolicies, buildContentSecurityPolicy, collectInlineHashes } from './csp';
import { createAvatarHelpers } from './avatar';
import {
  createRequestHelpers,
  MUTATING_METHODS,
  TRUSTED_MUTATION_HEADER,
  TRUSTED_MUTATION_VALUE,
} from './request-helpers';
import { createCookieHelpers } from './cookies';
import { createCacheHelpers } from './cache';
import { createSessionHelpers } from './session';

const log = createLogger();
setCryptoLogger(log.child({ module: 'crypto-auth' }));

const DANGEROUS_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Create the full application context — config, databases, caches, utility functions.
 */
async function createAppContext(overrides: any = {}): Promise<any> {
  const config = loadConfig(overrides);

  log.info('startup config', {
    NODE_ENV: config.NODE_ENV,
    PORT: config.PORT,
    BIND_ADDRESS: config.BIND_ADDRESS,
    REDIS_ENABLED: config.REDIS_ENABLED,
    SESSION_TTL: config.SESSION_TTL,
    MAX_USERS: config.MAX_USERS,
    AUTH_RATE_LIMIT_MAX: config.AUTH_RATE_LIMIT_MAX,
    AVATAR_SIZE: config.AVATAR_SIZE,
    COOKIE_SECURE: config.COOKIE_SECURE,
    ALLOWED_ORIGINS_COUNT: config.ALLOWED_ORIGINS.length,
    DATABASE_URL: config.DATABASE_URL ? config.DATABASE_URL.replace(/\/\/.*@/, '//***@') : 'not set',
  });

  // ── Database ──────────────────────────────────────────────────────────
  const { pool } = openPlannerDatabase({ databaseUrl: config.DATABASE_URL, log, poolSize: config.PG_POOL_MAX, poolMin: config.PG_POOL_MIN });
  const rawStores = createStores(pool, { nodeEnv: config.NODE_ENV });
  const dbLatencyTracker = createDbLatencyTracker(log);

  const stores: Record<string, any> = {
    ...rawStores,
    festivals: dbLatencyTracker.wrapStore('festivals', rawStores.festivals),
    profiles: dbLatencyTracker.wrapStore('profiles', rawStores.profiles),
    users: dbLatencyTracker.wrapStore('users', rawStores.users),
    sessions: dbLatencyTracker.wrapStore('sessions', rawStores.sessions),
    crews: dbLatencyTracker.wrapStore('crews', rawStores.crews),
    picks: rawStores.picks ? dbLatencyTracker.wrapStore('picks', rawStores.picks) : rawStores.picks,
    refreshTokens: rawStores.refreshTokens ? dbLatencyTracker.wrapStore('refreshTokens', rawStores.refreshTokens) : rawStores.refreshTokens,
    auditLog: rawStores.auditLog ? dbLatencyTracker.wrapStore('auditLog', rawStores.auditLog) : rawStores.auditLog,
  };

  // ── Redis ─────────────────────────────────────────────────────────────
  const redis = createRedisClient({ log, enabled: config.REDIS_ENABLED });
  const redisCircuitBreaker = createRedisCircuitBreaker(redis, { maxFailures: 3, resetTimeMs: 30000, log });
  const redisRateLimiter = redis ? createRedisRateLimiter(redis, {
    windowMs: config.RATE_LIMIT_WINDOW,
    maxRequests: config.RATE_LIMIT_MAX,
    prefix: 'api',
  }) : null;
  const redisAuthRateLimiter = redis ? createRedisRateLimiter(redis, {
    windowMs: config.AUTH_RATE_LIMIT_WINDOW,
    maxRequests: config.AUTH_RATE_LIMIT_MAX,
    prefix: 'auth',
  }) : null;
  const redisSocketConnectLimiter = redis ? createRedisRateLimiter(redis, {
    windowMs: config.SOCKET_CONNECT_WINDOW,
    maxRequests: config.SOCKET_CONNECT_RATE_LIMIT,
    prefix: 'sock-conn',
  }) : null;
  const redisPresence = redis ? createRedisPresenceStore(redis) : null;

  const { createRateLimiters } = await import('../rate-limiting.js');

  // ── Cache + data access (extracted to ./cache) ────────────────────────
  const cacheHelpers = createCacheHelpers({ stores, redis, log });
  const {
    cacheBus,
    getUserMap, getUserById, invalidateUserCache,
    getFestivalMap, getFestivalById, invalidateFestivalCache,
    getFestivals, getProfiles, getUsers,
    getProfileById, getUserFestivalProfile,
  } = cacheHelpers;

  // ── CSP ───────────────────────────────────────────────────────────────
  const { contentSecurityPolicy, exportContentSecurityPolicy } = buildCspPolicies(config);

  // ── State ─────────────────────────────────────────────────────────────
  const state: Record<string, any> = {
    userTaskQueues: new Map(),
    rateLimits: new Map(),
    routeRateLimits: new Map(),
    authRateLimits: new Map(),
    adminAuthRateLimits: new Map(),
    socketConnectRateLimits: new Map(),
    socketRateLimits: new Map(),
    userAuthRateLimits: new Map(),
    onlineUsers: new Map(),
    _adminResetTokens: new Map(),
    sseConnections: new Map(),
    timers: [] as any[],
    stores,
    metrics: {
      totalRequests: 0,
      totalErrors: 0,
      totalDuration: 0,
      requestCount: 0,
      statusCodes: {} as Record<string, any>,
      socketConnections: 0,
      socketDisconnections: 0,
      socketErrors: 0,
      peakConnections: 0,
      startedAt: new Date().toISOString(),
    },
  };

  // Periodic rate limit map cleanup
  const _rateLimitCleanupTimer = setInterval(() => {
    const now = Date.now();
    const _rateLimitMaps = [
      { map: state.rateLimits, window: config.RATE_LIMIT_WINDOW, tsField: 'start' },
      { map: state.routeRateLimits, window: config.RATE_LIMIT_WINDOW, tsField: 'start' },
      { map: state.authRateLimits, window: config.AUTH_RATE_LIMIT_WINDOW, tsField: 'start' },
      { map: state.adminAuthRateLimits, window: config.AUTH_RATE_LIMIT_WINDOW, tsField: 'start' },
      { map: state.socketConnectRateLimits, window: config.SOCKET_CONNECT_WINDOW, tsField: 'windowStart' },
      { map: state.socketRateLimits, window: config.SOCKET_EVENT_WINDOW, tsField: 'windowStart' },
      { map: state.userAuthRateLimits, window: config.AUTH_RATE_LIMIT_WINDOW, tsField: 'windowStart' },
    ];
    for (const { map, window: win, tsField } of _rateLimitMaps) {
      const cutoff = now - win * 2;
      for (const [key, entry] of map) {
        if ((entry[tsField] || 0) < cutoff) map.delete(key);
      }
    }
    for (const [token, data] of Array.from(state._adminResetTokens.entries()) as [any, any][]) {
      if (now > data.expiresAt) state._adminResetTokens.delete(token);
    }
  }, 60_000);
  _rateLimitCleanupTimer.unref();
  state.timers.push(_rateLimitCleanupTimer);

  // ── IO injection point ────────────────────────────────────────────────
  let _io: any = null;
  function setIO(io: any) { _io = io; }
  function getIO() { return _io; }

  // ── Avatar helpers (extracted to ./avatar) ────────────────────────────
  const avatarHelpers = createAvatarHelpers({ config, sendError, ErrorCodes });
  const {
    avatarPool: _avatarPool,
    avatarDirPath,
    ensureAvatarDir,
    getAvatarFilePath,
    processAvatarUpload,
    writeAvatarFile,
    removeAvatarFile,
    handleAvatarUpload,
  } = avatarHelpers;

  // ── Task queue ────────────────────────────────────────────────────────
  function runUserTask(userId: any, task: any) {
    const previous = state.userTaskQueues.get(userId) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    const chain = next.catch(() => {});
    const cleanup = chain.then(() => {
      if (state.userTaskQueues.get(userId) === cleanup) {
        state.userTaskQueues.delete(userId);
      }
    });
    state.userTaskQueues.set(userId, cleanup);
    return next;
  }

  log.info('PostgreSQL pool initialized', { databaseUrl: config.DATABASE_URL ? config.DATABASE_URL.replace(/\/\/.*@/, '//***@') : 'not set' });

  // ── Request helpers (extracted to ./request-helpers) ──────────────────
  const {
    getRequestIp,
    getRawRequestIp,
    isAllowedOrigin,
    hasBearerToken,
    hasDirectAuthHeader,
    hasSessionCookie,
    enforceAllowedOrigin,
  } = createRequestHelpers({ config, log, sendError, ErrorCodes });

  // ── Cookie/session helpers (extracted to ./cookies) ───────────────────
  const {
    setNoStore,
    setSessionCookie,
    clearSessionCookie,
    resolveRequestToken,
    resolveSocketToken,
    setUserSessionCookie,
    clearUserSessionCookie,
  } = createCookieHelpers({ config });

  // ── Payload normalizers ───────────────────────────────────────────────
  const normalizePickPayload = (input: any) => _normalizePickPayload(input, config);
  const normalizeNotePayload = (input: any) => _normalizeNotePayload(input, config);
  const normalizeReminderPayload = (input: any) => _normalizeReminderPayload(input, config);
  const sanitizeFestivalPayload = (input: any, existingFestival: any) => _sanitizeFestivalPayload(input, existingFestival, config, createOpaqueId);

  // ── Rate limiters ─────────────────────────────────────────────────────
  const rateLimiters = createRateLimiters({ config, state, log, getRequestIp, sendError, ErrorCodes, hashSessionToken, resolveRequestToken, redisRateLimiter, redisAuthRateLimiter, redisSocketConnectLimiter, redis, redisRateCheck, promMetrics: overrides.promMetrics || null });
  const { rateLimit, authRateLimit, adminAuthRateLimit, enforceRateLimitMapCap, consumeSocketRateLimit, consumeUserAuthRateLimit, consumeSocketConnectRateLimitAsync, consumeSocketConnectRateLimit } = rateLimiters;

  // ── Presence manager ──────────────────────────────────────────────────
  const { createPresenceManager } = await import('../presence.js');
  const presenceManager = createPresenceManager({
    state,
    redisPresence,
    redis,
    log,
    getUserMap,
    buildAvatarUrl,
  });

  const {
    removeSocketPresence, setSocketPresence, getPresenceList,
    emitPresence, clearPresenceTimers, emitProfileIdentity,
    clearSocketSession, leaveFestivalRealtime,
    disconnectSocket, disconnectUserSockets, disconnectSessionTokens,
    removeFestivalSockets, removeProfileSockets,
  } = presenceManager;

  const emitProfileIdentityWrapped = (user: any, io: any) => emitProfileIdentity(user, io, getProfiles);

  // ── Session / auth (extracted to ./session) ───────────────────────────
  const sessionHelpers = createSessionHelpers({
    config,
    stores,
    getIO,
    resolveRequestToken,
    disconnectSocket,
    emitPresence,
    disconnectUserSockets,
    sendError,
    ErrorCodes,
  });
  const {
    createUserSession,
    validateUserSession,
    invalidateUserSessions,
    resolveUserRequestSession,
    adminAuth,
    userAuth,
  } = sessionHelpers;

  // ── Self-test ─────────────────────────────────────────────────────────
  try {
    const testToken = crypto.randomBytes(32).toString('hex');
    const testHash = hashSessionToken(testToken);
    if (!testHash || testHash.length !== 64) throw new Error('Crypto self-test failed');
    pool.query('SELECT 1').then(() => {
      log.info('postgresql connection verified');
    }).catch((pgErr: any) => {
      log.error('postgresql connection failed', { error: pgErr.message });
    });
    log.info('startup self-test passed');
  } catch (err: any) {
    log.error('startup self-test failed', { error: err.message });
  }

  // ── Return context ────────────────────────────────────────────────────
  return {
    // Infrastructure
    express, config, state, stores, pool, log,
    redis, redisCircuitBreaker, redisPresence, redisRateLimiter,
    cacheBus, dbLatencyTracker,
    avatarPool: _avatarPool,
    setIO,

    // CSP
    contentSecurityPolicy, exportContentSecurityPolicy,
    generateOpenAPISpec,

    // Avatar
    avatarDirPath, ensureAvatarDir, getAvatarFilePath,
    processAvatarUpload, writeAvatarFile, removeAvatarFile,
    handleAvatarUpload,

    // Task queue
    runUserTask,

    // Caches / data access
    getUserMap, getUserById, invalidateUserCache,
    getFestivalMap, getFestivalById, invalidateFestivalCache,
    getFestivals, getProfiles, getUsers,
    getProfileById, getUserFestivalProfile,

    // Session / auth
    createUserSession, validateUserSession, invalidateUserSessions,
    resolveRequestToken, resolveSocketToken,
    resolveUserRequestSession, userAuth, adminAuth,
    hashSessionToken,

    // Request helpers
    getRequestIp, getRawRequestIp,
    isAllowedOrigin, enforceAllowedOrigin,
    hasBearerToken, hasDirectAuthHeader, hasSessionCookie,

    // Cookie helpers
    setNoStore, setSessionCookie, clearSessionCookie,
    setUserSessionCookie, clearUserSessionCookie,

    // Payload normalizers
    normalizePickPayload, normalizeNotePayload, normalizeReminderPayload,
    sanitizeFestivalPayload,

    // Rate limiters
    rateLimit, authRateLimit, adminAuthRateLimit, enforceRateLimitMapCap,
    consumeSocketRateLimit, consumeUserAuthRateLimit,
    consumeSocketConnectRateLimitAsync, consumeSocketConnectRateLimit,

    // Presence
    emitPresence, emitProfileIdentity: emitProfileIdentityWrapped,
    removeSocketPresence, setSocketPresence, getPresenceList,
    clearPresenceTimers, clearSocketSession, leaveFestivalRealtime,
    disconnectSocket, disconnectUserSockets, disconnectSessionTokens,
    removeFestivalSockets, removeProfileSockets,

    // Response helpers (re-exports)
    sendSuccess, sendError, ErrorCodes,

    // Helpers (re-exports for route modules)
    sanitizeString, sanitizeIdentifier, normalizeRecordKey,
    createOpaqueId, createVersionToken,
    hashPassword, verifyPassword, timingSafeEqualString,
    parseCookies,
    validateTime, validateColor, validateUsername, validatePasswordStrength, validateFestival,
    serializeOwnProfile, serializeProfileForViewer, serializePublicUser,
    buildAvatarUrl, buildExportHtml, serializeExportCrewProfile,
    escapeHtml, formatTime,
    encodeContentDispositionFilename,
    createAuditLog, getLogSafeRequestInfo,
    schemas, validate, validateQuery, validateParams,
    pagination: await import('../pagination.js'),

    // Constants (re-exports)
    MUTATING_METHODS, TRUSTED_MUTATION_HEADER, TRUSTED_MUTATION_VALUE,
    DANGEROUS_RECORD_KEYS,
    ALLOWED_PICK_PRIORITIES, ALLOWED_AVATAR_MIME_TYPES,
    SCRYPT_KEYLEN, DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH,
    ALLOWED_REMINDER_MINUTES,
  };
}

export { createAppContext, buildContentSecurityPolicy, collectInlineHashes, loadConfig };
