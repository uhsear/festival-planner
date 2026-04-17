/**
 * Sentry initialization wrapper — optional and safe.
 *
 * If @sentry/node is not installed OR SENTRY_DSN is unset, this becomes a
 * no-op and the exported `sentry` object mirrors the public API with stubs.
 * This lets the rest of the codebase call `sentry.captureException(err)`
 * unconditionally.
 *
 * 2026-04-14: all SENTRY_*, APP_VERSION, NODE_ENV reads now flow through
 * lib/config.js (single source of truth per CLAUDE.md centralization rule).
 */

const { loadConfig } = require('./config');
const _cfg = loadConfig();

let Sentry = null;
let initialized = false;
let noop = true;

function initSentry(options = {}) {
  if (initialized) return Sentry;
  initialized = true;

  const dsn = options.dsn || _cfg.SENTRY_DSN;
  if (!dsn) {

    console.warn('[sentry] SENTRY_DSN not set — Sentry disabled (no-op mode)');
    noop = true;
    return null;
  }

  try {

    Sentry = require('@sentry/node');
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
      beforeSend(event) {
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
    // eslint-disable-next-line no-console
    console.log('[sentry] initialized', { env: options.environment || _cfg.NODE_ENV, release: options.release || _cfg.APP_VERSION });
    return Sentry;
  } catch (err) {

    console.warn('[sentry] init failed — no-op mode', err.message);
    Sentry = null;
    noop = true;
    return null;
  }
}

const sentry = {
  get available() { return !noop && Sentry !== null; },
  captureException(err, context) {
    if (noop || !Sentry) return;
    try { Sentry.captureException(err, context); } catch { /* noop */ }
  },
  captureMessage(msg, level = 'info') {
    if (noop || !Sentry) return;
    try { Sentry.captureMessage(msg, level); } catch { /* noop */ }
  },
  setUser(user) {
    if (noop || !Sentry) return;
    try { Sentry.setUser(user); } catch { /* noop */ }
  },
  setTag(key, value) {
    if (noop || !Sentry) return;
    try { Sentry.setTag(key, value); } catch { /* noop */ }
  },
  /** Returns Express request handler middleware (or a pass-through). */
  requestHandler() {
    if (noop || !Sentry || !Sentry.Handlers || !Sentry.Handlers.requestHandler) {
      return (req, res, next) => next();
    }
    return Sentry.Handlers.requestHandler();
  },
  /** Returns Express error handler middleware (or a pass-through). */
  errorHandler() {
    if (noop || !Sentry || !Sentry.Handlers || !Sentry.Handlers.errorHandler) {
      return (err, req, res, next) => next(err);
    }
    return Sentry.Handlers.errorHandler();
  },
  /** Flush pending events before shutdown. */
  async close(timeoutMs = 2000) {
    if (noop || !Sentry) return;
    try { if (Sentry.close) await Sentry.close(timeoutMs); } catch { /* noop */ }
  },
  /** Underlying @sentry/node or null. */
  get raw() { return Sentry; },
};

module.exports = { initSentry, sentry };
