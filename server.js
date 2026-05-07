/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Festie Server — v3.0.0
 *
 * Orchestrator: creates app context, wires middleware, routes, sockets, and shutdown.
 * See lib/app-context.js for infrastructure setup and utility functions.
 *
 * ARCHITECTURE:
 *   server.js ─── orchestrator (this file)
 *   lib/app-context.js ─── config, DB, Redis, caches, auth, sessions, utilities
 *   lib/middleware.js ──── Express middleware (security, CORS, parsing, metrics, rate limits)
 *   lib/socket-setup.js ─ Socket.IO server, Redis adapter, push notifications
 *   lib/shutdown.js ───── background tasks (cleanup timers) + graceful shutdown
 *   routes/pages.js ───── static pages, password reset forms, SPA catch-all
 *   routes/*.js ────────── API route modules (auth, profiles, crews, etc.)
 */

require('dotenv').config();

const { loadConfig: _loadConfigEarly } = require('./lib/config');
const _bootConfig = _loadConfigEarly();

/**
 * Startup configuration validator.
 * Fails fast on misconfiguration before any middleware/socket/DB init runs.
 * Called immediately after loadConfig() at boot time.
 */
function validateStartupConfig(config) {
  const isProd = config.NODE_ENV === 'production';

  // 1. Production requires PUBLIC_ORIGIN (cookies, CORS, absolute links all depend on it)
  if (isProd && !config.PUBLIC_ORIGIN) {
    throw new Error('Startup validation failed: PUBLIC_ORIGIN is required in production. Set it in .env (e.g. https://festie.us).');
  }

  // 2. FCM retry webhook requires an HMAC key to sign payloads
  if (config.FCM_RETRY_WEBHOOK_URL && !config.WEBHOOK_TOKEN_HMAC_KEY) {
    throw new Error('Startup validation failed: WEBHOOK_TOKEN_HMAC_KEY is required when FCM_RETRY_WEBHOOK_URL is set.');
  }

  // 3. Production must not ship weak/default SESSION_SECRET (only enforced when key exists on config).
  // NOTE: SESSION_SECRET is not currently used for HMAC signing — session tokens are opaque random
  // strings hashed with SHA-256 server-side. This check ensures the key is pre-provisioned so
  // HMAC-signed sessions can be introduced without a redeployment. See ADR-004.
  if (isProd && Object.prototype.hasOwnProperty.call(config, 'SESSION_SECRET')) {
    if (!config.SESSION_SECRET || config.SESSION_SECRET === 'change-me') {
      throw new Error('Startup validation failed: SESSION_SECRET must be set to a strong random value in production (not empty, not "change-me").');
    }
  }

  // 4. Production must not ship a personal email as sender
  if (isProd && typeof config.EMAIL_FROM === 'string' && config.EMAIL_FROM.includes('uhsear@gmail.com')) {
    throw new Error('Startup validation failed: EMAIL_FROM must not use a personal email (uhsear@gmail.com) in production. Use Festie <no-reply@festie.us> or similar.');
  }
}

validateStartupConfig(_bootConfig);

const { initSentry, sentry } = require('./lib/sentry');
initSentry({ release: _bootConfig.APP_VERSION || 'dev' });

const { createAppContext, buildContentSecurityPolicy, collectInlineHashes, loadConfig } = require('./lib/app-context');
const { configureMiddleware } = require('./lib/middleware');
const { configureSocketIO } = require('./lib/socket-setup');
const { createBackgroundTasks, createCloseHandler } = require('./lib/shutdown');
const { createReminderScheduler } = require('./lib/reminder-scheduler');
const createPageRoutes = require('./routes/pages');
const { createLogger } = require('./lib/logger');
const { createMetrics, metricsMiddleware, metricsHandler, startMetricsSampler, startMetricsListener } = require('./lib/metrics');
const metrics = createMetrics();
const workerId = process.env.NODE_APP_INSTANCE !== undefined
  ? Number(process.env.NODE_APP_INSTANCE)
  : (process.env.PM_ID !== undefined ? Number(process.env.PM_ID) : 0);
startMetricsListener(metrics, { basePort: 9400, workerId });

const log = createLogger();

