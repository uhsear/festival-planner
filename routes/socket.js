// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

/**
 * Real-time Socket.IO handlers for presence and live updates
 * Inbound events handled here: join:festival, leave:festival, join:crew,
 * leave:crew, reconnect:restore, disconnect.
 *
 * AUDIT FINDING (2026-04-14, DEFERRED FIX AGENT 1):
 *   lib/rate-limiting.js exports per-event socket limiters:
 *     PICK_SET_LIMIT, NOTE_ADD_LIMIT, STATUS_UPDATE_LIMIT, PRESENCE_UPDATE_LIMIT
 *   These are NOT wired here because `pick:set`, `note:add`, `status:update`,
 *   and `presence:update` are NOT inbound Socket.IO events in this codebase —
 *   they are server-side broadcast names emitted outward after HTTP route
 *   mutations (picks, notes, statuses) succeed. Clients send those mutations
 *   over HTTP where the existing `rateLimit(max, scope)` middleware already
 *   guards them.
 *
 *   If a future refactor moves these mutations to inbound Socket.IO events,
 *   wire the limiters like so inside the corresponding socket.on handler:
 *
 *     const { PICK_SET_LIMIT } = require('../lib/rate-limiting');
 *     const userId = socket.data.userId;
 *     if (userId) {
 *       const check = PICK_SET_LIMIT.consume(userId);
 *       if (!check.allowed) {
 *         socket.emit('error', { message: 'Pick rate limit exceeded', resetAt: check.resetAt });
 *         return;
 *       }
 *     }
 *
 *   Existing join/leave/reconnect flows continue to use `consumeSocketRateLimit`
 *   from the rateLimiters factory (keyed by SOCKET_JOIN_RATE_LIMIT /
 *   SOCKET_LEAVE_RATE_LIMIT) as before — no behavioral change.
 */

const crypto = require('crypto');
const { z } = require('zod');
const { generateTraceId, propagateTraceId } = require('../lib/tracing');

// ════════════════════════════════════════════════════════════════════════════════
// Socket Event Validation Schemas
// ════════════════════════════════════════════════════════════════════════════════

/** Base schema for all socket events with version support */
const _socketEventBase = z.object({
  _v: z.number().int().min(1).default(1),
});

/** Join a festival room to participate in real-time features */
const joinFestivalEventSchema = z.object({
  _v: z.number().int().min(1).default(1),
  festivalId: z.string().min(1).max(100),
  userToken: z.string().optional().nullable(),
}).passthrough();

/** Reconnect and restore presence state */
const reconnectRestoreEventSchema = z.object({
  _v: z.number().int().min(1).default(1),
  festivalId: z.string().min(1).max(100),
  userToken: z.string().optional().nullable(),
}).passthrough();


/** Join a crew room for real-time crew updates */
const joinCrewEventSchema = z.object({
  _v: z.number().int().min(1).default(1),
  crewId: z.string().min(1).max(100),
}).passthrough();

/** Leave a crew room */
const leaveCrewEventSchema = z.object({
  _v: z.number().int().min(1).default(1),
  crewId: z.string().min(1).max(100),
}).passthrough();


// ════════════════════════════════════════════════════════════════════════════════
// Cached memory usage — process.memoryUsage() is expensive on the hot path
// (syscall per invocation). Cache with a 5-second refresh interval.
// ════════════════════════════════════════════════════════════════════════════════
let _cachedMemoryUsage = process.memoryUsage();
const _memoryRefreshTimer = setInterval(() => {
  _cachedMemoryUsage = process.memoryUsage();
}, 5_000);
_memoryRefreshTimer.unref();

