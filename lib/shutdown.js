'use strict';
/**
 * Background periodic tasks (session/avatar/token cleanup, memory monitoring)
 * and graceful shutdown handler.
 */
const fs = require('fs');

/**
 * Create background periodic timers — session cleanup, avatar orphan removal,
 * expired token purge, memory pressure monitoring.
 * @param {object} ctx - App context
 * @param {object} opts - { io } — Socket.IO instance (created after context)
 * @returns {void}
 */
function createBackgroundTasks(ctx, { io }) {
  const {
    config, state, stores, log, _pool,
    validateUserSession, disconnectSocket, emitPresence,
    getUsers, avatarDirPath,
  } = ctx;

  // ── Leader election for cleanup tasks (PM2 cluster mode) ──────────────────
  // PM2 sets NODE_APP_INSTANCE to '0'..'N-1'. Only instance 0 runs periodic
  // cleanup tasks to avoid redundant work across workers. In non-cluster mode
  // (NODE_APP_INSTANCE undefined), all tasks run normally.
  const instance = process.env.NODE_APP_INSTANCE;
  const isLeader = instance === undefined || instance === '0';

  if (!isLeader) {
    log.info('background tasks: not leader (instance !== 0), skipping cleanup timers', { instance });
    // Still register memory monitor on every worker (it's per-process)
    const _memoryCheckTimer = setInterval(() => {
      const mem = process.memoryUsage();
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      if (rssMB > config.MEMORY_WARNING_MB) {
        log.warn('high memory usage', {
          rssMB,
          heapMB,
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
          rateLimitEntries: state.rateLimits.size + state.routeRateLimits.size + state.authRateLimits.size + state.socketRateLimits.size,
          onlineRooms: state.onlineUsers.size,
          connections: io.engine?.clientsCount || 0,
        });
      }
    }, config.MEMORY_CHECK_INTERVAL_MS);
    _memoryCheckTimer.unref();
    state.timers.push(_memoryCheckTimer);
    return;
  }

  // Session cleanup — evict expired sessions and disconnect their sockets
  const _sessionCleanupTimer = setInterval(async () => {
    try {
      await stores.sessions.deleteExpiredUserSessions(config.SESSION_TTL);
      const presenceTargets = new Set();
      for (const socket of io.of('/').sockets.values()) {
        const sessionToken = socket.data?.userSessionToken;
        if (!sessionToken) continue;
        if (await validateUserSession(sessionToken)) continue;
        disconnectSocket(socket, io, presenceTargets);
      }
      for (const festivalId of presenceTargets) emitPresence(festivalId, io);
    } catch (err) {
      log.error('session cleanup failed', { error: err.message });
    }
  }, config.SESSION_CLEANUP_INTERVAL_MS);
  _sessionCleanupTimer.unref();
  state.timers.push(_sessionCleanupTimer);

  // Avatar orphan cleanup — remove avatar files without corresponding users (runs daily)
  const _avatarCleanupTimer = setInterval(async () => {
    try {
      const avatarDir = avatarDirPath();
      if (!fs.existsSync(avatarDir)) return;
      const files = fs.readdirSync(avatarDir);
      const users = await getUsers();
      const validAvatarKeys = new Set(users.map((u) => u.avatarKey).filter(Boolean));
      for (const file of files) {
        if (!file.endsWith('.webp')) continue;
        const avatarKey = file.replace(/\.webp$/, '');
        if (!validAvatarKeys.has(avatarKey)) {
          try {
            fs.unlinkSync(require('path').join(avatarDir, file));
            log.debug('orphan avatar removed', { avatarKey });
          } catch (err) {
            log.warn('failed to remove orphan avatar', { avatarKey, error: err.message });
          }
        }
      }
    } catch (err) {
      log.warn('avatar cleanup failed', { error: err.message });
    }
  }, 6 * 60 * 60 * 1000);
  _avatarCleanupTimer.unref();
  state.timers.push(_avatarCleanupTimer);

  // Expired token cleanup — purge password_reset_tokens and email_verification_tokens
  const _tokenCleanupTimer = setInterval(async () => {
    try {
      const { rowCount: resetPurged } = await stores.pool.query(
        `DELETE FROM password_reset_tokens WHERE expires_at < NOW()`
      );
      const { rowCount: verifyPurged } = await stores.pool.query(
        `DELETE FROM email_verification_tokens WHERE expires_at < NOW()`
      );
      const { rowCount: refreshPurged } = await stores.pool.query(
        'DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = TRUE'
      );
      if (resetPurged > 0 || verifyPurged > 0 || refreshPurged > 0) {
        log.info('token cleanup', { resetPurged, verifyPurged, refreshPurged });
      }
    } catch (err) {
      log.warn('token cleanup failed', { error: err.message });
    }
  }, 6 * 60 * 60 * 1000);
  _tokenCleanupTimer.unref();
  state.timers.push(_tokenCleanupTimer);

  // Audit log cleanup — purge entries older than retention threshold
  const _auditCleanupTimer = setInterval(async () => {
    try {
      const deleted = await stores.auditLog.cleanup(config.AUDIT_LOG_RETENTION_DAYS);
      if (deleted > 0) {
        log.info('audit log cleanup', { deleted, retentionDays: config.AUDIT_LOG_RETENTION_DAYS });
      }
    } catch (err) {
      log.warn('audit log cleanup failed', { error: err.message });
    }
  }, 6 * 60 * 60 * 1000);
  _auditCleanupTimer.unref();
  state.timers.push(_auditCleanupTimer);

  // Memory pressure monitoring — log warnings when heap grows large
  const _memoryCheckTimer = setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    if (rssMB > config.MEMORY_WARNING_MB) {
      log.warn('high memory usage', {
        rssMB,
        heapMB,
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rateLimitEntries: state.rateLimits.size + state.routeRateLimits.size + state.authRateLimits.size + state.socketRateLimits.size,
        onlineRooms: state.onlineUsers.size,
        connections: io.engine?.clientsCount || 0,
      });
    }
  }, config.MEMORY_CHECK_INTERVAL_MS);
  _memoryCheckTimer.unref();
  state.timers.push(_memoryCheckTimer);

  // Phase 1A: Reminder scheduler — fires FCM for upcoming set reminders
  if (ctx.reminderScheduler) {
    ctx.reminderScheduler.start();
    state.reminderScheduler = ctx.reminderScheduler;
    log.info('reminder scheduler registered with background tasks');
  }

  // Phase 1B: Meeting point expiry — deactivate expired points every 5 min
  const _meetingPointExpiryTimer = setInterval(async () => {
    try {
      if (stores.crews?.meetingPoints?.expireStale) {
        const { rowCount } = await stores.crews.meetingPoints.expireStale();
        if (rowCount > 0) log.debug('expired meeting points', { count: rowCount });
      }
    } catch (err) {
      log.warn('meeting point expiry failed', { error: err.message });
    }
  }, config.TOKEN_CLEANUP_INTERVAL_MS);
  _meetingPointExpiryTimer.unref();
  state.timers.push(_meetingPointExpiryTimer);
}