function createFestieApp(overrides = {}) {
  // 1. Create application context (config, DB, Redis, state, all utility functions)
  const ctx = createAppContext({ ...overrides, promMetrics: metrics });
  const { config, state, _stores, pool, redis, cacheBus, avatarPool } = ctx;

  // Re-run startup validation against the fully-resolved app-context config
  // (overrides from tests/harness may have changed what the boot-time check saw).
  validateStartupConfig(config);

  // 2. Create Express app + configure all middleware
  const app = require('express')();
  app.use(sentry.requestHandler());
  app.use(metricsMiddleware(metrics));
  app.get('/metrics', metricsHandler(metrics));
  const { inFlightRequests } = configureMiddleware(app, ctx);

  // 3. Build deps object for route modules
  const deps = {
    express: require('express'),
    ...ctx,
    io: null, // Set after Socket.IO creation
    metrics: state.metrics,
    promMetrics: metrics,
  };

  // 4. Create HTTP server + Socket.IO
  const { server, io, emitter, notificationService } = configureSocketIO(app, ctx);
  ctx.setIO(io);
  deps.io = io;
  deps.redis = redis;
  deps.redisCircuitBreaker = ctx.redisCircuitBreaker;
  deps.redisPresence = ctx.redisPresence;
  deps.redisRateLimiter = ctx.redisRateLimiter;
  deps.setSocketPresence = ctx.setSocketPresence;
  deps.cacheBus = cacheBus;
  deps.notificationService = notificationService;

  // Phase 1A: Reminder scheduler for set notifications
  const reminderScheduler = createReminderScheduler({
    pool, stores: ctx.stores, notificationService, log, config,
  });
  ctx.reminderScheduler = reminderScheduler;
  deps.emitter = emitter;

  // 5. Mount route modules
  const authRoutes = require('./routes/auth')(deps);
  const emailAuthRoutes = require('./routes/email-auth')(deps);
  const accountRoutes = require('./routes/account')(deps);
  const adminRoutes = require('./routes/admin')(deps);
  const festivalRoutes = require('./routes/festivals')(deps);
  const profileRoutes = require('./routes/profiles')(deps);
  const exportRoutes = require('./routes/export')(deps);
  const notificationRoutes = require('./routes/notifications')(deps);
  const crewRoutes = require('./routes/crews')(deps);
  const lineupImportRoutes = require('./routes/lineup-import')(deps);
  const shareRoutes = require('./routes/share')(deps);
  const { createRatingsRoutes } = require('./routes/ratings');
  const ratingsRoutes = createRatingsRoutes(deps);
  const { createWeatherRoutes } = require('./routes/weather');
  const weatherRoutes = createWeatherRoutes(deps);
  const createExpenseRoutes = require('./routes/expenses');
  const expenseRoutes = createExpenseRoutes(deps);
  const createActivityRoutes = require('./routes/activity');
  const activityRoutes = createActivityRoutes(deps);
  const createCalendarSyncRoutes = require('./routes/calendar-sync');
  const calendarSyncRoutes = createCalendarSyncRoutes(deps);
  const createAnalyticsInstallRoutes = require('./routes/analytics-install');
  const analyticsInstallRoutes = createAnalyticsInstallRoutes(deps);
  const clientMetricsRoutes = require('./routes/client-metrics')(deps);
  const { createCalendarFeedRoute } = require('./routes/calendar-sync');
  const calendarFeedRoutes = createCalendarFeedRoute(deps);
  const spotifyRoutes = require('./routes/spotify')(deps);
  const healthRoutesModule = require('./routes/health')(deps);
  const healthRoutes = healthRoutesModule.router;
  const setHealthReady = healthRoutesModule.setReady;

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/auth', emailAuthRoutes);
  app.use('/api/v1/account', accountRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/admin/festivals', deps.adminAuth, festivalRoutes);
  app.use('/api/v1/admin/festivals', deps.adminAuth, lineupImportRoutes);
  app.use('/api/v1/festivals', festivalRoutes);
  app.use('/api/v1/profiles', profileRoutes);
  app.use('/api/v1', exportRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
  app.use('/api/v1', spotifyRoutes);
  app.use('/api/v1/crews', crewRoutes);
  app.use('/s', shareRoutes);
  app.use('/api/v1/ratings', ratingsRoutes);
  app.use('/api/v1/weather', weatherRoutes);
  app.use('/api/v1', expenseRoutes);
  app.use('/api/v1', activityRoutes);
  app.use('/api/v1', calendarSyncRoutes);
  app.use('/api/v1/analytics', analyticsInstallRoutes);
  app.use('/api/v1/metrics', deps.express.text({ type: '*/*', limit: '2kb' }), clientMetricsRoutes);
  app.use(calendarFeedRoutes);

  // Health & metrics (available at both /api/v1 and /api for load balancer probes)
  app.use('/api/v1', healthRoutes);
  app.use('/api', healthRoutes);

  app.use('/api', (_req, res) => {
    ctx.sendError(res, 404, 'Not found', ctx.ErrorCodes.NOT_FOUND);
  });

  // Deep linking routes for iOS and Android
  const deepLinkRoutes = require('./routes/deep-links')(deps);
  app.use('/.well-known', deepLinkRoutes);

  // Page routes (join, reset, static pages, SPA catch-all)
  app.use(createPageRoutes(deps));

  // 6. Error handler with deduplication
  const _errorFingerprints = new Map();
  const ERROR_DEDUP_WINDOW = 60_000;
  const ERROR_DEDUP_MAX = 500;
  const _errorDedupCleanup = setInterval(() => {
    const now = Date.now();
    for (const [fp, entry] of _errorFingerprints) {
      if (now - entry.firstSeen > ERROR_DEDUP_WINDOW) {
        if (entry.count > 1) {
          log.warn('deduplicated error summary', {
            fingerprint: fp, count: entry.count, message: entry.message, path: entry.path,
          });
        }
        _errorFingerprints.delete(fp);
      }
    }
  }, 30_000);
  _errorDedupCleanup.unref();
  state.timers.push(_errorDedupCleanup);

  app.use(sentry.errorHandler());

  app.use((error, req, res, _next) => {
    const status = error.status || error.statusCode || 500;

    if (status >= 500) {
      const fingerprint = `${status}:${error.message || 'unknown'}`;
      const existing = _errorFingerprints.get(fingerprint);
      if (existing) {
        existing.count += 1;
        if (existing.count % 10 === 0) {
          log.error('unhandled request error (repeated)', {
            error: error.message, method: req.method, path: req.path,
            reqId: req.id, traceId: req.traceId, status, repeatCount: existing.count,
          });
        }
      } else {
        if (_errorFingerprints.size >= ERROR_DEDUP_MAX) {
          const oldestKey = _errorFingerprints.keys().next().value;
          _errorFingerprints.delete(oldestKey);
        }
        _errorFingerprints.set(fingerprint, {
          count: 1, firstSeen: Date.now(), message: error.message, path: req.path,
        });
        const meta = { error: error.message, method: req.method, path: req.path, reqId: req.id, traceId: req.traceId, status };
        if (config.NODE_ENV !== 'production') meta.stack = error.stack;
        log.error('unhandled request error', meta);
      }
    } else {
      const meta = { error: error.message, method: req.method, path: req.path, reqId: req.id, traceId: req.traceId, status };
      if (config.NODE_ENV !== 'production') meta.stack = error.stack;
      log.warn('request error', meta);
    }

    if (res.headersSent) return;
    const message = status < 500 ? error.message : 'Internal server error';
    const codeMap = { 400: ctx.ErrorCodes.INVALID_INPUT, 401: ctx.ErrorCodes.AUTH_REQUIRED, 403: ctx.ErrorCodes.FORBIDDEN, 404: ctx.ErrorCodes.NOT_FOUND, 409: ctx.ErrorCodes.VERSION_MISMATCH, 429: ctx.ErrorCodes.RATE_LIMITED };
    const code = status >= 500 ? ctx.ErrorCodes.INTERNAL_ERROR : (codeMap[status] || undefined);
    const details = config.NODE_ENV === 'production' ? null : { stack: error.stack };
    ctx.sendError(res, status, message, code, details);
  });

  // 7. Mount socket handlers
  require('./routes/socket')(deps);

  // ── Startup token purge ──────────────────────────────────────────
  Promise.all([
    pool.query("DELETE FROM password_reset_tokens WHERE expires_at < NOW()"),
    pool.query("DELETE FROM email_verification_tokens WHERE expires_at < NOW()"),
    pool.query("DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = TRUE"),
  ]).then(purged => {
    log.info("startup token purge completed", {
      resetTokens: purged[0].rowCount,
      verifyTokens: purged[1].rowCount,
      refreshTokens: purged[2].rowCount,
    });
  }).catch(err => {
    log.warn("startup token purge failed", { error: err.message });
  });

  // 8. Background tasks (session/avatar/token cleanup, memory monitoring)
  createBackgroundTasks(ctx, { io });
  startMetricsSampler(metrics, { pool, io }, 10_000);

  // 9. Graceful shutdown handler
  const close = createCloseHandler({
    server, io, config, state, log, pool, redis, cacheBus, emitter,
    clearPresenceTimers: ctx.clearPresenceTimers,
    avatarPool, inFlightRequests, sentry,
  });

  return { app, server, io, config, state, close, setHealthReady };
}

// ── Main entry point ──────────────────────────────────────────────────────
if (require.main === module) {
  const planner = createFestieApp();
  let shuttingDown = false;

  const shutdown = (signal, error = null) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const meta = {
      signal,
      uptime: Math.round(process.uptime()),
      connections: planner.io?.engine?.clientsCount || 0,
      totalRequests: planner.state?.metrics?.totalRequests || 0,
    };
    log.info('shutdown initiated', meta);
    if (error) {
      const errMeta = { signal, error: error.message, stack: error.stack };
      if (error.code) errMeta.code = error.code;
      log.error('shutdown error', errMeta);
    }
    const forceExitTimer = setTimeout(() => process.exit(1), 33_000);
    forceExitTimer.unref();
    planner
      .close()
      .then(() => process.exit(0))
      // eslint-disable-next-line no-shadow
      .catch((error) => {
        log.error('shutdown unclean', { error: error.message });
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGQUIT', () => shutdown('SIGQUIT'));
  process.on('uncaughtException', (error) => shutdown('UNCAUGHT_EXCEPTION', error));
  process.on('unhandledRejection', (error) => shutdown('UNHANDLED_REJECTION', error));
  process.on('warning', (warning) => {
    log.warn('node process warning', {
      name: warning.name,
      message: warning.message,
      code: warning.code,
      stack: warning.stack,
    });
  });

  async function listenWithRetry(server, port, host, maxRetries = 5, initialDelay = 1000) {
    const isCluster = typeof process.send === 'function';

    async function attemptListen() {
      if (server.listening) {
        log.warn('server already listening, skipping listen call', { port, host });
        return;
      }
      await new Promise((resolve, reject) => {
        const onError = (err) => { server.removeListener('listening', onSuccess); reject(err); };
        const onSuccess = () => { server.removeListener('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onSuccess);
        server.listen(port, host);
      });
      log.info('server started', { bind: host, port, origin: planner.config.PUBLIC_ORIGIN || 'not set' });
      if (planner.setHealthReady) planner.setHealthReady(true);
      if (isCluster) process.send('ready');
    }

    if (isCluster) {
      await attemptListen();
      return;
    }

    let retries = 0;
    let currentDelay = initialDelay;
    while (retries < maxRetries) {
      try {
        await attemptListen();
        return;
      } catch (error) {
        if (error.code === 'EADDRINUSE') {
          retries++;
          if (retries >= maxRetries) {
            log.error('max retries exceeded for EADDRINUSE', { port, host, retries });
            throw error;
          }
          log.warn('port in use, retrying', { port, host, retries, delay_ms: currentDelay });
          await new Promise(resolve => setTimeout(resolve, currentDelay));
          currentDelay *= 2;
        } else {
          throw error;
        }
      }
    }
  }

  listenWithRetry(planner.server, planner.config.PORT, planner.config.BIND_ADDRESS).catch((error) => {
    log.error('failed to start server', { error: error.message, code: error.code });
    shutdown('LISTEN_ERROR', error);
  });
}

module.exports = {
  buildContentSecurityPolicy,
  collectInlineHashes,
  createFestieApp,
  createFestivalPlanner: createFestieApp, // backward compat alias
  loadConfig,
  validateStartupConfig,
};