// ════════════════════════════════════════════════════════════════════════════════
// Socket Handler Setup
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Wrap socket ack callback with timeout to prevent hanging responses (#56)
 * @param {Function} respond - The ack callback from socket event
 * @param {number} timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns {Function} - Wrapped function that enforces timeout
 */
function withAckTimeout(respond, timeoutMs = 5000) {
  if (typeof respond !== 'function') return () => {};
  let called = false;
  const timer = setTimeout(() => {
    if (!called) {
      called = true;
      // Log but don't call respond — client has already timed out
    }
  }, timeoutMs);
  return (...args) => {
    if (called) return;
    called = true;
    clearTimeout(timer);
    respond(...args);
  };
}

/**
 * Setup Socket.IO event handlers
 * Factory function that configures all socket event listeners
 * @param {Object} deps - Dependencies injected from server.js
 * @returns {void} - Attaches listeners to the io instance in deps
 */
module.exports = function setupSocketHandlers(deps) {
  const {
    config, log, state, io,
    _sanitizeString, _createOpaqueId,
    resolveSocketToken, validateUserSession,
    getFestivalById, getUserFestivalProfile, _getUserById,
    _buildAvatarUrl,
    _emitter, stores,
    removeSocketPresence, getPresenceList, clearSocketSession,
    leaveFestivalRealtime, disconnectSocket, consumeSocketRateLimit, emitPresence,
    setSocketPresence,
  } = deps;

  // Main Socket.IO connection handler
  io.on('connection', (socket) => {
    // Assign a request ID for tracking this socket connection through its lifecycle
    socket.data.connectionId = crypto.randomUUID();
    // Propagate trace ID from handshake headers or generate new one
    propagateTraceId(socket, socket.handshake?.headers?.['x-trace-id'] || generateTraceId());
    const connectionId = socket.data.connectionId;

    if (state.metrics) {
      state.metrics.socketConnections += 1;
      const current = io.engine?.clientsCount || 0;
      if (current > state.metrics.peakConnections) state.metrics.peakConnections = current;
    }

    socket.on('join:festival', async (festivalId, data = {}, ack) => {
      // Support both (festivalId, ack) and (festivalId, data, ack) signatures
      if (typeof data === 'function') { ack = data; data = {}; }
      const respond = withAckTimeout(typeof ack === 'function' ? ack : () => {});
      try {

      // Schema validation for join:festival event
      const eventData = { _v: data._v || 1, festivalId, userToken: data.userToken || null };
      const validation = joinFestivalEventSchema.safeParse(eventData);
      if (!validation.success) {
        log.debug('join:festival schema validation failed', { connectionId, errors: validation.error.errors });
        return respond({ ok: false, error: 'SCHEMA_MISMATCH', requiredVersion: 1 });
      }

      const { festivalId: validatedFestivalId } = validation.data;

      // Auth + rate limit BEFORE any DB lookups to avoid wasting queries on bad/rate-limited requests
      const sessionToken = resolveSocketToken(socket, validation.data.userToken, config.USER_SESSION_COOKIE);
      const session = await validateUserSession(sessionToken);
      if (!session) {
        disconnectSocket(socket, io);
        return respond({ ok: false, error: 'Authentication required' });
      }
      if (!consumeSocketRateLimit(`join:${session.userId}`, config.SOCKET_JOIN_RATE_LIMIT)) {
        socket.emit('error', { message: 'Realtime rate limit exceeded' });
        return respond({ ok: false, error: 'Rate limited' });
      }

      // Cheap checks before DB queries
      const heapUsed = _cachedMemoryUsage.heapUsed;
      if (heapUsed > config.MAX_HEAP_BYTES * 0.75) {
        return respond({ ok: false, error: 'Server is at capacity' });
      }
      const roomSize = io.sockets.adapter.rooms.get(validatedFestivalId)?.size || 0;
      if (roomSize >= config.ROOM_CAPACITY_LIMIT) {
        log.warn('room:full', { festivalId: validatedFestivalId || festivalId, roomSize }); return respond({ ok: false, error: 'Room is full', code: 'WS_ROOM_FULL' });
      }

      // DB lookups
      if (!await getFestivalById(validatedFestivalId)) {
        return respond({ ok: false, error: 'Festival not found' });
      }
      const profile = await getUserFestivalProfile(session.userId, validatedFestivalId);
      if (!profile) {
        socket.emit('error', { message: 'Join this festival before using crew realtime' });
        return respond({ ok: false, error: 'Not a member of this festival' });
      }

      const previousFestivalId = leaveFestivalRealtime(socket, io);
      if (previousFestivalId) emitPresence(previousFestivalId, io);
      for (const room of socket.rooms) {
        if (room !== socket.id) socket.leave(room);
      }

      socket.join(validatedFestivalId);
      socket.data.userId = session.userId;
      socket.data.username = session.username;
      socket.data.festivalId = validatedFestivalId;
      socket.data.profileId = profile.id;
      socket.data.userSessionToken = sessionToken;

      // Update presence in both local Map and Redis
      // Guard against duplicate presence updates on reconnect
      const presenceList = await getPresenceList(validatedFestivalId);
      const existingPresence = presenceList.find(
        (p) => p.userId === session.userId && p.socketId === socket.id
      );
      if (!existingPresence) {
        setSocketPresence(validatedFestivalId, session.userId, session.username, socket.id)
          .catch((err) => log.debug('setSocketPresence error', { error: err.message }));
      }
      emitPresence(validatedFestivalId, io);
      respond({ ok: true, profileId: profile.id });
      } catch (error) {
        log.error('join:festival error', { error: error && error.message, socketId: socket.id, connectionId });
        respond({ ok: false, error: 'Server error' });
      }
    });

    socket.on('leave:festival', () => {
      try {
        const scopeKey = socket.data?.userId ? `leave:${socket.data.userId}` : `leave:${socket.id}`;
        if (!consumeSocketRateLimit(scopeKey, config.SOCKET_LEAVE_RATE_LIMIT)) {
          socket.emit('error', { message: 'Realtime rate limit exceeded' });
          return;
        }
        const festivalId = leaveFestivalRealtime(socket, io);
        for (const room of socket.rooms) {
          if (room !== socket.id) socket.leave(room);
        }
        if (festivalId) emitPresence(festivalId, io);
      } catch (error) {
        log.error('leave:festival error', { error: error.message, socketId: socket.id, userId: socket.data?.userId });
        socket.emit('error', { message: 'Failed to leave festival' });
      }
    });

    // ── Crew Room Management ──────────────────────────────────────────
    socket.on('join:crew', async (data = {}, ack) => {
      const respond = withAckTimeout(typeof ack === 'function' ? ack : () => {});
      try {
        const validation = joinCrewEventSchema.safeParse({ _v: data._v || 1, crewId: data.crewId || '' });
        if (!validation.success) return respond({ ok: false, error: 'SCHEMA_MISMATCH' });

        const { crewId } = validation.data;
        const sessionToken = socket.data?.userSessionToken || resolveSocketToken(socket, null, config.USER_SESSION_COOKIE);
        const session = await validateUserSession(sessionToken);
        if (!session) { disconnectSocket(socket, io); return respond({ ok: false, error: 'Authentication required' }); }
        // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
        socket.data.userSessionToken = sessionToken;

        if (!consumeSocketRateLimit(`crew-join:${session.userId}`, config.SOCKET_JOIN_RATE_LIMIT)) {
          return respond({ ok: false, error: 'Rate limited' });
        }

        // Verify crew exists and user is a member
        const crew = await stores.crews.getById(crewId);
        if (!crew) return respond({ ok: false, error: 'Crew not found' });
        const membership = await stores.crews.getMember(crewId, session.userId);
        if (!membership) return respond({ ok: false, error: 'Not a member of this crew' });

        // Leave previous crew room if any
        const prevCrewId = socket.data?.crewId;
        if (prevCrewId && prevCrewId !== crewId) {
          socket.leave(`crew:${prevCrewId}`);
        }

        socket.join(`crew:${crewId}`);
        socket.data.crewId = crewId;

        log.debug('join:crew', { userId: session.userId, crewId });
        respond({ ok: true, crewId });
      } catch (error) {
        log.error('join:crew error', { error: error.message, socketId: socket.id, userId: socket.data?.userId });
        respond({ ok: false, error: 'Server error' });
      }
    });

    socket.on('leave:crew', async (data = {}) => {
      try {
        const validation = leaveCrewEventSchema.safeParse({ _v: data._v || 1, crewId: data.crewId || '' });
        if (!validation.success) return;

        const { crewId } = validation.data;
        // Verify session still valid
        const sessionToken = socket.data?.userSessionToken || resolveSocketToken(socket, null, config.USER_SESSION_COOKIE);
        const session = await validateUserSession(sessionToken);
        if (!session) { disconnectSocket(socket, io); return; }
        // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
        socket.data.userSessionToken = sessionToken;

        if (!consumeSocketRateLimit(`crew-leave:${session.userId}`, config.SOCKET_LEAVE_RATE_LIMIT)) return;

        socket.leave(`crew:${crewId}`);
        if (socket.data?.crewId === crewId) delete socket.data.crewId;
      } catch (error) {
        log.error('leave:crew error', { error: error.message, socketId: socket.id, userId: socket.data?.userId });
      }
    });

    // #17: Reconnection recovery — client sends last known state, server gap-fills
    // Security: Always re-validate session on reconnect (not just initial connection)
    socket.on('reconnect:restore', async (data = {}, ack) => {
      const respond = withAckTimeout(typeof ack === 'function' ? ack : () => {});
      try {
        // Schema validation for reconnect:restore event
        const eventData = {
          _v: data._v || 1,
          festivalId: data.festivalId || '',
          userToken: data.userToken || null,
          lastMessageSequence: data.lastMessageSequence || null,
        };
        const validation = reconnectRestoreEventSchema.safeParse(eventData);
        if (!validation.success) {
          log.info('reconnect:restore schema validation failed', { errors: validation.error.errors });
          return respond({ ok: false, error: 'SCHEMA_MISMATCH', requiredVersion: 1 });
        }

        const { festivalId } = validation.data;
        if (!await getFestivalById(festivalId)) {
          return respond({ ok: false, error: 'Festival not found' });
        }

        const roomSize = io.sockets.adapter.rooms.get(festivalId)?.size || 0;
        if (roomSize >= config.ROOM_CAPACITY_LIMIT) {
          log.warn('room:full', { festivalId, roomSize }); return respond({ ok: false, error: 'Room is full', code: 'WS_ROOM_FULL' });
        }

        const heapUsed = _cachedMemoryUsage.heapUsed;
        if (heapUsed > config.MAX_HEAP_BYTES * 0.75) {
          return respond({ ok: false, error: 'Server is at capacity' });
        }

        // SECURITY: Always re-validate session token on reconnect (token may have been invalidated during disconnect)
        const sessionToken = resolveSocketToken(socket, validation.data.userToken, config.USER_SESSION_COOKIE);
        const session = await validateUserSession(sessionToken);
        if (!session) {
          log.warn('reconnect:restore session validation failed', { festivalId, socketId: socket.id });
          disconnectSocket(socket, io);
          return respond({ ok: false, error: 'Authentication required' });
        }
        if (!consumeSocketRateLimit(`restore:${session.userId}`, config.SOCKET_JOIN_RATE_LIMIT)) {
          return respond({ ok: false, error: 'Rate limited' });
        }
        const profile = await getUserFestivalProfile(session.userId, festivalId);
        if (!profile) {
          return respond({ ok: false, error: 'Not a member of this festival' });
        }

        // Re-join room and restore socket state
        const previousFestivalId = leaveFestivalRealtime(socket, io);
        if (previousFestivalId && previousFestivalId !== festivalId) emitPresence(previousFestivalId, io);
        for (const room of socket.rooms) {
          if (room !== socket.id) socket.leave(room);
        }
        socket.join(festivalId);
        socket.data.userId = session.userId;
        socket.data.username = session.username;
        socket.data.festivalId = festivalId;
        socket.data.profileId = profile.id;
        socket.data.userSessionToken = sessionToken;

        // Guard against duplicate presence updates on reconnect
        const presenceList = await getPresenceList(festivalId);
        const existingPresence = presenceList.find(
          (p) => p.userId === session.userId && p.socketId === socket.id
        );
        if (!existingPresence) {
          setSocketPresence(festivalId, session.userId, session.username, socket.id)
            .catch((err) => log.debug('setSocketPresence error', { error: err.message }));
        }
        emitPresence(festivalId, io);

        log.info('reconnect:restore success', { userId: session.userId, festivalId });
        respond({
          ok: true,
          profileId: profile.id,
        });
      } catch (error) {
        log.error('reconnect:restore error', { error: error.message, socketId: socket.id, userId: socket.data?.userId });
        respond({ ok: false, error: 'Server error' });
      }
    });



    socket.on('disconnect', (reason) => {
      try {
        if (state.metrics) state.metrics.socketDisconnections += 1;
        if (reason === 'transport error' || reason === 'transport close') {
          if (state.metrics) state.metrics.socketErrors += 1;
          log.debug('socket transport error', { reason, userId: socket.data?.userId, festivalId: socket.data?.festivalId });
        }
        const festivalId = socket.data?.festivalId;
        // Crew room cleanup happens automatically when socket disconnects (Socket.IO removes from all rooms)
        removeSocketPresence(socket);
        clearSocketSession(socket);
        if (festivalId) emitPresence(festivalId, io);
      } catch (error) {
        log.error('disconnect cleanup error', { error: error.message, socketId: socket.id, userId: socket.data?.userId });
      }
    });
  });

  return {};
};
