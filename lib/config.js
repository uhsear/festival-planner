// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
//
// DEPRECATED since v2.1 role-based auth — do not reuse as HMAC keys or secrets
// (applies to ADMIN_USER / ADMIN_PASSWORD below; kept for backcompat only).
'use strict';

const path = require('path');

const DEFAULTS = {
  PORT: 4000,
  RATE_LIMIT_WINDOW: 60_000,
  RATE_LIMIT_MAX: 120,
  MAX_RATE_LIMIT_ENTRIES: 10_000,
  AUTH_RATE_LIMIT_WINDOW: 300_000,
  AUTH_RATE_LIMIT_MAX: 10,
  SESSION_TTL: 24 * 60 * 60 * 1000,
  SOCKET_CONNECT_WINDOW: 60_000,
  SOCKET_CONNECT_RATE_LIMIT: 30,
  SOCKET_EVENT_WINDOW: 10_000,
  SOCKET_JOIN_RATE_LIMIT: 12,
  SOCKET_LEAVE_RATE_LIMIT: 20,
  JSON_LIMIT: '256kb',
  MAX_USERS: 200,
  PG_POOL_MIN: 2,
  PG_POOL_MAX: 20,
  MAX_PROFILES_PER_FESTIVAL: 100,
  MAX_STAGES: 20,
  MAX_DAYS: 10,
  MAX_SETS_PER_DAY: 200,
  MAX_PICKS: 500,
  MAX_NOTES: 500,
  MAX_NOTE_LENGTH: 1000,
  MAX_STATUS_TEXT: 120,
  AVATAR_SIZE: 256,
  AVATAR_MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  AVATAR_MAX_PIXELS: 16_000_000,
  AVATAR_WEBP_QUALITY: 82,
  ADMIN_SESSION_MAX: 5,
  USER_SESSION_MAX: 5,
  MAX_CONCURRENT_EXPORTS: 4,
  MAX_CREW_IN_EXPORT: 20,
  EXPORT_COOLDOWN_MS: 5000,
  EXPORT_TIMEOUT_MS: 10_000,
  MAX_EXPORT_SETS_PER_STREAM: 10_000,
  SSE_HEARTBEAT_INTERVAL: 15_000,
  AUDIT_LOG_RETENTION_DAYS: 90,
  SHUTDOWN_TIMEOUT_MS: 30_000,
  REQUEST_TIMEOUT_MS: 30_000,
  ROOM_CAPACITY_LIMIT: 200,
  MAX_HEAP_BYTES: 512 * 1024 * 1024,
  RATE_LIMIT_CLEANUP_INTERVAL: 60_000,
  EXPORT_COOLDOWN_CLEANUP_INTERVAL: 60_000,
  API_VERSION: '1',
  REFRESH_TOKEN_TTL: 90 * 24 * 60 * 60 * 1000,
  MAX_LOGIN_FAILURES: 10,
  LOGIN_LOCKOUT_MS: 15 * 60 * 1000,
  PROFILE_RATE_LIMIT_MAX: 60,
  OVERLAP_RATE_LIMIT_MAX: 30,
  ADMIN_WRITE_RATE_LIMIT_MAX: 30,
  DRAIN_BATCH_SIZE: 50,
  DRAIN_BATCH_DELAY_MS: 100,
  DB_POOL_SIZE: 15,
  RESET_TOKEN_PREFIX: 'reset:',
  RESET_TOKEN_TTL: 60 * 60 * 1000,
  EMAIL_VERIFY_TOKEN_TTL_HOURS: 24,
  MAX_PROFILES_CACHE: 10_000,
  WEBHOOK_TOKEN_HMAC_KEY: '',       // REQUIRED when FCM_RETRY_WEBHOOK_URL is set; startup validator enforces
  FCM_RETRY_WEBHOOK_URL: '',        // optional; triggers WEBHOOK_TOKEN_HMAC_KEY requirement when set
  SPOTIFY_CLIENT_ID: '',
  SPOTIFY_CLIENT_SECRET: '',
  CLUSTER_SIZE: 1,                  // dev/test default; prod ecosystem.config.js sets CLUSTER_SIZE=4 via env
  REDIS_PREFIX: 'fp:',
  LOG_LEVEL: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  SENTRY_DSN: '',
  SENTRY_TRACES_RATE: 0.05,
  SENTRY_PROFILES_RATE: 0,
  APP_VERSION: '',                  // loaded from package.json at boot
};

