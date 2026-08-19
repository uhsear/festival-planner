/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Festie Server — v3.0.0
 *
 * Orchestrator: creates app context, wires middleware, routes, sockets, and shutdown.
 * See lib/app-context.js for infrastructure setup and utility functions.
 *
 * ARCHITECTURE:
 *   server.ts ─── orchestrator (this file)
 *   lib/app-context.js ─── config, DB, Redis, caches, auth, sessions, utilities
 *   lib/middleware.js ──── Express middleware (security, CORS, parsing, metrics, rate limits)
 *   lib/socket-setup.js ─ Socket.IO server, Redis adapter, push notifications
 *   lib/shutdown.js ───── background tasks (cleanup timers) + graceful shutdown
 *   routes/pages.js ───── static pages, password reset forms, SPA catch-all
 *   routes/*.js ────────── API route modules (auth, profiles, crews, etc.)
 */

import 'dotenv/config';

import { loadConfig as _loadConfigEarly } from './lib/config';
const _bootConfig = _loadConfigEarly();

/**
 * True for Postgres "relation does not exist" (42P01) errors — the shape
 * the startup token purge hits when it races ahead of the background
 * migration runner (migrations apply async; the purge doesn't await them,
 * see lib/planner-db-pg.ts). Used to keep that benign, self-healing race
 * out of the warn-level boot log.
 */
function isMissingTableError(err: any): boolean {
  return !!err && err.code === '42P01';
}

/**
 * Startup configuration validator.
 * Fails fast on misconfiguration before any middleware/socket/DB init runs.
 * Called immediately after loadConfig() at boot time.
 */
function validateStartupConfig(config: any) {
  const isProd = config.NODE_ENV === 'production';

  // 1. Production requires PUBLIC_ORIGIN (cookies, CORS, absolute links all depend on it)
  if (isProd && !config.PUBLIC_ORIGIN) {
    throw new Error(
      'Startup validation failed: PUBLIC_ORIGIN is required in production. Set it in .env (e.g. https://festie.us).',
    );
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
      throw new Error(
        'Startup validation failed: SESSION_SECRET must be set to a strong random value in production (not empty, not "change-me").',
      );
    }
  }

  // 4. Production sender must be an on-brand festie.us address (never a personal
  //    or off-domain email).
  if (
    isProd &&
    typeof config.EMAIL_FROM === 'string' &&
    config.EMAIL_FROM.trim() !== '' &&
    !config.EMAIL_FROM.includes('@festie.us')
  ) {
    throw new Error(
      'Startup validation failed: EMAIL_FROM must use a festie.us sender address in production (e.g. "Festie <no-reply@festie.us>").',
    );
  }
}

validateStartupConfig(_bootConfig);

// Sentry. Position of this call is NOT what it looks like: this package is
// "type": "module", so every import in this file is hoisted and evaluated
// before any statement here runs. initSentry() therefore always runs AFTER
// express has been imported, and Sentry logs on every boot:
//   [Sentry] express is not instrumented …
//
// Measured 2026-08-18, so nobody re-derives it:
//   * Error capture still WORKS. setupExpressErrorHandler (see below) is a plain
//     express error middleware; a probe confirmed both route exceptions and
//     direct captureException produce events. Sentry is NOT blind.
//   * What is missing is the OpenTelemetry layer: tracing spans and per-request
//     isolation/context on those events.
//   * Sentry's documented ESM fix is `node --import ./instrument.mjs`. Both
//     moving init into an early-imported module AND `tsx --import ./instrument.ts`
//     were tried and neither silenced the warning — tsx installs its own ESM
//     loader, which appears to defeat Sentry's import-in-the-middle hooks. Do not
//     re-attempt either without new evidence; the blocker is tsx, not ordering.
import { initSentry, sentry } from './lib/sentry';
initSentry({ release: _bootConfig.APP_VERSION || 'dev' });

