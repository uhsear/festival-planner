/**
 * Background periodic tasks (session/avatar/token cleanup, memory monitoring)
 * and graceful shutdown handler.
 */
import fs from 'fs';
import path from 'path';

/**
 * Create background periodic timers — session cleanup, avatar orphan removal,
 * expired token purge, memory pressure monitoring.
 */
function createBackgroundTasks(ctx: any, { io }: any) {
  const {
    config,
    state,
    stores,
    log,
    _pool,
    validateUserSession,
    disconnectSocket,
    emitPresence,
    getUsers,
    avatarDirPath,
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
          rateLimitEntries:
            state.rateLimits.size +
            state.routeRateLimits.size +
            state.authRateLimits.size +
            state.socketRateLimits.size,
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
      const presenceTargets = new Set<string>();
      for (const socket of io.of('/').sockets.values()) {
        const sessionToken = socket.data?.userSessionToken;
        if (!sessionToken) continue;
        if (await validateUserSession(sessionToken)) continue;
        disconnectSocket(socket, io, presenceTargets);
      }
      for (const festivalId of presenceTargets) emitPresence(festivalId, io);
    } catch (err: any) {
      log.error('session cleanup failed', { error: err.message });
    }
  }, config.SESSION_CLEANUP_INTERVAL_MS);
  _sessionCleanupTimer.unref();
  state.timers.push(_sessionCleanupTimer);

  // Avatar orphan cleanup — remove avatar files without corresponding users (runs daily)
  const _avatarCleanupTimer = setInterval(
    async () => {
      try {
        const avatarDir = avatarDirPath();
        if (!fs.existsSync(avatarDir)) return;
        const files = fs.readdirSync(avatarDir);
        const users = await getUsers();
        const validAvatarKeys = new Set(users.map((u: any) => u.avatarKey).filter(Boolean));
        for (const file of files) {
          if (!file.endsWith('.webp')) continue;
          const avatarKey = file.replace(/\.webp$/, '');
          if (!validAvatarKeys.has(avatarKey)) {
            try {
              fs.unlinkSync(path.join(avatarDir, file));
              log.debug('orphan avatar removed', { avatarKey });
            } catch (err: any) {
              log.warn('failed to remove orphan avatar', { avatarKey, error: err.message });
            }
          }
        }
      } catch (err: any) {
        log.warn('avatar cleanup failed', { error: err.message });
      }
    },
    6 * 60 * 60 * 1000,
  );
  _avatarCleanupTimer.unref();
  state.timers.push(_avatarCleanupTimer);

  // Expired token cleanup — purge password_reset_tokens and email_verification_tokens
  const _tokenCleanupTimer = setInterval(
    async () => {
      try {
        const { rowCount: resetPurged } = await stores.pool.query(
          `DELETE FROM password_reset_tokens WHERE expires_at < NOW()`,
        );
        const { rowCount: verifyPurged } = await stores.pool.query(
          `DELETE FROM email_verification_tokens WHERE expires_at < NOW()`,
        );
        const { rowCount: refreshPurged } = await stores.pool.query(
          'DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = TRUE',
        );
        if (resetPurged > 0 || verifyPurged > 0 || refreshPurged > 0) {
          log.info('token cleanup', { resetPurged, verifyPurged, refreshPurged });
        }
      } catch (err: any) {
        log.warn('token cleanup failed', { error: err.message });
      }
    },
    6 * 60 * 60 * 1000,
  );
  _tokenCleanupTimer.unref();
  state.timers.push(_tokenCleanupTimer);

  // Audit log cleanup — purge entries older than retention threshold
  const _auditCleanupTimer = setInterval(
    async () => {
      try {
        const deleted = await stores.auditLog.cleanup(config.AUDIT_LOG_RETENTION_DAYS);
        if (deleted > 0) {
          log.info('audit log cleanup', { deleted, retentionDays: config.AUDIT_LOG_RETENTION_DAYS });
        }
      } catch (err: any) {
        log.warn('audit log cleanup failed', { error: err.message });
      }
    },
    6 * 60 * 60 * 1000,
  );
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
        rateLimitEntries:
          state.rateLimits.size + state.routeRateLimits.size + state.authRateLimits.size + state.socketRateLimits.size,
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
    } catch (err: any) {
      log.warn('meeting point expiry failed', { error: err.message });
    }
  }, config.TOKEN_CLEANUP_INTERVAL_MS);
  _meetingPointExpiryTimer.unref();
  state.timers.push(_meetingPointExpiryTimer);

  // M3 wrap_ready sweep — there is no in-request "festival became over" event, so
  // a leader-only periodic sweep is the clearest available trigger (see roadmap
  // M3: "wire it where a festival transitions to over OR expose it for a
  // post-festival job"). We scan only festivals whose final day ended in a recent
  // window (cheap) and call sendWrapReady per festival; the trigger's
  // once-per-event-per-user dedup (notification_log eventKey) makes repeated
  // sweeps idempotent, so an exact transition moment isn't required.
  // NOTE: a dedicated scheduler/queue would be better at scale (this is a simple
  // hourly interval, leader-gated); kept minimal per the additive M3 scope.
  if (ctx.reengagement?.sendWrapReady) {
    const WRAP_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
    const runWrapSweep = async () => {
      try {
        // Festivals whose max day date is in [now-3d, now] — recently over.
        const { rows } = await stores.pool.query(`
          SELECT f.id
          FROM festivals f
          WHERE f.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM festival_days d WHERE d.festival_id = f.id)
            AND (SELECT MAX(d.date) FROM festival_days d WHERE d.festival_id = f.id)
                BETWEEN (CURRENT_DATE - INTERVAL '3 days')::text AND CURRENT_DATE::text
        `);
        for (const r of rows) {
          try {
            await ctx.reengagement.sendWrapReady(r.id);
          } catch (err: any) {
            log.debug('wrap_ready sweep: per-festival send failed', { festivalId: r.id, error: err.message });
          }
        }
        if (rows.length > 0) log.debug('wrap_ready sweep complete', { festivals: rows.length });
      } catch (err: any) {
        log.warn('wrap_ready sweep failed', { error: err.message });
      }
    };
    const _wrapReadyTimer = setInterval(runWrapSweep, WRAP_SWEEP_INTERVAL_MS);
    _wrapReadyTimer.unref();
    state.timers.push(_wrapReadyTimer);
    log.info('wrap_ready sweep registered (hourly, leader-only)');
  }
}

