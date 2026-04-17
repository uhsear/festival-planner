'use strict';
/**
 * App context composer — the `createAppContext(overrides)` entry point.
 *
 * Historical arc:
 *   - pre-sprint-4: single ~900-line `lib/app-context.js`
 *   - sprint-4: CSP helpers carved out to `./csp`
 *   - sprint-6: avatar, request-helpers (IP/origin/CSRF), and cookie
 *     helpers carved out to `./avatar`, `./request-helpers`, `./cookies`
 *
 * The three sprint-6 cuts were chosen because each module's functions
 * close over ONLY `config` (plus, for avatar, `sendError`/`ErrorCodes`
 * which we were already importing). They do not touch `state`, `_io`,
 * the cache-version counters, or any socket-presence closure, so the
 * extraction is byte-identical and surgical.
 *
 * The context object returned here is the dependency-injection surface
 * for every route module and middleware. Do NOT add or rename keys on
 * it without auditing `routes/*`, `lib/middleware.js`, and
 * `lib/socket-setup.js`.
 */
const crypto = require('crypto');

const express = require('express');

const { createStores, openPlannerDatabase, createDbLatencyTracker } = require('../planner-db-pg');
const { loadConfig } = require('../config');
const { createRedisClient, _duplicateClient, createRedisRateLimiter, createRedisPresenceStore, createCacheInvalidationBus, createRedisCircuitBreaker, redisRateCheck } = require('../redis');
const { ErrorCodes, sendSuccess, sendError } = require('../response');
const { generateOpenAPISpec } = require('../openapi');
const {
  schemas, validate,
  normalizePickPayload: _normalizePickPayload,
  normalizeNotePayload: _normalizeNotePayload,
  normalizeReminderPayload: _normalizeReminderPayload,
  sanitizeFestivalPayload: _sanitizeFestivalPayload,
} = require('../schemas');
const {
  ALLOWED_PICK_PRIORITIES,
  ALLOWED_REMINDER_MINUTES,
  ALLOWED_AVATAR_MIME_TYPES,
} = require('../constants');
const {
  // eslint-disable-next-line no-unused-vars
  safeDataFilename,
  // eslint-disable-next-line no-unused-vars
  stripBom,
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
  // eslint-disable-next-line no-unused-vars
  getAvatarColor,
  // eslint-disable-next-line no-unused-vars
  getInitials,
  formatTime,
  // eslint-disable-next-line no-unused-vars
  formatExportTimestamp,
  // eslint-disable-next-line no-unused-vars
  timeToMinutes,
  // eslint-disable-next-line no-unused-vars
  buildSetDateStamp,
  // eslint-disable-next-line no-unused-vars
  getSetTiming,
  // eslint-disable-next-line no-unused-vars
  buildFestivalSetList,
  // eslint-disable-next-line no-unused-vars
  pickTimedFestivalSet,
  // eslint-disable-next-line no-unused-vars
  getExportPickLabel,
  // eslint-disable-next-line no-unused-vars
  getExportPickChipClass,
  // eslint-disable-next-line no-unused-vars
  formatSetRangeLabel,
  // eslint-disable-next-line no-unused-vars
  formatSetLocationLabel,
  // eslint-disable-next-line no-unused-vars
  getExportCurrentOrNextPickedSet,
  // eslint-disable-next-line no-unused-vars
  getExportReminderItems,
  // eslint-disable-next-line no-unused-vars
  formatCrewOverlapLabel,
  // eslint-disable-next-line no-unused-vars
  getExportNextCrewOverlap,
  buildAvatarUrl,
  serializePublicUser,
  escapeHtml,
  serializeOwnProfile,
  serializeProfileForViewer,
  buildExportHtml,
  serializeExportCrewProfile,
  createAuditLog,
  getLogSafeRequestInfo,
} = require('../helpers');
const { createLogger } = require('../logger');
const { SCRYPT_KEYLEN, hashSessionToken, DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH, timingSafeEqualString, hashPassword, verifyPassword, setLogger: setCryptoLogger } = require('../crypto-auth');
const { _renderResetFormPage, _renderResetErrorPage } = require('../reset-pages');
const { _createTracingMiddleware, _propagateTraceId } = require('../tracing');

