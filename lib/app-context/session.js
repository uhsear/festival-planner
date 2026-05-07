'use strict';
/**
 * Session management + auth middleware.
 *
 * Extracted from `lib/app-context/index.js`. This module handles:
 *   - Session creation (with concurrent-session eviction via Socket.IO)
 *   - Session validation against the session store
 *   - Session invalidation (logout / password change)
 *   - `resolveUserRequestSession` — combines cookie/token resolution with
 *     session validation
 *   - `userAuth` / `adminAuth` Express middleware
 *
 * The factory receives lazy IO access (`getIO`) rather than a direct
 * reference because Socket.IO is created after the app context. This
 * preserves the existing `_io` lazy-binding pattern from the composer.
 */

const crypto = require('crypto');

const { hashSessionToken } = require('../crypto-auth');

/**
 * Build session + auth helpers bound to the supplied deps.
 * @param {object} args
 * @param {object} args.config               - loaded config (SESSION_TTL, USER_SESSION_MAX, USER_SESSION_COOKIE)
 * @param {object} args.stores               - data-access stores (sessions, roles)
 * @param {Function} args.getIO              - lazy getter for the Socket.IO server instance
 * @param {Function} args.resolveRequestToken - from cookies module
 * @param {Function} args.disconnectSocket   - from presence manager
 * @param {Function} args.emitPresence       - from presence manager
 * @param {Function} args.disconnectUserSockets - from presence manager
 * @param {Function} args.sendError          - response sendError helper
 * @param {object} args.ErrorCodes           - error-code enum
 */
function createSessionHelpers({
  config,
  stores,
  getIO,
  resolveRequestToken,
  disconnectSocket,
  emitPresence,
  disconnectUserSockets,
  sendError,
  ErrorCodes,
}) {
  async function createUserSession(userId, username) {
    const token = crypto.randomBytes(32).toString('hex');
    const evictedHashes = await stores.sessions.createUserSession({
      token: hashSessionToken(token),
      userId,
      username,
      createdAt: new Date(),
      lastAccess: new Date(),
      maxPerUser: config.USER_SESSION_MAX,
    });
    const io = getIO();
    if (evictedHashes && evictedHashes.length > 0 && io) {
      const hashSet = new Set(evictedHashes);
      const presenceTargets = new Set();
      for (const socket of io.of('/').sockets.values()) {
        if (!socket.data?.userSessionToken) continue;
        if (hashSet.has(hashSessionToken(socket.data.userSessionToken))) {
          disconnectSocket(socket, io, presenceTargets);
        }
      }
      for (const festivalId of presenceTargets) emitPresence(festivalId, io);
    }
    return token;
  }

  async function validateUserSession(token) {
    if (typeof token !== 'string' || token.length !== 64) return null;
    return stores.sessions.validateUserSession(hashSessionToken(token), config.SESSION_TTL);
  }

  async function invalidateUserSessions(userId, exceptToken = null) {
    await stores.sessions.deleteUserSessions(userId, exceptToken ? hashSessionToken(exceptToken) : null);
    const io = getIO();
    if (io) disconnectUserSockets(userId, io);
  }

  async function resolveUserRequestSession(req) {
    const { token, source } = resolveRequestToken(req, 'x-user-token', config.USER_SESSION_COOKIE);
    const session = await validateUserSession(token);
    if (!session) return null;
    return { token, source, session };
  }

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

  return {
    createUserSession,
    validateUserSession,
    invalidateUserSessions,
    resolveUserRequestSession,
    adminAuth,
    userAuth,
  };
}

module.exports = { createSessionHelpers };
