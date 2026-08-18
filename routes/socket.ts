// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

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

import crypto from 'crypto';
import { z } from 'zod';
import { generateTraceId, propagateTraceId } from '../lib/tracing.js';
import { schemas } from '../lib/schemas.js';
import { LOCATION_UPDATE_LIMIT, registerSharingSocket, unregisterSharingSocket } from '../lib/rate-limiting.js';
import { writeLivePosition, dropLivePosition, readLiveSnapshot } from '../lib/live-location-cache.js';

// ════════════════════════════════════════════════════════════════════════════════
// Socket Event Validation Schemas
// ════════════════════════════════════════════════════════════════════════════════

/** Base schema for all socket events with version support */
const _socketEventBase = z.object({
  _v: z.number().int().min(1).default(1),
});

/** Join a festival room to participate in real-time features */
const joinFestivalEventSchema = z
  .object({
    _v: z.number().int().min(1).default(1),
    festivalId: z.string().min(1).max(100),
    userToken: z.string().optional().nullable(),
  })
  .strip();

/** Reconnect and restore presence state */
const reconnectRestoreEventSchema = z
  .object({
    _v: z.number().int().min(1).default(1),
    festivalId: z.string().min(1).max(100),
    userToken: z.string().optional().nullable(),
  })
  .strip();

/** Join a crew room for real-time crew updates */
const joinCrewEventSchema = z
  .object({
    _v: z.number().int().min(1).default(1),
    crewId: z.string().min(1).max(100),
  })
  .strip();