const { buildCspPolicies, buildContentSecurityPolicy, collectInlineHashes } = require('./csp');
const { createAvatarHelpers } = require('./avatar');
const {
  createRequestHelpers,
  MUTATING_METHODS,
  TRUSTED_MUTATION_HEADER,
  TRUSTED_MUTATION_VALUE,
} = require('./request-helpers');
const { createCookieHelpers } = require('./cookies');

const log = createLogger();
setCryptoLogger(log.child({ module: 'crypto-auth' }));

const DANGEROUS_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Create the full application context — config, databases, caches, utility functions.
 * @param {object} overrides - Config overrides (used by tests)
 * @returns {object} Context object with all shared state and functions
 */
function createAppContext(overrides = {}) {
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
  const { pool } = openPlannerDatabase({ databaseUrl: config.DATABASE_URL, log, poolSize: config.DB_POOL_SIZE });
  const rawStores = createStores(pool, { nodeEnv: config.NODE_ENV });
  const dbLatencyTracker = createDbLatencyTracker(log);

  const stores = {
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

  const { createRateLimiters } = require('../rate-limiting');

  // ── Cache invalidation bus ────────────────────────────────────────────
  let _userDataVersion = 0;
  let _festivalDataVersion = 0;

  const cacheBus = redis ? createCacheInvalidationBus(redis, {
    log,
    onInvalidateUsers() {
      _userDataVersion += 1;
      log.debug('cache-bus: user cache invalidated by peer worker');
    },
    onInvalidateFestivals() {
      _festivalDataVersion += 1;
      _festivalMapCache = null;
      log.debug('cache-bus: festival cache invalidated by peer worker');
    },
  }) : null;

  // ── CSP ───────────────────────────────────────────────────────────────
  // Delegated to ./csp — keeps inline-hash collection + policy builders
  // co-located (they share the same source-of-truth map).
  const { contentSecurityPolicy, exportContentSecurityPolicy } = buildCspPolicies(config);

  // ── State ─────────────────────────────────────────────────────────────
  const state = {
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
    timers: [],
    stores,
    metrics: {
      totalRequests: 0,
      totalErrors: 0,
      totalDuration: 0,
      requestCount: 0,
      statusCodes: {},
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
    for (const [token, data] of Array.from(state._adminResetTokens.entries())) {
      if (now > data.expiresAt) state._adminResetTokens.delete(token);
    }
  }, 60_000);
  _rateLimitCleanupTimer.unref();
  state.timers.push(_rateLimitCleanupTimer);

  // ── IO injection point ────────────────────────────────────────────────
  // Socket.IO is created after app-context. Functions that need io get it lazily.
  let _io = null;
  function setIO(io) { _io = io; }

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
  function runUserTask(userId, task) {
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

  // ── User cache ────────────────────────────────────────────────────────
  let _userMapCache = null;
  let _userMapCacheVersion = 0;
  let _userMapCacheAt = 0;
  const CACHE_TTL_MS = 60_000;

  async function getUserMap() {
    if (_userMapCache && (Date.now() - _userMapCacheAt > CACHE_TTL_MS)) {
      _userDataVersion += 1;
    }
    if (_userMapCache && _userMapCacheVersion === _userDataVersion) return _userMapCache;
    const users = await getUsers();
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    _userMapCache = new Map(users.map((user) => [user.id, user]));
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    _userMapCacheVersion = _userDataVersion;
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    _userMapCacheAt = Date.now();
    return _userMapCache;
  }

  async function getUserById(userId) {
    const userMap = await getUserMap();
    return userMap.get(userId) || null;
  }

  function invalidateUserCache() {
    _userDataVersion += 1;
    if (cacheBus) cacheBus.publishUserInvalidation();
  }

  // ── Festival cache ────────────────────────────────────────────────────
  let _festivalMapCache = null;
  let _festivalMapCacheVersion = 0;
  let _festivalMapCacheAt = 0;

  async function getFestivalMap() {
    if (_festivalMapCache && (Date.now() - _festivalMapCacheAt > CACHE_TTL_MS)) {
      _festivalDataVersion += 1;
      _festivalMapCache = null;
    }
    if (_festivalMapCache && _festivalMapCacheVersion === _festivalDataVersion) return _festivalMapCache;
    const festivals = await getFestivals();
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    _festivalMapCache = new Map(festivals.map((festival) => [festival.id, festival]));
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    _festivalMapCacheVersion = _festivalDataVersion;
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    _festivalMapCacheAt = Date.now();
    return _festivalMapCache;
  }

  async function getFestivalById(id) {
    const festivalMap = await getFestivalMap();
    return festivalMap.get(id) || null;
  }

  function invalidateFestivalCache() {
    _festivalDataVersion += 1;
    _festivalMapCache = null;
    if (cacheBus) cacheBus.publishFestivalInvalidation();
  }

  // ── Data access helpers ───────────────────────────────────────────────
  async function getFestivals() {
    return (await stores.festivals.readAll()) || [];
  }

  async function getProfiles() {
    return (await stores.profiles.readAll()) || [];
  }

  async function getUsers() {
    return (await stores.users.readAll()) || [];
  }

  async function getProfileById(id) {
    if (stores.profiles.getById) return stores.profiles.getById(id);
    const profiles = await getProfiles();
    return profiles.find((profile) => profile.id === id) || null;
  }

  async function getUserFestivalProfile(userId, festivalId) {
    if (!userId || !festivalId) return null;
    if (stores.profiles.readByUserAndFestival) {
      const row = await stores.profiles.readByUserAndFestival(userId, festivalId);
      if (!row) return null;
      return stores.profiles.getById(row.id);
    }
    const profiles = await getProfiles();
    return profiles.find((profile) => profile.userId === userId && profile.festivalId === festivalId) || null;
  }

  log.info('PostgreSQL pool initialized', { databaseUrl: config.DATABASE_URL ? config.DATABASE_URL.replace(/\/\/.*@/, '//***@') : 'not set' });

  // ── Session management ────────────────────────────────────────────────
  async function createUserSession(userId, username) {
    const token = crypto.randomBytes(32).toString('hex');
    const evictedHashes = await stores.sessions.createUserSession({
      token: hashSessionToken(token),
      userId,
      username,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      maxPerUser: config.USER_SESSION_MAX,
    });
    if (evictedHashes && evictedHashes.length > 0 && _io) {
      const hashSet = new Set(evictedHashes);
      const presenceTargets = new Set();
      for (const socket of _io.of('/').sockets.values()) {
        if (!socket.data?.userSessionToken) continue;
        if (hashSet.has(hashSessionToken(socket.data.userSessionToken))) {
          disconnectSocket(socket, _io, presenceTargets);
        }
      }
      for (const festivalId of presenceTargets) emitPresence(festivalId, _io);
    }
    return token;
  }

  async function validateUserSession(token) {
    if (typeof token !== 'string' || token.length !== 64) return null;
    return stores.sessions.validateUserSession(hashSessionToken(token), config.SESSION_TTL);
  }

  async function invalidateUserSessions(userId, exceptToken = null) {
    await stores.sessions.deleteUserSessions(userId, exceptToken ? hashSessionToken(exceptToken) : null);
    if (_io) disconnectUserSockets(userId, _io);
  }

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

  async function resolveUserRequestSession(req) {
    const { token, source } = resolveRequestToken(req, 'x-user-token', config.USER_SESSION_COOKIE);
    const session = await validateUserSession(token);
    if (!session) return null;
    return { token, source, session };
  }

  // ── Auth middleware ───────────────────────────────────────────────────
  async function adminAuth(req, res, next) {
    const resolved = await resolveUserRequestSession(req);
    if (!resolved) return sendError(res, 401, 'Please log in', ErrorCodes.AUTH_REQUIRED);
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    req.user = resolved.session;
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    req.userToken = resolved.token;
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    req.userAuthSource = resolved.source;
    const isAdmin = await stores.roles.hasRole(resolved.session.userId, 'admin');
    if (!isAdmin) return sendError(res, 403, 'Admin access required', ErrorCodes.FORBIDDEN);
    res.setHeader('Vary', 'Cookie');
    return next();
  }

  async function userAuth(req, res, next) {
    const resolved = await resolveUserRequestSession(req);
    if (!resolved) return sendError(res, 401, 'Please log in', ErrorCodes.AUTH_REQUIRED);
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    req.user = resolved.session;
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    req.userToken = resolved.token;
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    req.userAuthSource = resolved.source;
    res.setHeader('Vary', 'Cookie');
    return next();
  }

  // ── Payload normalizers ───────────────────────────────────────────────
  const normalizePickPayload = (input) => _normalizePickPayload(input, config);
  const normalizeNotePayload = (input) => _normalizeNotePayload(input, config);
  const normalizeReminderPayload = (input) => _normalizeReminderPayload(input, config);
  const sanitizeFestivalPayload = (input, existingFestival) => _sanitizeFestivalPayload(input, existingFestival, config, createOpaqueId);

  // ── Rate limiters ─────────────────────────────────────────────────────
  const rateLimiters = createRateLimiters({ config, state, log, getRequestIp, sendError, ErrorCodes, hashSessionToken, resolveRequestToken, redisRateLimiter, redisAuthRateLimiter, redisSocketConnectLimiter, redis, redisRateCheck, promMetrics: overrides.promMetrics || null });
  const { rateLimit, authRateLimit, adminAuthRateLimit, enforceRateLimitMapCap, consumeSocketRateLimit, consumeUserAuthRateLimit, consumeSocketConnectRateLimitAsync, consumeSocketConnectRateLimit } = rateLimiters;

  // ── Presence manager ──────────────────────────────────────────────────
  const presenceManager = require('../presence').createPresenceManager({
    state,
    redisPresence,
    redis,
    log,
    getUserMap,
    buildAvatarUrl,
  });

  const removeSocketPresence = presenceManager.removeSocketPresence;
  const setSocketPresence = presenceManager.setSocketPresence;
  const getPresenceList = presenceManager.getPresenceList;
  const emitPresence = presenceManager.emitPresence;
  const clearPresenceTimers = presenceManager.clearPresenceTimers;
  const emitProfileIdentity = presenceManager.emitProfileIdentity;
  const clearSocketSession = presenceManager.clearSocketSession;
  const leaveFestivalRealtime = presenceManager.leaveFestivalRealtime;
  const disconnectSocket = presenceManager.disconnectSocket;
  const disconnectUserSockets = presenceManager.disconnectUserSockets;
  const disconnectSessionTokens = presenceManager.disconnectSessionTokens;
  const removeFestivalSockets = presenceManager.removeFestivalSockets;
  const removeProfileSockets = presenceManager.removeProfileSockets;

  const _emitProfileIdentity = emitProfileIdentity;
  const emitProfileIdentityWrapped = (user, io) => _emitProfileIdentity(user, io, getProfiles);

  // ── Self-test ─────────────────────────────────────────────────────────
  try {
    const testToken = crypto.randomBytes(32).toString('hex');
    const testHash = hashSessionToken(testToken);
    if (!testHash || testHash.length !== 64) throw new Error('Crypto self-test failed');
    pool.query('SELECT 1').then(() => {
      log.info('postgresql connection verified');
    }).catch((pgErr) => {
      log.error('postgresql connection failed', { error: pgErr.message });
    });
    log.info('startup self-test passed');
  } catch (err) {
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
    schemas, validate,
    pagination: require('../pagination'),

    // Constants (re-exports)
    MUTATING_METHODS, TRUSTED_MUTATION_HEADER, TRUSTED_MUTATION_VALUE,
    DANGEROUS_RECORD_KEYS,
    ALLOWED_PICK_PRIORITIES, ALLOWED_AVATAR_MIME_TYPES,
    SCRYPT_KEYLEN, DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH,
    ALLOWED_REMINDER_MINUTES,
  };
}

module.exports = { createAppContext, buildContentSecurityPolicy, collectInlineHashes, loadConfig };
