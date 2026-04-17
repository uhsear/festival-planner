/**
 * Festie logger — Pino-backed structured logging with request IDs + PII redaction.
 *
 * Preserves the existing createLogger() API surface:
 *   createLogger(prefix?, bindings?)
 *   logger.{error,warn,info,debug}(message, meta?)
 *   logger.child(extraBindings)
 *
 * Changes in Phase 1.1:
 *   - Uses pino when available (structured JSON in prod, pino-pretty in dev).
 *   - Falls back to the old console-based logger if pino is not installed,
 *     so the app never fails to boot because of a missing optional dep.
 *   - Adds sanitizeLogMeta() which remains exported for callers that build
 *     meta objects manually.
 *   - 2026-04-14: LOG_LEVEL + NODE_ENV now sourced from lib/config.js DEFAULTS
 *     (single source of truth per CLAUDE.md centralization rule).
 */

const { loadConfig } = require('./config');
const _cfg = loadConfig();

const REDACT_KEYS = new Set([
  'password', 'pass', 'pwd', 'secret', 'token', 'auth',
  'authorization', 'cookie', 'set-cookie', 'session',
  'apiKey', 'api_key', 'accessToken', 'access_token',
  'refreshToken', 'refresh_token', 'privateKey', 'private_key',
  'dsn', 'sentry_dsn',
]);

function sanitizeLogMeta(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  if (Array.isArray(meta)) return meta.map(sanitizeLogMeta);
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeLogMeta(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

let pinoRoot = null;
let pinoAvailable = false;

try {
  // Optional dep — if pino isn't installed, we fall back to the console logger.

  const pino = require('pino');
  const isProd = _cfg.NODE_ENV === 'production';
  const level = _cfg.LOG_LEVEL || (isProd ? 'info' : 'debug');

  const redactPaths = [
    'password', 'pass', 'pwd', 'secret', 'token', 'apiKey', 'api_key',
    'accessToken', 'access_token', 'refreshToken', 'refresh_token',
    'privateKey', 'private_key', 'dsn',
    '*.password', '*.secret', '*.token', '*.apiKey',
    'req.headers.authorization', 'req.headers.cookie', 'req.headers["set-cookie"]',
    'headers.authorization', 'headers.cookie',
    'user.password', 'user.passwordHash', 'user.password_hash',
  ];

  const baseOpts = {
    level,
    base: { service: 'festie', env: _cfg.NODE_ENV || 'dev' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: redactPaths, censor: '[REDACTED]', remove: false },
    messageKey: 'msg',
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (!isProd) {
    try {

      require.resolve('pino-pretty');
      baseOpts.transport = {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service,env' },
      };
    } catch { /* pino-pretty not installed, JSON is fine */ }
  }

  pinoRoot = pino(baseOpts);
  pinoAvailable = true;
} catch {
  pinoRoot = null;
  pinoAvailable = false;
}

/* ------------------------------------------------------------------
 * Console fallback — keeps the app functional if pino fails to load.
 * ------------------------------------------------------------------ */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const envLevel = _cfg.LOG_LEVEL || (_cfg.NODE_ENV === 'production' ? 'info' : 'debug');

function formatConsole(level, prefix, bindings, message, meta) {
  const ts = new Date().toISOString();
  const scope = prefix ? `[${prefix}]` : '';
  const body = { ...bindings, ...(meta ? sanitizeLogMeta(meta) : {}) };
  const suffix = Object.keys(body).length ? ` ${JSON.stringify(body)}` : '';
  return `${ts} ${level.toUpperCase()} ${scope} ${message}${suffix}`.trim();
}

function createConsoleLogger(prefix = '', bindings = {}) {
  const currentLevel = LEVELS[envLevel] ?? 2;
  const api = {
    error(message, meta) { if (currentLevel >= 0) console.error(formatConsole('error', prefix, bindings, message, meta)); },
    warn(message, meta)  { if (currentLevel >= 1) console.warn(formatConsole('warn',  prefix, bindings, message, meta)); },
    // eslint-disable-next-line no-console
    info(message, meta)  { if (currentLevel >= 2) console.log(formatConsole('info',  prefix, bindings, message, meta)); },
    // eslint-disable-next-line no-console
    debug(message, meta) { if (currentLevel >= 3) console.log(formatConsole('debug', prefix, bindings, message, meta)); },
    child(extra) { return createConsoleLogger(prefix, { ...bindings, ...extra }); },
    level: envLevel,
    isPino: false,
  };
  return api;
}

/* ------------------------------------------------------------------
 * Pino-backed adapter — same API as the console fallback.
 * ------------------------------------------------------------------ */

function createPinoLogger(prefix = '', bindings = {}) {
  const pinoBindings = { ...bindings };
  if (prefix) pinoBindings.scope = prefix;
  const child = pinoRoot.child(pinoBindings);

  const wrap = (fn) => (message, meta) => {
    if (meta !== undefined && meta !== null && typeof meta === 'object') {
      fn.call(child, sanitizeLogMeta(meta), message);
    } else if (meta !== undefined) {
      fn.call(child, { meta }, message);
    } else {
      fn.call(child, message);
    }
  };

  return {
    error: wrap(child.error),
    warn:  wrap(child.warn),
    info:  wrap(child.info),
    debug: wrap(child.debug),
    child(extra) { return createPinoLogger(prefix, { ...bindings, ...extra }); },
    /** Escape hatch — the raw pino instance, useful for pino-http. */
    _pino: child,
    level: child.level,
    isPino: true,
  };
}

function createLogger(prefix = '', bindings = {}) {
  if (pinoAvailable && pinoRoot) return createPinoLogger(prefix, bindings);
  return createConsoleLogger(prefix, bindings);
}

/** Returns the raw pino instance or null if not available. */
function getPinoRoot() {
  return pinoRoot;
}

module.exports = { createLogger, sanitizeLogMeta, getPinoRoot, pinoAvailable };
