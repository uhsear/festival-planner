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

import { loadConfig } from './config.js';

const _cfg = loadConfig();

const REDACT_KEYS = new Set([
  'password', 'pass', 'pwd', 'secret', 'token', 'auth',
  'authorization', 'cookie', 'set-cookie', 'session',
  'apikey', 'api_key', 'accesstoken', 'access_token',
  'refreshtoken', 'refresh_token', 'privatekey', 'private_key',
  'dsn', 'sentry_dsn',
  // PII + credential-adjacent fields (2026-04-18 hardening)
  'email', 'newpassword', 'currentpassword', 'confirmpassword',
  'passwordhash', 'password_hash', 'sessiontoken', 'session_token',
  'usertoken', 'user_token', 'admintoken', 'admin_token',
  'tokenhash', 'token_hash', 'resettoken', 'reset_token',
  'verifytoken', 'verify_token', 'clientsecret', 'client_secret',
  'credentials', 'ssn', 'creditcard',
]);

function sanitizeLogMeta(meta: any): any {
  if (!meta || typeof meta !== 'object') return meta;
  if (Array.isArray(meta)) return meta.map(sanitizeLogMeta);
  const out: any = {};
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

let pinoRoot: any = null;
let pinoAvailable = false;

try {
  // Optional dep — if pino isn't installed, we fall back to the console logger.

  const pino = (await import('pino')).default;
  const isProd = _cfg.NODE_ENV === 'production';
  const level = _cfg.LOG_LEVEL || (isProd ? 'info' : 'debug');

  const redactPaths = [
    'password', 'pass', 'pwd', 'secret', 'token', 'apiKey', 'api_key',
    'accessToken', 'access_token', 'refreshToken', 'refresh_token',
    'privateKey', 'private_key', 'dsn',
    'email', 'newPassword', 'currentPassword', 'confirmPassword',
    'passwordHash', 'password_hash', 'sessionToken', 'userToken',
    'adminToken', 'tokenHash', 'resetToken', 'verifyToken',
    '*.password', '*.secret', '*.token', '*.apiKey', '*.email',
    '*.passwordHash', '*.refreshToken', '*.sessionToken',
    'req.headers.authorization', 'req.headers.cookie', 'req.headers["set-cookie"]',
    'req.headers["x-user-token"]', 'req.headers["x-admin-token"]',
    'headers.authorization', 'headers.cookie',
    'user.password', 'user.passwordHash', 'user.password_hash', 'user.email',
  ];

  const baseOpts: any = {
    level,
    base: { service: 'festie', env: _cfg.NODE_ENV || 'dev' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: redactPaths, censor: '[REDACTED]', remove: false },
    messageKey: 'msg',
    formatters: {
      level: (label: string) => ({ level: label }),
    },
  };

  if (!isProd) {
    try {
      // Check if pino-pretty is available
      await import('pino-pretty');
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

const LEVELS: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const envLevel = _cfg.LOG_LEVEL || (_cfg.NODE_ENV === 'production' ? 'info' : 'debug');

function formatConsole(level: string, prefix: string, bindings: any, message: string, meta: any) {
  const ts = new Date().toISOString();
  const scope = prefix ? `[${prefix}]` : '';
  const body = { ...bindings, ...(meta ? sanitizeLogMeta(meta) : {}) };
  const suffix = Object.keys(body).length ? ` ${JSON.stringify(body)}` : '';
  return `${ts} ${level.toUpperCase()} ${scope} ${message}${suffix}`.trim();
}

function createConsoleLogger(prefix = '', bindings: any = {}) {
  const currentLevel = LEVELS[envLevel] ?? 2;
  const api = {
    error(message: string, meta?: any) { if (currentLevel >= 0) console.error(formatConsole('error', prefix, bindings, message, meta)); },
    warn(message: string, meta?: any)  { if (currentLevel >= 1) console.warn(formatConsole('warn',  prefix, bindings, message, meta)); },
    // eslint-disable-next-line no-console
    info(message: string, meta?: any)  { if (currentLevel >= 2) console.log(formatConsole('info',  prefix, bindings, message, meta)); },
    // eslint-disable-next-line no-console
    debug(message: string, meta?: any) { if (currentLevel >= 3) console.log(formatConsole('debug', prefix, bindings, message, meta)); },
    child(extra: any) { return createConsoleLogger(prefix, { ...bindings, ...extra }); },
    level: envLevel,
    isPino: false,
  };
  return api;
}

/* ------------------------------------------------------------------
 * Pino-backed adapter — same API as the console fallback.
 * ------------------------------------------------------------------ */

function createPinoLogger(prefix = '', bindings: any = {}) {
  const pinoBindings: any = { ...bindings };
  if (prefix) pinoBindings.scope = prefix;
  const child = pinoRoot.child(pinoBindings);

  const wrap = (fn: any) => (message: string, meta?: any) => {
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
    child(extra: any) { return createPinoLogger(prefix, { ...bindings, ...extra }); },
    /** Escape hatch — the raw pino instance, useful for pino-http. */
    _pino: child,
    level: child.level,
    isPino: true,
  };
}

function createLogger(prefix = '', bindings: any = {}) {
  if (pinoAvailable && pinoRoot) return createPinoLogger(prefix, bindings);
  return createConsoleLogger(prefix, bindings);
}

/** Returns the raw pino instance or null if not available. */
function getPinoRoot() {
  return pinoRoot;
}

export { createLogger, sanitizeLogMeta, getPinoRoot, pinoAvailable };