function readInt(value, fallback, min = 0, max = Infinity) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function readBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function readList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readTrustProxy(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['false', 'off', 'no'].includes(normalized)) return false;
  if (['true', 'on', 'yes'].includes(normalized)) return true;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSameSite(value) {
  const normalized = String(value || 'lax').trim().toLowerCase();
  if (normalized === 'strict') return 'strict';
  if (normalized === 'none') return 'none';
  return 'lax';
}

function loadConfig(overrides = {}) {
  let APP_VERSION = '';
  try { APP_VERSION = require('../package.json').version; } catch { /* noop */ }

  const nodeEnv = overrides.NODE_ENV || process.env.NODE_ENV || 'development';
  const publicDir = path.resolve(overrides.PUBLIC_DIR || process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public'));
  const dataDir = path.resolve(overrides.DATA_DIR || process.env.DATA_DIR || path.join(__dirname, 'data'));
  const dbPath = overrides.DB_PATH || process.env.DB_PATH || path.join(dataDir, 'festie.sqlite');
  const databaseUrl = overrides.DATABASE_URL || process.env.DATABASE_URL || 'postgresql://localhost/festival_planner';
  if (!process.env.DATABASE_URL && !overrides.DATABASE_URL && process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL environment variable is required in production. Set it in .env.');
  }
  // Legacy admin env vars — no longer required (role-based auth since v2.1)
  // Kept for backward compat if tests reference them, but never enforced
  const adminUser = overrides.ADMIN_USER || process.env.ADMIN_USER || '';
  const adminPassword = overrides.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';

  const publicOrigin = 'PUBLIC_ORIGIN' in overrides ? (overrides.PUBLIC_ORIGIN || '') : (process.env.PUBLIC_ORIGIN || '');
  const allowedOrigins = new Set([
    ...readList(process.env.ALLOWED_ORIGINS),
    ...readList(overrides.ALLOWED_ORIGINS),
  ]);
  if (publicOrigin) allowedOrigins.add(publicOrigin);
  const cookieSecureDefault = publicOrigin.startsWith('https://');

  const port = readInt(overrides.PORT || process.env.PORT, DEFAULTS.PORT, 1, 65535);
  const sessionTtl = readInt(overrides.SESSION_TTL || process.env.SESSION_TTL, DEFAULTS.SESSION_TTL, 60000);
  const maxUsers = readInt(overrides.MAX_USERS || process.env.MAX_USERS, DEFAULTS.MAX_USERS, 1);
  const avatarSize = readInt(overrides.AVATAR_SIZE || process.env.AVATAR_SIZE, DEFAULTS.AVATAR_SIZE, 32, 1024);

  return {
    NODE_ENV: nodeEnv,
    ADMIN_USER: adminUser,
    ADMIN_PASSWORD: adminPassword,
    PORT: port,
    BIND_ADDRESS: overrides.BIND_ADDRESS || process.env.BIND_ADDRESS || '0.0.0.0',
    TRUST_PROXY: readTrustProxy(overrides.TRUST_PROXY || process.env.TRUST_PROXY, false),
    DATA_DIR: dataDir,
    DB_PATH: path.resolve(dbPath),
    DATABASE_URL: databaseUrl,
    PUBLIC_DIR: publicDir,
    PUBLIC_ORIGIN: publicOrigin,
    ALLOWED_ORIGINS: [...allowedOrigins],
    USER_SESSION_COOKIE: overrides.USER_SESSION_COOKIE || process.env.USER_SESSION_COOKIE || 'festival_user_session',
    ADMIN_SESSION_COOKIE: overrides.ADMIN_SESSION_COOKIE || process.env.ADMIN_SESSION_COOKIE || 'festival_admin_session',
    COOKIE_SAME_SITE: normalizeSameSite(overrides.COOKIE_SAME_SITE || process.env.COOKIE_SAME_SITE),
    COOKIE_SECURE: readBool(overrides.COOKIE_SECURE || process.env.COOKIE_SECURE, cookieSecureDefault),
    RATE_LIMIT_WINDOW: readInt(overrides.RATE_LIMIT_WINDOW || process.env.RATE_LIMIT_WINDOW, DEFAULTS.RATE_LIMIT_WINDOW),
    RATE_LIMIT_MAX: readInt(overrides.RATE_LIMIT_MAX || process.env.RATE_LIMIT_MAX, DEFAULTS.RATE_LIMIT_MAX),
    MAX_RATE_LIMIT_ENTRIES: readInt(overrides.MAX_RATE_LIMIT_ENTRIES || process.env.MAX_RATE_LIMIT_ENTRIES, DEFAULTS.MAX_RATE_LIMIT_ENTRIES, 1),
    AUTH_RATE_LIMIT_WINDOW: readInt(overrides.AUTH_RATE_LIMIT_WINDOW || process.env.AUTH_RATE_LIMIT_WINDOW, DEFAULTS.AUTH_RATE_LIMIT_WINDOW),
    AUTH_RATE_LIMIT_MAX: readInt(overrides.AUTH_RATE_LIMIT_MAX || process.env.AUTH_RATE_LIMIT_MAX, DEFAULTS.AUTH_RATE_LIMIT_MAX),
    SESSION_TTL: sessionTtl,
    SOCKET_CONNECT_WINDOW: readInt(overrides.SOCKET_CONNECT_WINDOW || process.env.SOCKET_CONNECT_WINDOW, DEFAULTS.SOCKET_CONNECT_WINDOW),
    SOCKET_CONNECT_RATE_LIMIT: readInt(overrides.SOCKET_CONNECT_RATE_LIMIT || process.env.SOCKET_CONNECT_RATE_LIMIT, DEFAULTS.SOCKET_CONNECT_RATE_LIMIT),
    SOCKET_EVENT_WINDOW: readInt(overrides.SOCKET_EVENT_WINDOW || process.env.SOCKET_EVENT_WINDOW, DEFAULTS.SOCKET_EVENT_WINDOW),
    SOCKET_JOIN_RATE_LIMIT: readInt(overrides.SOCKET_JOIN_RATE_LIMIT || process.env.SOCKET_JOIN_RATE_LIMIT, DEFAULTS.SOCKET_JOIN_RATE_LIMIT),
    SOCKET_LEAVE_RATE_LIMIT: readInt(overrides.SOCKET_LEAVE_RATE_LIMIT || process.env.SOCKET_LEAVE_RATE_LIMIT, DEFAULTS.SOCKET_LEAVE_RATE_LIMIT),
    JSON_LIMIT: overrides.JSON_LIMIT || process.env.JSON_LIMIT || DEFAULTS.JSON_LIMIT,
    MAX_USERS: maxUsers,
    MAX_PROFILES_PER_FESTIVAL: readInt(overrides.MAX_PROFILES_PER_FESTIVAL || process.env.MAX_PROFILES_PER_FESTIVAL, DEFAULTS.MAX_PROFILES_PER_FESTIVAL),
    MAX_STAGES: readInt(overrides.MAX_STAGES || process.env.MAX_STAGES, DEFAULTS.MAX_STAGES),
    MAX_DAYS: readInt(overrides.MAX_DAYS || process.env.MAX_DAYS, DEFAULTS.MAX_DAYS),
    MAX_SETS_PER_DAY: readInt(overrides.MAX_SETS_PER_DAY || process.env.MAX_SETS_PER_DAY, DEFAULTS.MAX_SETS_PER_DAY),
    MAX_PICKS: readInt(overrides.MAX_PICKS || process.env.MAX_PICKS, DEFAULTS.MAX_PICKS),
    MAX_NOTES: readInt(overrides.MAX_NOTES || process.env.MAX_NOTES, DEFAULTS.MAX_NOTES),
    MAX_NOTE_LENGTH: readInt(overrides.MAX_NOTE_LENGTH || process.env.MAX_NOTE_LENGTH, DEFAULTS.MAX_NOTE_LENGTH),
    MAX_STATUS_TEXT: readInt(overrides.MAX_STATUS_TEXT || process.env.MAX_STATUS_TEXT, DEFAULTS.MAX_STATUS_TEXT),
    AVATAR_SIZE: avatarSize,
    AVATAR_MAX_UPLOAD_BYTES: readInt(overrides.AVATAR_MAX_UPLOAD_BYTES || process.env.AVATAR_MAX_UPLOAD_BYTES, DEFAULTS.AVATAR_MAX_UPLOAD_BYTES),
    AVATAR_MAX_PIXELS: readInt(overrides.AVATAR_MAX_PIXELS || process.env.AVATAR_MAX_PIXELS, DEFAULTS.AVATAR_MAX_PIXELS),
    AVATAR_WEBP_QUALITY: readInt(overrides.AVATAR_WEBP_QUALITY || process.env.AVATAR_WEBP_QUALITY, DEFAULTS.AVATAR_WEBP_QUALITY),
    ADMIN_SESSION_MAX: readInt(overrides.ADMIN_SESSION_MAX || process.env.ADMIN_SESSION_MAX, DEFAULTS.ADMIN_SESSION_MAX),
    USER_SESSION_MAX: readInt(overrides.USER_SESSION_MAX || process.env.USER_SESSION_MAX, DEFAULTS.USER_SESSION_MAX),
    MAX_CONCURRENT_EXPORTS: readInt(overrides.MAX_CONCURRENT_EXPORTS || process.env.MAX_CONCURRENT_EXPORTS, DEFAULTS.MAX_CONCURRENT_EXPORTS),
    MAX_CREW_IN_EXPORT: readInt(overrides.MAX_CREW_IN_EXPORT || process.env.MAX_CREW_IN_EXPORT, DEFAULTS.MAX_CREW_IN_EXPORT),
    EXPORT_COOLDOWN_MS: readInt(overrides.EXPORT_COOLDOWN_MS || process.env.EXPORT_COOLDOWN_MS, DEFAULTS.EXPORT_COOLDOWN_MS),
    EXPORT_TIMEOUT_MS: readInt(overrides.EXPORT_TIMEOUT_MS || process.env.EXPORT_TIMEOUT_MS, DEFAULTS.EXPORT_TIMEOUT_MS),
    MAX_EXPORT_SETS_PER_STREAM: readInt(overrides.MAX_EXPORT_SETS_PER_STREAM || process.env.MAX_EXPORT_SETS_PER_STREAM, DEFAULTS.MAX_EXPORT_SETS_PER_STREAM),
    SSE_HEARTBEAT_INTERVAL: readInt(overrides.SSE_HEARTBEAT_INTERVAL || process.env.SSE_HEARTBEAT_INTERVAL, DEFAULTS.SSE_HEARTBEAT_INTERVAL),
    AUDIT_LOG_RETENTION_DAYS: readInt(overrides.AUDIT_LOG_RETENTION_DAYS || process.env.AUDIT_LOG_RETENTION_DAYS, DEFAULTS.AUDIT_LOG_RETENTION_DAYS),
    SHUTDOWN_TIMEOUT_MS: readInt(overrides.SHUTDOWN_TIMEOUT_MS || process.env.SHUTDOWN_TIMEOUT_MS, DEFAULTS.SHUTDOWN_TIMEOUT_MS),
    DRAIN_BATCH_SIZE: readInt(overrides.DRAIN_BATCH_SIZE || process.env.DRAIN_BATCH_SIZE, DEFAULTS.DRAIN_BATCH_SIZE, 1),
    DRAIN_BATCH_DELAY_MS: readInt(overrides.DRAIN_BATCH_DELAY_MS || process.env.DRAIN_BATCH_DELAY_MS, DEFAULTS.DRAIN_BATCH_DELAY_MS, 0),

    REQUEST_TIMEOUT_MS: readInt(overrides.REQUEST_TIMEOUT_MS || process.env.REQUEST_TIMEOUT_MS, DEFAULTS.REQUEST_TIMEOUT_MS),
    ROOM_CAPACITY_LIMIT: readInt(overrides.ROOM_CAPACITY_LIMIT || process.env.ROOM_CAPACITY_LIMIT, DEFAULTS.ROOM_CAPACITY_LIMIT, 1),
    MAX_HEAP_BYTES: readInt(overrides.MAX_HEAP_BYTES || process.env.MAX_HEAP_BYTES, DEFAULTS.MAX_HEAP_BYTES, 1),
    RATE_LIMIT_CLEANUP_INTERVAL: readInt(overrides.RATE_LIMIT_CLEANUP_INTERVAL || process.env.RATE_LIMIT_CLEANUP_INTERVAL, DEFAULTS.RATE_LIMIT_CLEANUP_INTERVAL, 1),
    EXPORT_COOLDOWN_CLEANUP_INTERVAL: readInt(overrides.EXPORT_COOLDOWN_CLEANUP_INTERVAL || process.env.EXPORT_COOLDOWN_CLEANUP_INTERVAL, DEFAULTS.EXPORT_COOLDOWN_CLEANUP_INTERVAL, 1),
    API_VERSION: overrides.API_VERSION || process.env.API_VERSION || DEFAULTS.API_VERSION,

    // Mobile app origins (TWA or custom schemes)
    MOBILE_ORIGINS: readList(overrides.MOBILE_ORIGINS || process.env.MOBILE_ORIGINS),

    // Firebase Cloud Messaging (optional — push notifications disabled when unset)
    FIREBASE_CREDENTIALS_PATH: overrides.FIREBASE_CREDENTIALS_PATH || process.env.FIREBASE_CREDENTIALS_PATH || '',

    // Redis (optional — falls back to in-memory when unset or disabled)
    REDIS_URL: overrides.REDIS_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    REDIS_ENABLED: readBool(overrides.REDIS_ENABLED || process.env.REDIS_ENABLED, true),
    REDIS_PREFIX: overrides.REDIS_PREFIX || process.env.REDIS_PREFIX || DEFAULTS.REDIS_PREFIX,

    // Deep linking — populate when you have your Apple/Android signing credentials
    APPLE_TEAM_ID: overrides.APPLE_TEAM_ID || process.env.APPLE_TEAM_ID || '',
    ANDROID_CERT_FINGERPRINTS: overrides.ANDROID_CERT_FINGERPRINTS || process.env.ANDROID_CERT_FINGERPRINTS || '',

    // Resend transactional email (optional — email features disabled when unset)
    RESEND_API_KEY: overrides.RESEND_API_KEY || process.env.RESEND_API_KEY || '',
    EMAIL_FROM: overrides.EMAIL_FROM || process.env.EMAIL_FROM || 'Festie <no-reply@festie.us>',

    REFRESH_TOKEN_TTL: readInt(overrides.REFRESH_TOKEN_TTL || process.env.REFRESH_TOKEN_TTL, DEFAULTS.REFRESH_TOKEN_TTL, 60000),
    MAX_LOGIN_FAILURES: readInt(overrides.MAX_LOGIN_FAILURES || process.env.MAX_LOGIN_FAILURES, DEFAULTS.MAX_LOGIN_FAILURES, 1),
    LOGIN_LOCKOUT_MS: readInt(overrides.LOGIN_LOCKOUT_MS || process.env.LOGIN_LOCKOUT_MS, DEFAULTS.LOGIN_LOCKOUT_MS, 1000),
    PROFILE_RATE_LIMIT_MAX: readInt(overrides.PROFILE_RATE_LIMIT_MAX || process.env.PROFILE_RATE_LIMIT_MAX, DEFAULTS.PROFILE_RATE_LIMIT_MAX, 1),
    OVERLAP_RATE_LIMIT_MAX: readInt(overrides.OVERLAP_RATE_LIMIT_MAX || process.env.OVERLAP_RATE_LIMIT_MAX, DEFAULTS.OVERLAP_RATE_LIMIT_MAX, 1),
    ADMIN_WRITE_RATE_LIMIT_MAX: readInt(overrides.ADMIN_WRITE_RATE_LIMIT_MAX || process.env.ADMIN_WRITE_RATE_LIMIT_MAX, DEFAULTS.ADMIN_WRITE_RATE_LIMIT_MAX, 1),
    DB_POOL_SIZE: readInt(overrides.DB_POOL_SIZE || process.env.DB_POOL_SIZE, DEFAULTS.DB_POOL_SIZE, 1, 50),
    PG_POOL_MIN: readInt(overrides.PG_POOL_MIN || process.env.PG_POOL_MIN, DEFAULTS.PG_POOL_MIN, 1, 20),
    PG_POOL_MAX: readInt(overrides.PG_POOL_MAX || process.env.PG_POOL_MAX, DEFAULTS.PG_POOL_MAX, 2, 50),
    EMAIL_VERIFY_TOKEN_TTL_HOURS: readInt(overrides.EMAIL_VERIFY_TOKEN_TTL_HOURS || process.env.EMAIL_VERIFY_TOKEN_TTL_HOURS, DEFAULTS.EMAIL_VERIFY_TOKEN_TTL_HOURS, 1, 168),

    // Webhook / FCM retry integration
    WEBHOOK_TOKEN_HMAC_KEY: overrides.WEBHOOK_TOKEN_HMAC_KEY || process.env.WEBHOOK_TOKEN_HMAC_KEY || DEFAULTS.WEBHOOK_TOKEN_HMAC_KEY,
    FCM_RETRY_WEBHOOK_URL: overrides.FCM_RETRY_WEBHOOK_URL || process.env.FCM_RETRY_WEBHOOK_URL || DEFAULTS.FCM_RETRY_WEBHOOK_URL,

    // Spotify (optional — lineup import / search disabled when unset)
    SPOTIFY_CLIENT_ID: overrides.SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID || DEFAULTS.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: overrides.SPOTIFY_CLIENT_SECRET || process.env.SPOTIFY_CLIENT_SECRET || DEFAULTS.SPOTIFY_CLIENT_SECRET,

    // Cluster / observability
    CLUSTER_SIZE: Number(readInt(overrides.CLUSTER_SIZE || process.env.CLUSTER_SIZE, DEFAULTS.CLUSTER_SIZE, 1, 64)),
    LOG_LEVEL: overrides.LOG_LEVEL || process.env.LOG_LEVEL || DEFAULTS.LOG_LEVEL,
    SENTRY_DSN: overrides.SENTRY_DSN || process.env.SENTRY_DSN || DEFAULTS.SENTRY_DSN,
    SENTRY_TRACES_RATE: Number(overrides.SENTRY_TRACES_RATE ?? process.env.SENTRY_TRACES_RATE ?? DEFAULTS.SENTRY_TRACES_RATE),
    SENTRY_PROFILES_RATE: Number(overrides.SENTRY_PROFILES_RATE ?? process.env.SENTRY_PROFILES_RATE ?? DEFAULTS.SENTRY_PROFILES_RATE),
    APP_VERSION: overrides.APP_VERSION || process.env.APP_VERSION || APP_VERSION || DEFAULTS.APP_VERSION,
  };
}

module.exports = {
  DEFAULTS,
  loadConfig,
};