import { createAppContext, buildContentSecurityPolicy, collectInlineHashes, loadConfig } from './lib/app-context';
import { configureMiddleware } from './lib/middleware';
import { configureSocketIO } from './lib/socket-setup';
import { createBackgroundTasks, createCloseHandler } from './lib/shutdown';
import { createReminderScheduler } from './lib/reminder-scheduler';
import { createReengagementTriggers } from './lib/notifications/reengagement';
import { createReengagementQueue } from './lib/notifications/reengagement-queue';
import createPageRoutes from './routes/pages';
import { createLogger } from './lib/logger';
import {
  createMetrics,
  metricsMiddleware,
  metricsHandler,
  startMetricsSampler,
  startMetricsListener,
  startReengagementQueueSampler,
} from './lib/metrics';
import express from 'express';
import createAuthRoutes from './routes/auth';
import createEmailAuthRoutes from './routes/email-auth';
import createAccountRoutes from './routes/account';
import createAdminRoutes from './routes/admin';
import createFestivalRoutes from './routes/festivals';
import createProfileRoutes from './routes/profiles';
import createExportRoutes from './routes/export';
import createNotificationRoutes from './routes/notifications';
import createCrewRoutes from './routes/crews';
import createLineupImportRoutes from './routes/lineup-import';
import createShareRoutes from './routes/share';
import { createRatingsRoutes } from './routes/ratings';
import { createWeatherRoutes } from './routes/weather';
import createExpenseRoutes from './routes/expenses';
import createActivityRoutes from './routes/activity';
import createCalendarSyncRoutes, { createCalendarFeedRoute } from './routes/calendar-sync';
import createAnalyticsInstallRoutes from './routes/analytics-install';
import createClientMetricsRoutes from './routes/client-metrics';
import createSpotifyRoutes from './routes/spotify';
import createHealthRoutes from './routes/health';
import createSocketHandlers from './routes/socket';
import createDeepLinkRoutes from './routes/deep-links';

import type { Request, Response, NextFunction } from 'express';

const metrics = createMetrics();
const workerId =
  process.env.NODE_APP_INSTANCE !== undefined
    ? Number(process.env.NODE_APP_INSTANCE)
    : process.env.PM_ID !== undefined
      ? Number(process.env.PM_ID)
      : 0;
startMetricsListener(metrics, { basePort: 9400, workerId });

const log = createLogger();