/**
 * Create the server close handler for graceful shutdown.
 * @param {object} opts
 * @returns {Function} close() — async function that drains connections and cleans up
 */
function createCloseHandler({ server, io, config, state, log, pool, redis, cacheBus, emitter, clearPresenceTimers, avatarPool, inFlightRequests, sentry }) {
  return async function close() {
    const closeStart = Date.now();
    const activeConnections = io.engine?.clientsCount || 0;
    log.info('closing server', {
      activeConnections,
      uptime: Math.round(process.uptime()),
      totalRequests: state.metrics.totalRequests,
    });

    clearPresenceTimers();
    for (const timer of state.timers) clearInterval(timer);
    if (state.reminderScheduler) {
      try { state.reminderScheduler.stop(); } catch { /* ignore */ }
    }

    // Flush any pending batched events before disconnecting sockets
    if (emitter?.flushAll) emitter.flushAll();

    // Stop accepting new HTTP connections
    if (server.listening) {
      server.close();
    }

    // Emit draining event to all connected sockets
    io.emit('server:draining', { message: 'Server is shutting down' });

    // Gracefully close sockets in batches
    const sockets = Array.from(io.of('/').sockets.values());
    const batchSize = config.DRAIN_BATCH_SIZE;
    const batchDelay = config.DRAIN_BATCH_DELAY_MS;

    for (let i = 0; i < sockets.length; i += batchSize) {
      const batch = sockets.slice(i, i + batchSize);
      for (const socket of batch) {
        socket.disconnect(true);
      }
      if (i + batchSize < sockets.length) {
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }

    // Close Socket.IO engine transports
    if (io.engine) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 2000);
        io.engine.close(() => { clearTimeout(timeout); resolve(); });
      });
    }

    // Wait for in-flight requests to complete (with timeout)
    const shutdownStart = Date.now();
    while (inFlightRequests.count > 0 && Date.now() - shutdownStart < config.SHUTDOWN_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (inFlightRequests.count > 0) {
      log.warn('shutdown timeout reached, closing with in-flight requests', {
        inFlightCount: inFlightRequests.count,
      });
    }

    // Clean up resources
    try {
      // admin_sessions cleanup removed — role-based auth uses user_sessions only
    } catch { /* ignore */ }

    if (sentry?.close) await sentry.close(2000);
    await pool.end();
    try { await avatarPool.terminate(); } catch { /* ignore */ }
    if (cacheBus) {
      try { await cacheBus.close(); } catch { /* ignore */ }
    }
    if (redis) {
      try { redis.disconnect(); } catch { /* ignore */ }
    }
    log.info('server closed', { durationMs: Date.now() - closeStart });
  };
}

module.exports = { createBackgroundTasks, createCloseHandler };
