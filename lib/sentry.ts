/**
 * Sentry initialization wrapper — optional and safe.
 *
 * If @sentry/node is not installed OR SENTRY_DSN is unset, this becomes a
 * no-op and the exported `sentry` object mirrors the public API with stubs.
 */

import { createRequire } from 'module';
import { loadConfig } from './config.js';

const _cfg = loadConfig();
const _require = createRequire(import.meta.url);

let Sentry: any = null;
let initialized = false;
let noop = true;

function initSentry(options: any = {}) {
  if (initialized) return Sentry;
  initialized = true;

  const dsn = options.dsn || _cfg.SENTRY_DSN;
  if (!dsn) {

    console.warn('[sentry] SENTRY_DSN not set — Sentry disabled (no-op mode)');
    noop = true;
    return null;
  }

  try {

    Sentry = _require('@sentry/node');
  } catch {

    console.warn('[sentry] @sentry/node not installed — Sentry disabled (no-op mode)');
    noop = true;
    Sentry = null;
    return null;
  }

  try {
    Sentry.init({
      dsn,
      environment: options.environment || _cfg.NODE_ENV || 'production',
      release: options.release || _cfg.APP_VERSION || 'dev',
      tracesSampleRate: Number(_cfg.SENTRY_TRACES_RATE ?? 0.05),
      profilesSampleRate: Number(_cfg.SENTRY_PROFILES_RATE ?? 0),
      sendDefaultPii: false,
      beforeSend(event: any) {
        // Strip obvious PII paths
        if (event.request && event.request.headers) {
          delete event.request.headers.cookie;
          delete event.request.headers.authorization;
        }
        return event;
      },
      ...options.extra,
    });
    noop = false;
    console.debug('[sentry] initialized', { env: options.environment || _cfg.NODE_ENV, release: options.release || _cfg.APP_VERSION });
    return Sentry;
  } catch (err: any) {

    console.warn('[sentry] init failed — no-op mode', err.message);
    Sentry = null;
    noop = true;
    return null;
  }
}

const sentry = {
  get available() { return !noop && Sentry !== null; },
  captureException(err: any, context?: any) {
    if (noop || !Sentry) return;
    try { Sentry.captureException(err, context); } catch { /* noop */ }
  },
  captureMessage(msg: string, level = 'info') {
    if (noop || !Sentry) return;
    try { Sentry.captureMessage(msg, level); } catch { /* noop */ }
  },
  setUser(user: any) {
    if (noop || !Sentry) return;
    try { Sentry.setUser(user); } catch { /* noop */ }
  },
  setTag(key: string, value: any) {
    if (noop || !Sentry) return;
    try { Sentry.setTag(key, value); } catch { /* noop */ }
  },
  /**
   * Per-request isolation scope. No-op passthrough when Sentry is disabled.
   *
   * Sentry's Node httpIntegration normally creates one isolation scope per
   * request automatically, via import-in-the-middle patching of `http`. tsx
   * installs its own ESM loader that defeats that patching (see server.ts),
   * so nothing else does this here — without it, concurrent requests would
   * read/write the SAME scope and bleed tags/user into each other's events.
   * `withIsolationScope`/`getIsolationScope` only need AsyncLocalStorage,
   * which tsx does NOT break, so this still isolates correctly per request.
   *
   * Mount FIRST in the middleware chain (see lib/middleware.ts) so its
   * wrapped `next()` covers every later middleware, route, and the error
   * handler below.
   */
  requestScope() {
    return (_req: any, _res: any, next: any) => {
      if (noop || !Sentry) return next();
      Sentry.withIsolationScope(() => next());
    };
  },
  /**
   * Wires Sentry's Express request+error capture directly onto `app` (no-op
   * if Sentry is unavailable). @sentry/node v8+ removed `Sentry.Handlers` —
   * the SDK now exposes a single `setupExpressErrorHandler(app)` that calls
   * `app.use()` itself, so this takes `app` rather than returning a
   * middleware for the caller to `.use()`. Call once, after all routes are
   * mounted and before any other error-handling middleware.
   *
   * Also mounts an error-handling middleware, just before Sentry's own, that
   * attaches request attribution to the isolation scope opened by
   * requestScope() above: an opaque user id (never email/username/IP), the
   * request id + trace id, the route PATTERN (req.route.path — not the raw
   * URL, which may contain ids), and the HTTP method. Reading these off
   * `req` here (at error time) rather than eagerly means req.user is
   * already set for authenticated routes (userAuth/adminAuth run earlier,
   * before an error can reach this handler) and req.route is already
   * matched.
   */
  setupExpressErrorHandler(app: any) {
    if (noop || !Sentry || typeof Sentry.setupExpressErrorHandler !== 'function') return;
    app.use((err: any, req: any, _res: any, next: any) => {
      try {
        const scope = Sentry.getIsolationScope();
        if (req?.user?.userId) scope.setUser({ id: String(req.user.userId) });
        if (req?.id) scope.setTag('requestId', req.id);
        if (req?.traceId) scope.setTag('traceId', req.traceId);
        if (req?.method) scope.setTag('method', req.method);
        const routePath = req?.route?.path ? `${req.baseUrl || ''}${req.route.path}` : undefined;
        if (routePath) scope.setTag('route', routePath);
      } catch { /* noop */ }
      next(err);
    });
    try { Sentry.setupExpressErrorHandler(app); } catch { /* noop */ }
  },
  /** Flush pending events before shutdown. */
  async close(timeoutMs = 2000) {
    if (noop || !Sentry) return;
    try { if (Sentry.close) await Sentry.close(timeoutMs); } catch { /* noop */ }
  },
  /** Underlying @sentry/node or null. */
  get raw() { return Sentry; },
};

export { initSentry, sentry };
