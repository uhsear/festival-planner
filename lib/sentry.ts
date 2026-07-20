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
   * Wires Sentry's Express request+error capture directly onto `app` (no-op
   * if Sentry is unavailable). @sentry/node v8+ removed `Sentry.Handlers` —
   * the SDK now exposes a single `setupExpressErrorHandler(app)` that calls
   * `app.use()` itself, so this takes `app` rather than returning a
   * middleware for the caller to `.use()`. Call once, after all routes are
   * mounted and before any other error-handling middleware.
   */
  setupExpressErrorHandler(app: any) {
    if (noop || !Sentry || typeof Sentry.setupExpressErrorHandler !== 'function') return;
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