async function createFestieApp(overrides: any = {}) {
  // 1. Create application context (config, DB, Redis, state, all utility functions)
  const ctx = await createAppContext({ ...overrides, promMetrics: metrics });
  const { config, state, pool, redis, cacheBus, avatarPool } = ctx;

  // Re-run startup validation against the fully-resolved app-context config
  // (overrides from tests/harness may have changed what the boot-time check saw).
  validateStartupConfig(config);

  // 2. Create Express app + configure all middleware
  const app = express();
  app.use(metricsMiddleware(metrics));
  app.get('/metrics', metricsHandler(metrics));
  const { inFlightRequests } = configureMiddleware(app, ctx);

  // 3. Build deps object for route modules
  const deps: any = {
    express,
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

  // M3 re-engagement triggers (event-gated push+email): lineup_drop / crew_reformed / wrap_ready.
  // The executor does the real fan-out (deduped, opt-out/DND-respecting). When Redis
  // is up it's wrapped by a durable BullMQ queue (issue #20) so triggers enqueue and
  // an in-process worker drains them in the background with retries + restart survival;
  // when Redis is down the dispatcher falls back to running the executor inline.
  const reengagementExecutor = createReengagementTriggers({
    stores: ctx.stores,
    config,
    log,
    notificationService,
  });
  const reengagementQueue = createReengagementQueue({
    executor: reengagementExecutor,
    log,
    redisUrl: config.REDIS_URL,
    enabled: config.REDIS_ENABLED,
    bullPrefix: `${config.REDIS_PREFIX || ''}bull`,
    promMetrics: metrics,
  });
  if (reengagementQueue) {
    log.info('reengagement: durable queue active (in-process worker)');
    // Start periodic queue-depth sampling (fp_reengagement_queue_depth gauge).
    // _queue is the raw BullMQ Queue instance exposed for instrumentation.
    startReengagementQueueSampler(metrics, reengagementQueue._queue).catch(() => {});
  }
  const reengagement = reengagementQueue || reengagementExecutor;
  deps.reengagement = reengagement;
  ctx.reengagement = reengagement; // also exposed to background tasks (wrap_ready sweep)
  ctx.reengagementQueue = reengagementQueue; // for graceful shutdown
  ctx.reengagementExecutor = reengagementExecutor; // inline path for the shutdown sweep

  // Phase 1A: Reminder scheduler for set notifications
  const reminderScheduler = createReminderScheduler({
    pool,
    stores: ctx.stores,
    notificationService,
    log,
    config,
  });
  ctx.reminderScheduler = reminderScheduler;
  deps.emitter = emitter;

  // 5. Mount route modules
  const authRoutes = createAuthRoutes(deps);
  const emailAuthRoutes = createEmailAuthRoutes(deps);
  const accountRoutes = createAccountRoutes(deps);
  const adminRoutes = createAdminRoutes(deps);
  const festivalRoutes = createFestivalRoutes(deps);
  const profileRoutes = createProfileRoutes(deps);
  const exportRoutes = createExportRoutes(deps);
  const notificationRoutes = createNotificationRoutes(deps);
  const crewRoutes = createCrewRoutes(deps);
  const lineupImportRoutes = createLineupImportRoutes(deps);
  const shareRoutes = createShareRoutes(deps);
  const ratingsRoutes = createRatingsRoutes(deps);
  const weatherRoutes = createWeatherRoutes(deps);
  const expenseRoutes = createExpenseRoutes(deps);
  const activityRoutes = createActivityRoutes(deps);
  const calendarSyncRoutes = createCalendarSyncRoutes(deps);
  const analyticsInstallRoutes = createAnalyticsInstallRoutes(deps);
  const clientMetricsRoutes = createClientMetricsRoutes(deps);
  const calendarFeedRoutes = createCalendarFeedRoute(deps);
  const spotifyRoutes = createSpotifyRoutes(deps);
  const healthRoutesModule = createHealthRoutes(deps);
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
  app.use('/api/v1/metrics', express.text({ type: '*/*', limit: '2kb' }), clientMetricsRoutes);
  app.use(calendarFeedRoutes);

  // Health & metrics (available at both /api/v1 and /api for load balancer probes)
  app.use('/api/v1', healthRoutes);
  app.use('/api', healthRoutes);

  app.use('/api', ((_req: Request, res: Response) => {
    ctx.sendError(res, 404, 'Not found', ctx.ErrorCodes.NOT_FOUND);
  }) as any);

  // Deep linking routes for iOS and Android
  const deepLinkRoutes = createDeepLinkRoutes(deps);
  app.use('/.well-known', deepLinkRoutes);

  // Page routes (join, reset, static pages, SPA catch-all)
  app.use(createPageRoutes(deps));

  // 6. Error handler with deduplication
  const _errorFingerprints = new Map<string, any>();
  const ERROR_DEDUP_WINDOW = config.ERROR_DEDUP_WINDOW;
  const ERROR_DEDUP_MAX = config.ERROR_DEDUP_MAX;
  const _errorDedupCleanup = setInterval(() => {
    const now = Date.now();
    for (const [fp, entry] of _errorFingerprints) {
      if (now - entry.firstSeen > ERROR_DEDUP_WINDOW) {
        if (entry.count > 1) {
          log.warn('deduplicated error summary', {
            fingerprint: fp,
            count: entry.count,
            message: entry.message,
            path: entry.path,
          });
        }
        _errorFingerprints.delete(fp);
      }
    }
  }, config.ERROR_DEDUP_CLEANUP_INTERVAL_MS);
  _errorDedupCleanup.unref();
  state.timers.push(_errorDedupCleanup);

  sentry.setupExpressErrorHandler(app);

  app.use(((error: any, req: Request, res: Response, _next: NextFunction) => {
    const status = error.status || error.statusCode || 500;

    if (status >= 500) {
      const fingerprint = `${status}:${error.message || 'unknown'}`;
      const existing = _errorFingerprints.get(fingerprint);
      if (existing) {
        existing.count += 1;
        if (existing.count % 10 === 0) {
          log.error('unhandled request error (repeated)', {
            error: error.message,
            method: req.method,
            path: req.path,
            reqId: (req as any).id,
            traceId: (req as any).traceId,
            status,
            repeatCount: existing.count,
          });
        }
      } else {
        if (_errorFingerprints.size >= ERROR_DEDUP_MAX) {
          const oldestKey = _errorFingerprints.keys().next().value;
          _errorFingerprints.delete(oldestKey!);
        }
        _errorFingerprints.set(fingerprint, {
          count: 1,
          firstSeen: Date.now(),
          message: error.message,
          path: req.path,
        });
        const meta: any = {
          error: error.message,
          method: req.method,
          path: req.path,
          reqId: (req as any).id,
          traceId: (req as any).traceId,
          status,
        };
        if (config.NODE_ENV !== 'production') meta.stack = error.stack;
        log.error('unhandled request error', meta);
      }
    } else {
      const meta: any = {
        error: error.message,
        method: req.method,
        path: req.path,
        reqId: (req as any).id,
        traceId: (req as any).traceId,
        status,
      };
      if (config.NODE_ENV !== 'production') meta.stack = error.stack;
      log.warn('request error', meta);
    }

    if (res.headersSent) return;
    const message = status < 500 ? error.message : 'Internal server error';
    const codeMap: Record<number, string> = {
      400: ctx.ErrorCodes.INVALID_INPUT,
      401: ctx.ErrorCodes.AUTH_REQUIRED,
      403: ctx.ErrorCodes.FORBIDDEN,
      404: ctx.ErrorCodes.NOT_FOUND,
      409: ctx.ErrorCodes.VERSION_MISMATCH,
      429: ctx.ErrorCodes.RATE_LIMITED,
    };
    const code = status >= 500 ? ctx.ErrorCodes.INTERNAL_ERROR : codeMap[status] || undefined;
    const details = config.NODE_ENV === 'production' ? null : { stack: error.stack };
    ctx.sendError(res, status, message, code, details);
  }) as any);

  // 7. Mount socket handlers
  createSocketHandlers(deps);

  // ── Startup token purge ──────────────────────────────────────────
  // Same leader-election guard as the periodic token cleanup in
  // createBackgroundTasks (lib/shutdown.ts): PM2 sets NODE_APP_INSTANCE to
  // '0'..'N-1', so only instance 0 (or non-cluster mode where it's undefined)
  // runs the boot-time purge — avoids N workers issuing identical DELETEs.
  const _purgeInstance = process.env.NODE_APP_INSTANCE;
  const _isPurgeLeader = _purgeInstance === undefined || _purgeInstance === '0';
  if (_isPurgeLeader) {
    Promise.all([
      pool.query('DELETE FROM password_reset_tokens WHERE expires_at < NOW()'),
      pool.query('DELETE FROM email_verification_tokens WHERE expires_at < NOW()'),
      pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = TRUE'),
    ])
      .then((purged: any[]) => {
        log.info('startup token purge completed', {
          resetTokens: purged[0].rowCount,
          verifyTokens: purged[1].rowCount,
          refreshTokens: purged[2].rowCount,
        });
      })
      .catch((err: any) => {
        // Migrations run asynchronously in the background (see the
        // `migrationsReady` promise in lib/planner-db-pg.ts) and this purge
        // does not wait on them, so on a fresh boot it can race ahead of the
        // migration that creates these tables. That's expected and
        // self-heals on the very next boot — not a real failure, so don't
        // warn. Anything else (bad connection, permissions, etc.) is real.
        if (isMissingTableError(err)) {
          log.info('startup token purge skipped: table not ready yet', { error: err.message });
          return;
        }
        log.warn('startup token purge failed', { error: err.message });
      });
  }

  // 8. Background tasks (session/avatar/token cleanup, memory monitoring)
  createBackgroundTasks(ctx, { io });
  startMetricsSampler(metrics, { pool, io }, 10_000);

  // 9. Graceful shutdown handler
  const close = createCloseHandler({
    server,
    io,
    config,
    state,
    log,
    pool,
    redis,
    cacheBus,
    emitter,
    clearPresenceTimers: ctx.clearPresenceTimers,
    avatarPool,
    inFlightRequests,
    sentry,
    reengagementQueue,
  });

  return { app, server, io, config, state, close, setHealthReady };
}

// ── Main entry point ──────────────────────────────────────────────────────
const isMainModule = import.meta.filename === process.argv[1] || process.argv[1]?.endsWith('server.ts');

if (isMainModule) {
  const planner = await createFestieApp();
  let shuttingDown = false;

  const shutdown = (signal: string, error: any = null) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const meta: any = {
      signal,
      uptime: Math.round(process.uptime()),
      connections: (planner.io as any)?.engine?.clientsCount || 0,
      totalRequests: planner.state?.metrics?.totalRequests || 0,
    };
    log.info('shutdown initiated', meta);
    if (error) {
      const errMeta: any = { signal, error: error.message, stack: error.stack };
      if (error.code) errMeta.code = error.code;
      log.error('shutdown error', errMeta);
    }
    // Must exceed the graceful-drain budget (SHUTDOWN_TIMEOUT_MS) plus the other
    // bounded waits inside close() (io.engine close ~2s, sentry.close ~2s) so a
    // longer-than-default SHUTDOWN_TIMEOUT_MS can't get cut off mid-drain.
    const forceExitTimer = setTimeout(() => process.exit(1), planner.config.SHUTDOWN_TIMEOUT_MS + 10_000);
    forceExitTimer.unref();
    planner
      .close()
      .then(() => process.exit(0))
      .catch((err: any) => {
        log.error('shutdown unclean', { error: err.message });
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGQUIT', () => shutdown('SIGQUIT'));
  process.on('uncaughtException', (error) => shutdown('UNCAUGHT_EXCEPTION', error));
  // DELIBERATE fail-fast policy: an unhandled promise rejection means the
  // worker has reached an unknown/inconsistent state, so we intentionally tear
  // it down via the graceful-shutdown path rather than swallowing the error and
  // continuing. PM2 (cluster) or the process supervisor restarts a clean worker,
  // and the load balancer drains the dying one. Do NOT "soften" this to a
  // log-and-continue — keeping a process alive after an unhandled rejection
  // risks serving corrupted state. Keep bringing the worker down.
  process.on('unhandledRejection', (error) => shutdown('UNHANDLED_REJECTION', error));
  process.on('warning', (warning) => {
    log.warn('node process warning', {
      name: warning.name,
      message: warning.message,
      code: (warning as any).code,
      stack: warning.stack,
    });
  });

  async function listenWithRetry(server: any, port: number, host: string, maxRetries = 5, initialDelay = 1000) {
    const isCluster = typeof process.send === 'function';

    async function attemptListen() {
      if (server.listening) {
        log.warn('server already listening, skipping listen call', { port, host });
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const onError = (err: any) => {
          server.removeListener('listening', onSuccess);
          reject(err);
        };
        const onSuccess = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onSuccess);
        server.listen(port, host);
      });
      log.info('server started', { bind: host, port, origin: planner.config.PUBLIC_ORIGIN || 'not set' });
      if (planner.setHealthReady) planner.setHealthReady(true);
      if (isCluster) process.send!('ready');
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
      } catch (error: any) {
        if (error.code === 'EADDRINUSE') {
          retries++;
          if (retries >= maxRetries) {
            log.error('max retries exceeded for EADDRINUSE', { port, host, retries });
            throw error;
          }
          log.warn('port in use, retrying', { port, host, retries, delay_ms: currentDelay });
          await new Promise<void>((resolve) => setTimeout(resolve, currentDelay));
          currentDelay *= 2;
        } else {
          throw error;
        }
      }
    }
  }

  listenWithRetry(planner.server, planner.config.PORT, planner.config.BIND_ADDRESS).catch((error: any) => {
    log.error('failed to start server', { error: error.message, code: error.code });
    shutdown('LISTEN_ERROR', error);
  });
}

export {
  buildContentSecurityPolicy,
  collectInlineHashes,
  createFestieApp,
  createFestieApp as createFestivalPlanner, // backward compat alias
  isMissingTableError,
  loadConfig,
  validateStartupConfig,
};