/**
 * Create the server close handler for graceful shutdown.
 */
function createCloseHandler({
  server,
  io,
  config,
  state,
  log,
  pool,
  redis,
  cacheBus,
  emitter,
  clearPresenceTimers,
  avatarPool,
  inFlightRequests,
  sentry,
}: any) {
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
      try {
        state.reminderScheduler.stop();
      } catch {
        /* ignore */
      }
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
        (socket as any).disconnect(true);
      }
      if (i + batchSize < sockets.length) {
        await new Promise((resolve) => setTimeout(resolve, batchDelay));
      }
    }

    // Close Socket.IO engine transports
    if (io.engine) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2000);
        io.engine.close(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    // Wait for in-flight requests to complete (with timeout)
    const shutdownStart = Date.now();
    while (inFlightRequests.count > 0 && Date.now() - shutdownStart < config.SHUTDOWN_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (inFlightRequests.count > 0) {
      log.warn('shutdown timeout reached, closing with in-flight requests', {
        inFlightCount: inFlightRequests.count,
      });
    }

    if (sentry?.close) await sentry.close(2000);
    await pool.end();
    try {
      await avatarPool.terminate();
    } catch {
      /* ignore */
    }
    if (cacheBus) {
      try {
        await cacheBus.close();
      } catch {
        /* ignore */
      }
    }
    if (redis) {
      try {
        redis.disconnect();
      } catch {
        /* ignore */
      }
    }
    log.info('server closed', { durationMs: Date.now() - closeStart });
  };
}

export { createBackgroundTasks, createCloseHandler };