/** Leave a crew room */
const leaveCrewEventSchema = z
  .object({
    _v: z.number().int().min(1).default(1),
    crewId: z.string().min(1).max(100),
  })
  .strip();

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
 * Wrap socket ack callback with timeout to prevent hanging responses (#56).
 * On timeout we now (a) surface telemetry via the injected logger — `log` is a
 * handler-scoped dependency, not a module-level binding, so it must be passed in
 * — and (b) still deliver a failure ack so a slow join never leaves the client
 * waiting on a callback that never fires.
 * @param respond - The ack callback from socket event
 * @param log - Structured logger injected from the handler scope
 * @param connectionId - Per-connection id for telemetry correlation
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Wrapped function that enforces timeout
 */
function withAckTimeout(respond: any, log: any, connectionId: any, timeoutMs = 5000) {
  if (typeof respond !== 'function') return () => {};
  let called = false;
  const timer = setTimeout(() => {
    if (!called) {
      log?.warn?.('socket ack timeout', { connectionId });
      respond({ ok: false, error: 'Server timeout', code: 'WS_ACK_TIMEOUT' });
      called = true;
    }
  }, timeoutMs);
  return (...args: any[]) => {
    if (called) return;
    called = true;
    clearTimeout(timer);
    respond(...args);
  };
}

// ────────────────────────────────────────────────────────────────────────
// Live-location membership re-check cache (M2) + capturedAt clamp (L4)
// ────────────────────────────────────────────────────────────────────────

/** Re-verify crew membership on the streaming path at most this often per socket. */
const MEMBERSHIP_RECHECK_INTERVAL_MS = 15_000;
/** ...or every this-many updates, whichever comes first. */
const MEMBERSHIP_RECHECK_EVERY_N = 20;
/** capturedAt may not be more than this far in the past relative to server time. */
const CAPTURED_AT_MAX_AGE_MS = 60_000;
/** ...nor more than this far in the future (clock skew tolerance). */
const CAPTURED_AT_MAX_SKEW_MS = 30_000;

/**
 * Clamp a client-supplied `capturedAt` to a small window around server time
 * (L4): a client must not be able to appear perpetually "live · N ago" nor
 * stamp a future fix. Returns an ISO string clamped to [now-MAXAGE, now+SKEW].
 * Falls back to `serverNowIso` if the input is unparseable.
 */
function clampCapturedAt(capturedAt: any, serverNow: number, serverNowIso: string): string {
  const t = Date.parse(capturedAt);
  if (!Number.isFinite(t)) return serverNowIso;
  const lo = serverNow - CAPTURED_AT_MAX_AGE_MS;
  const hi = serverNow + CAPTURED_AT_MAX_SKEW_MS;
  if (t < lo) return new Date(lo).toISOString();
  if (t > hi) return new Date(hi).toISOString();
  return new Date(t).toISOString();
}

/**
 * Setup Socket.IO event handlers
 * Factory function that configures all socket event listeners
 * @param deps - Dependencies injected from server.ts
 * @returns void - Attaches listeners to the io instance in deps
 */
export default function setupSocketHandlers(deps: any) {
  const {
    config,
    log,
    state,
    io,
    _sanitizeString,
    _createOpaqueId,
    resolveSocketToken,
    validateUserSession,
    getFestivalById,
    getUserFestivalProfile,
    _getUserById,
    _buildAvatarUrl,
    _emitter,
    stores,
    removeSocketPresence,
    getPresenceList,
    clearSocketSession,
    leaveFestivalRealtime,
    disconnectSocket,
    consumeSocketRateLimit,
    emitPresence,
    setSocketPresence,
    redis,
  } = deps;

  // ── Shared auth + room join helper ─────────────────────────────────
  // Used by both join:festival and reconnect:restore to avoid ~40 lines
  // of duplicated auth validation, room management, and presence logic.
  /**
   * Authenticate a socket, validate festival membership, join the room,
   * and update presence state.
   */
  async function authenticateAndJoinRoom(socket: any, festivalId: any, userToken: any, { rateLimitScope }: any) {
    // Auth + rate limit BEFORE any DB lookups
    const sessionToken = resolveSocketToken(socket, userToken, config.USER_SESSION_COOKIE);
    const session = await validateUserSession(sessionToken);
    if (!session) {
      disconnectSocket(socket, io);
      return { ok: false, error: 'Authentication required' };
    }
    if (!consumeSocketRateLimit(`${rateLimitScope}:${session.userId}`, config.SOCKET_JOIN_RATE_LIMIT)) {
      socket.emit('error', { message: 'Realtime rate limit exceeded' });
      return { ok: false, error: 'Rate limited' };
    }

    // Cheap capacity checks before DB queries
    const heapUsed = _cachedMemoryUsage.heapUsed;
    if (heapUsed > config.MAX_HEAP_BYTES * 0.75) {
      return { ok: false, error: 'Server is at capacity' };
    }
    const roomSize = io.sockets.adapter.rooms.get(festivalId)?.size || 0;
    if (roomSize >= config.ROOM_CAPACITY_LIMIT) {
      log.warn('room:full', { festivalId, roomSize });
      return { ok: false, error: 'Room is full', code: 'WS_ROOM_FULL' };
    }

    // DB lookups
    if (!(await getFestivalById(festivalId))) {
      return { ok: false, error: 'Festival not found' };
    }
    const profile = await getUserFestivalProfile(session.userId, festivalId);
    if (!profile) {
      return { ok: false, error: 'Not a member of this festival' };
    }

    // Leave only the PREVIOUS festival room (leaveFestivalRealtime does the
    // socket.leave). Do NOT blanket-leave every room: this socket may also be in
    // its crew:${crewId} room, and evicting it there while socket.data.crewId
    // still points at that crew makes the location:share/sync gates (which only
    // check socket.data.crewId) keep passing while every crew broadcast —
    // sos:raised, location:peer-update — silently misses this socket.
    const previousFestivalId = leaveFestivalRealtime(socket, io);
    if (previousFestivalId && previousFestivalId !== festivalId) emitPresence(previousFestivalId, io);

    // Join new room and set socket state
    socket.join(festivalId);
    socket.data.userId = session.userId;
    socket.data.username = session.username;
    socket.data.festivalId = festivalId;
    socket.data.profileId = profile.id;
    socket.data.userSessionToken = sessionToken;
    socket.authenticated = true;

    // Update presence — guard against duplicates on reconnect
    const presenceList = await getPresenceList(festivalId);
    const existingPresence = presenceList.find((p: any) => p.userId === session.userId && p.socketId === socket.id);
    if (!existingPresence) {
      setSocketPresence(festivalId, session.userId, session.username, socket.id).catch((err: any) =>
        // A failed presence write means emitPresence below runs on a stale set
        // and the user is silently absent from who's-online — warn so it's
        // visible in prod, not buried at debug.
        log.warn('setSocketPresence error', { error: err.message, festivalId, userId: session.userId }),
      );
    }
    emitPresence(festivalId, io);

    return { ok: true, session, profile };
  }

  // Main Socket.IO connection handler
  io.on('connection', (socket: any) => {
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

    socket.on('join:festival', async (festivalId: any, data: any = {}, ack: any) => {
      // Support both (festivalId, ack) and (festivalId, data, ack) signatures
      if (typeof data === 'function') {
        ack = data;
        data = {};
      }
      const respond = withAckTimeout(typeof ack === 'function' ? ack : null, log, connectionId);
      try {
        // Schema validation for join:festival event
        const eventData = { _v: data._v || 1, festivalId, userToken: data.userToken || null };
        const validation = joinFestivalEventSchema.safeParse(eventData);
        if (!validation.success) {
          log.debug('join:festival schema validation failed', { connectionId, errors: validation.error.issues });
          return respond({ ok: false, error: 'SCHEMA_MISMATCH', requiredVersion: 1 });
        }

        const { festivalId: validatedFestivalId } = validation.data;
        const result = await authenticateAndJoinRoom(socket, validatedFestivalId, validation.data.userToken, {
          rateLimitScope: 'join',
        });
        if (!result.ok) {
          if (result.error === 'Not a member of this festival') {
            socket.emit('error', { message: 'Join this festival before using crew realtime' });
          }
          return respond({ ok: false, error: result.error, code: result.code });
        }
        respond({ ok: true, profileId: result.profile.id });
      } catch (error: any) {
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
      } catch (error: any) {
        log.error('leave:festival error', { error: error.message, socketId: socket.id, userId: socket.data?.userId });
        socket.emit('error', { message: 'Failed to leave festival' });
      }
    });

    // ── Crew Room Management ──────────────────────────────────────────
    socket.on('join:crew', async (data: any = {}, ack: any) => {
      const respond = withAckTimeout(typeof ack === 'function' ? ack : null, log, connectionId);
      try {
        const validation = joinCrewEventSchema.safeParse({ _v: data._v || 1, crewId: data.crewId || '' });
        if (!validation.success) return respond({ ok: false, error: 'SCHEMA_MISMATCH' });

        const { crewId } = validation.data;
        const sessionToken =
          socket.data?.userSessionToken || resolveSocketToken(socket, null, config.USER_SESSION_COOKIE);
        const session = await validateUserSession(sessionToken);
        if (!session) {
          disconnectSocket(socket, io);
          return respond({ ok: false, error: 'Authentication required' });
        }
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
      } catch (error: any) {
        log.error('join:crew error', { error: error.message, socketId: socket.id, userId: socket.data?.userId });
        respond({ ok: false, error: 'Server error' });
      }
    });

    socket.on('leave:crew', async (data: any = {}) => {
      try {
        const validation = leaveCrewEventSchema.safeParse({ _v: data._v || 1, crewId: data.crewId || '' });
        if (!validation.success) return;

        const { crewId } = validation.data;
        // Verify session still valid
        const sessionToken =
          socket.data?.userSessionToken || resolveSocketToken(socket, null, config.USER_SESSION_COOKIE);
        const session = await validateUserSession(sessionToken);
        if (!session) {
          disconnectSocket(socket, io);
          return;
        }
        // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
        socket.data.userSessionToken = sessionToken;

        if (!consumeSocketRateLimit(`crew-leave:${session.userId}`, config.SOCKET_LEAVE_RATE_LIMIT)) return;

        // If this socket was sharing live GPS to the crew it's leaving, tear that
        // down too (L2): tell peers the marker is gone, clear the sharing stamp,
        // and drop the concurrent-sharing registration BEFORE leaving the room.
        if (socket.data?.sharingCrewId === crewId) {
          socket.to(`crew:${crewId}`).emit('location:peer-stopped', {
            _v: 1,
            crewId,
            userId: session.userId,
            reason: 'left',
          });
          delete socket.data.sharingCrewId;
          unregisterSharingSocket(redis, session.userId, socket.id).catch(() => {});
          // Phase 3C: evict the cached position on crew-leave.
          void dropLivePosition(redis, crewId, session.userId);
        }

        socket.leave(`crew:${crewId}`);
        if (socket.data?.crewId === crewId) delete socket.data.crewId;
        // Reset the streaming-path membership cache so a future re-join re-checks.
        delete socket.data.crewMembershipCheckedAt;
        delete socket.data.crewMembershipUpdateCount;
      } catch (error: any) {
        log.error('leave:crew error', { error: error.message, socketId: socket.id, userId: socket.data?.userId });
      }
    });

    // ── Live Location (EPHEMERAL — socket-only, NEVER persisted) ───────
    // Opt-in, single-crew-scoped, auto-expiring GPS relay. Positions travel
    // ONLY over Socket.IO to the crew:${crewId} room (the same room join:crew
    // gates). No Postgres writes anywhere in these handlers. Sharing is more
    // sensitive than viewing, so location:share re-verifies crew membership.

    socket.on('location:share', async (data: any = {}, ack: any) => {
      const respond = withAckTimeout(typeof ack === 'function' ? ack : null, log, connectionId);
      try {
        if (config.LIVE_LOCATION_ENABLED === false) {
          return respond({ ok: false, code: 'FEATURE_DISABLED' });
        }
        const validation = schemas.locationShare.safeParse(data);
        if (!validation.success) return respond({ ok: false, code: 'SCHEMA_MISMATCH' });
        const { crewId, position, expiresAt } = validation.data;

        // The socket must already be joined to this crew room (join:crew set it).
        if (socket.data?.crewId !== crewId) return respond({ ok: false, code: 'NOT_IN_CREW_ROOM' });

        // Re-validate session + membership: sharing live GPS is more sensitive
        // than viewing, and a user who left the crew must not be able to share.
        const sessionToken =
          socket.data?.userSessionToken || resolveSocketToken(socket, null, config.USER_SESSION_COOKIE);
        const session = await validateUserSession(sessionToken);
        if (!session) {
          disconnectSocket(socket, io);
          return respond({ ok: false, code: 'AUTH_REQUIRED' });
        }
        const membership = await stores.crews.getMember(crewId, session.userId);
        if (!membership) return respond({ ok: false, code: 'NOT_A_MEMBER' });

        // M3: cluster-wide cap on concurrently-sharing sockets per user so one
        // user can't multiply the crew-room broadcast budget by opening many
        // sockets. Best-effort (fail-open when Redis is down).
        const sharingCap = await registerSharingSocket(redis, session.userId, socket.id);
        if (!sharingCap.allowed) {
          return respond({ ok: false, code: 'TOO_MANY_SHARING_SOCKETS' });
        }

        /* eslint-disable require-atomic-updates -- socket.data is per-connection, not a shared race target */
        socket.data.userSessionToken = sessionToken;
        socket.data.userId = session.userId;
        socket.data.username = session.username;
        socket.data.sharingCrewId = crewId;
        socket.data.sharingSince = Date.now();
        // M2: seed the streaming-path membership re-check cache — membership was
        // just verified above, so the next recheck is N updates / T seconds out.
        socket.data.crewMembershipCheckedAt = Date.now();
        socket.data.crewMembershipUpdateCount = 0;
        /* eslint-enable require-atomic-updates */

        // If a first fix is included, broadcast it immediately so peers see the
        // sharer without waiting for the first periodic update tick.
        if (position) {
          const nowMs = Date.now();
          const serverAt = new Date(nowMs).toISOString();
          const payload = {
            _v: 1,
            crewId,
            userId: session.userId,
            username: session.username,
            lat: position.lat,
            lng: position.lng,
            accuracy: position.accuracy,
            heading: position.heading,
            // Phase 4C: relay battery (off the fix) + the share-window expiry so
            // peers render the direction/battery/countdown chips. Pure pass-through.
            battery: position.battery,
            // Peer low-power flag (#5): relay the sharer's battery-saver state so
            // peers render a low-power cue next to battery. Optional pass-through.
            lowPower: position.lowPower,
            expiresAt,
            // L4: clamp client capturedAt to a small window around server time.
            capturedAt: clampCapturedAt(position.capturedAt, nowMs, serverAt),
            serverAt,
          };
          socket.to('crew:' + crewId).emit('location:peer-update', payload);
          // Phase 3C: cache the first fix so a late-joiner snapshot (location:sync)
          // can render this sharer immediately. Ephemeral (Redis-only) + fail-open.
          void writeLivePosition(redis, crewId, payload);
        }

        log.debug('location:share', { userId: session.userId, crewId });
        respond({ ok: true });
      } catch (error: any) {
        log.error('location:share error', { error: error.message, socketId: socket.id, userId: socket.data?.userId });
        respond({ ok: false, code: 'SERVER_ERROR' });
      }
    });

    socket.on('location:update', async (data: any = {}) => {
      // High-frequency fire-rate path: share already validated membership and
      // stamped socket.data. Drop silently + emit a structured error if the
      // sender isn't actively sharing this crew. A short-TTL membership re-check
      // (M2) self-heals if the sharer was removed mid-stream.
      try {
        if (config.LIVE_LOCATION_ENABLED === false) return;
        const validation = schemas.locationUpdate.safeParse(data);
        if (!validation.success) {
          socket.emit('error', { message: 'Invalid location payload', code: 'SCHEMA_MISMATCH' });
          return;
        }
        const { crewId, lat, lng, accuracy, heading, speed, battery, lowPower, expiresAt, capturedAt } =
          validation.data;

        if (socket.data?.sharingCrewId !== crewId) {
          socket.emit('error', { message: 'Not sharing location to this crew', code: 'NOT_SHARING' });
          return;
        }

        const userId = socket.data.userId;

        // M3: cluster-wide per-user fire-rate cap (Redis-backed, falls back to
        // the per-process limiter when Redis is unavailable). Caps total
        // updates/min/user across all workers, not just this socket.
        const check = await LOCATION_UPDATE_LIMIT.consumeAsync(userId, redis);
        if (!check.allowed) {
          socket.emit('error', { message: 'Location update rate limit exceeded', code: 'RATE_LIMITED' });
          return;
        }

        // M2: defense-in-depth membership re-check on the stream. Primary fix is
        // H1 room eviction; this self-heals if a sharer kept emitting after being
        // removed. Re-check at most every N updates / T seconds to stay cheap.
        const nowMs = Date.now();
        const updateCount = (socket.data.crewMembershipUpdateCount || 0) + 1;
        socket.data.crewMembershipUpdateCount = updateCount;
        const lastChecked = socket.data.crewMembershipCheckedAt || 0;
        if (updateCount >= MEMBERSHIP_RECHECK_EVERY_N || nowMs - lastChecked >= MEMBERSHIP_RECHECK_INTERVAL_MS) {
          socket.data.crewMembershipUpdateCount = 0;
          socket.data.crewMembershipCheckedAt = nowMs;
          const stillMember = await stores.crews.getMember(crewId, userId);
          if (!stillMember) {
            // Tear down: tell peers, clear sharing state, drop registration.
            socket.to('crew:' + crewId).emit('location:peer-stopped', {
              _v: 1,
              crewId,
              userId,
              reason: 'revoked',
            });
            delete socket.data.sharingCrewId;
            socket.leave('crew:' + crewId);
            if (socket.data?.crewId === crewId) delete socket.data.crewId;
            unregisterSharingSocket(redis, userId, socket.id).catch(() => {});
            // Phase 3C: evict the cached position so the snapshot can't reveal a
            // revoked member's last-known GPS.
            void dropLivePosition(redis, crewId, userId);
            socket.emit('error', { message: 'No longer a member of this crew', code: 'NOT_A_MEMBER' });
            return;
          }
        }

        const serverAt = new Date(nowMs).toISOString();
        const payload = {
          _v: 1,
          crewId,
          userId,
          username: socket.data.username,
          lat,
          lng,
          accuracy,
          heading,
          speed,
          // Phase 4C: relay sharer battery + the share-window expiry (both optional)
          // so peers render the heading/battery/countdown chips. Pure pass-through.
          battery,
          // Peer low-power flag (#5): relay the sharer's battery-saver state so
          // peers render a low-power cue next to battery. Optional pass-through.
          lowPower,
          expiresAt,
          // L4: clamp client capturedAt to a small window around server time.
          capturedAt: clampCapturedAt(capturedAt, nowMs, serverAt),
          serverAt,
        };
        // Broadcast to the crew room EXCLUDING the sender.
        socket.to('crew:' + crewId).emit('location:peer-update', payload);
        // Phase 3C: refresh the late-joiner snapshot cache with this fix.
        void writeLivePosition(redis, crewId, payload);
      } catch (error: any) {
        log.error('location:update error', { error: error.message, socketId: socket.id, userId: socket.data?.userId });
      }
    });

    socket.on('location:stop', (data: any = {}, ack: any) => {
      const respond = withAckTimeout(typeof ack === 'function' ? ack : null, log, connectionId);
      try {
        const validation = schemas.locationStop.safeParse(data);
        if (!validation.success) return respond({ ok: false });
        const { crewId } = validation.data;
        const userId = socket.data?.userId;

        // `crewId` is client-supplied and only shape-validated above, so a stop
        // must be proven against a crew this socket was actually admitted to —
        // otherwise any client can spray location:peer-stopped (bearing its real
        // userId) into arbitrary crew rooms and evict peers' cached positions.
        // `socket.data.crewId` is set only after join:crew's membership check and
        // `socket.data.sharingCrewId` only after location:share's, so matching
        // either is proof of admission and needs no extra round-trip on this hot
        // teardown path. Both are accepted because a socket that shared to crew A
        // and later joined crew B must still be able to stop A.
        if (socket.data?.crewId !== crewId && socket.data?.sharingCrewId !== crewId) {
          return respond({ ok: false });
        }

        if (socket.data?.sharingCrewId === crewId) {
          delete socket.data.sharingCrewId;
          unregisterSharingSocket(redis, userId, socket.id).catch(() => {});
        }
        // Phase 3C: evict the cached position so a snapshot won't show a member
        // who just stopped (peer-stopped already tells currently-connected peers).
        if (userId) void dropLivePosition(redis, crewId, userId);

        if (userId) {
          socket.to('crew:' + crewId).emit('location:peer-stopped', {
            _v: 1,
            crewId,
            userId,
            reason: 'stop',
          });
        }
        log.debug('location:stop', { userId, crewId });
        respond({ ok: true });
      } catch (error: any) {
        log.error('location:stop error', { error: error.message, socketId: socket.id, userId: socket.data?.userId });
        respond({ ok: false });
      }
    });

    // ── Live Location: late-joiner snapshot (Phase 3C) ─────────────────
    // A freshly-opened app sees an empty map until the next ~10s update tick.
    // On join/subscribe the client emits location:sync to pull all crew members'
    // CURRENT last-known positions at once. Served from the ephemeral Redis TTL
    // cache (NOT Postgres), excluding the requester, and gated as tightly as
    // location:share (re-validates session + membership) because it reveals
    // peers' GPS. Fail-open: any miss/Redis-hiccup returns { ok: false, peers: [] }
    // and positions still arrive on the next live tick — no regression.
    socket.on('location:sync', async (data: any = {}, ack: any) => {
      const respond = withAckTimeout(typeof ack === 'function' ? ack : null, log, connectionId);
      try {
        if (config.LIVE_LOCATION_ENABLED === false) {
          return respond({ ok: false, peers: [] });
        }
        const validation = schemas.locationSync.safeParse(data);
        if (!validation.success) return respond({ ok: false, peers: [] });
        const { crewId } = validation.data;

        // Must already be joined to this crew room (join:crew gated membership).
        if (socket.data?.crewId !== crewId) return respond({ ok: false, peers: [] });

        // Re-validate session + membership: the snapshot reveals peers' last-known
        // GPS, so a user who left the crew must not be able to pull positions.
        const sessionToken =
          socket.data?.userSessionToken || resolveSocketToken(socket, null, config.USER_SESSION_COOKIE);
        const session = await validateUserSession(sessionToken);
        if (!session) {
          disconnectSocket(socket, io);
          return respond({ ok: false, peers: [] });
        }
        const membership = await stores.crews.getMember(crewId, session.userId);
        if (!membership) return respond({ ok: false, peers: [] });

        // Serve last-known positions from the ephemeral Redis cache, excluding
        // the requester (they render their own marker locally).
        const peers = await readLiveSnapshot(redis, crewId, {
          now: Date.now(),
          selfUserId: session.userId,
        });
        log.debug('location:sync', { userId: session.userId, crewId, peerCount: peers.length });
        respond({ ok: true, peers });
      } catch (error: any) {
        log.error('location:sync error', { error: error.message, socketId: socket.id, userId: socket.data?.userId });
        respond({ ok: false, peers: [] });
      }
    });

    // #17: Reconnection recovery — client sends last known state, server gap-fills
    // Security: Always re-validate session on reconnect (not just initial connection)
    socket.on('reconnect:restore', async (data: any = {}, ack: any) => {
      const respond = withAckTimeout(typeof ack === 'function' ? ack : null, log, connectionId);
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
          log.info('reconnect:restore schema validation failed', { errors: validation.error.issues });
          return respond({ ok: false, error: 'SCHEMA_MISMATCH', requiredVersion: 1 });
        }

        const { festivalId } = validation.data;
        const result = await authenticateAndJoinRoom(socket, festivalId, validation.data.userToken, {
          rateLimitScope: 'restore',
        });
        if (!result.ok) {
          if (result.error === 'Authentication required') {
            log.warn('reconnect:restore session validation failed', { festivalId, socketId: socket.id });
          }
          return respond({ ok: false, error: result.error, code: result.code });
        }

        log.info('reconnect:restore success', { userId: result.session.userId, festivalId });
        respond({
          ok: true,
          profileId: result.profile.id,
        });
      } catch (error: any) {
        log.error('reconnect:restore error', {
          error: error.message,
          socketId: socket.id,
          userId: socket.data?.userId,
        });
        respond({ ok: false, error: 'Server error' });
      }
    });

    socket.on('disconnect', (reason: any) => {
      try {
        if (state.metrics) state.metrics.socketDisconnections += 1;
        if (reason === 'transport error' || reason === 'transport close') {
          if (state.metrics) state.metrics.socketErrors += 1;
          log.debug('socket transport error', {
            reason,
            userId: socket.data?.userId,
            festivalId: socket.data?.festivalId,
          });
        }
        const festivalId = socket.data?.festivalId;
        // Live-location auto-expire on disconnect: if this socket was sharing,
        // tell the crew room so no ghost marker lingers (enforces foreground-only
        // + auto-stop-on-disconnect). Broadcast BEFORE the socket leaves rooms.
        const sharingCrewId = socket.data?.sharingCrewId;
        const sharingUserId = socket.data?.userId;
        if (sharingCrewId && sharingUserId) {
          socket.to('crew:' + sharingCrewId).emit('location:peer-stopped', {
            _v: 1,
            crewId: sharingCrewId,
            userId: sharingUserId,
            reason: 'disconnect',
          });
          // M3: drop the concurrent-sharing registration for this socket.
          unregisterSharingSocket(redis, sharingUserId, socket.id).catch(() => {});
          // Phase 3C: evict the cached position so a force-quit sharer's marker
          // isn't served in a later snapshot (the staleness filter is a backstop).
          void dropLivePosition(redis, sharingCrewId, sharingUserId);
        }
        // Crew room cleanup happens automatically when socket disconnects (Socket.IO removes from all rooms)
        removeSocketPresence(socket);
        clearSocketSession(socket);
        if (festivalId) emitPresence(festivalId, io);
      } catch (error: any) {
        log.error('disconnect cleanup error', {
          error: error.message,
          socketId: socket.id,
          userId: socket.data?.userId,
        });
      }
    });
  });

  return {};
}
