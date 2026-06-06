// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
//
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export const DEFAULTS = {
  PORT: 4000,
  RATE_LIMIT_WINDOW: 60_000,
  RATE_LIMIT_MAX: 120,
  MAX_RATE_LIMIT_ENTRIES: 10_000,
  AUTH_RATE_LIMIT_WINDOW: 300_000,
  AUTH_RATE_LIMIT_MAX: 10,
  SESSION_CLEANUP_INTERVAL_MS: 60_000,
  SESSION_TTL: 24 * 60 * 60 * 1000,
  SOCKET_CONNECT_WINDOW: 60_000,
  SOCKET_CONNECT_RATE_LIMIT: 30,
  SOCKET_HEADERS_TIMEOUT: 66_000,
  SOCKET_KEEPALIVE_TIMEOUT: 65_000,
  SOCKET_MAX_HTTP_BUFFER: 100_000,
  SOCKET_PING_INTERVAL: 25_000,
  SOCKET_PING_TIMEOUT: 60_000,
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
  FCM_REQUEST_TIMEOUT_MS: 10_000,
  API_VERSION: '1',
  REFRESH_TOKEN_TTL: 90 * 24 * 60 * 60 * 1000,
  MAX_LOGIN_FAILURES: 10,
  LOGIN_LOCKOUT_MS: 15 * 60 * 1000,
  PROFILE_RATE_LIMIT_MAX: 60,
  OVERLAP_RATE_LIMIT_MAX: 30,
  ADMIN_WRITE_RATE_LIMIT_MAX: 30,
  DRAIN_BATCH_SIZE: 50,
  DRAIN_BATCH_DELAY_MS: 100,
  IDEMPOTENCY_TTL: 300_000,
  IDEMPOTENCY_MAX_ENTRIES: 5000,
  ERROR_DEDUP_WINDOW: 60_000,
  ERROR_DEDUP_MAX: 500,
  ERROR_DEDUP_CLEANUP_INTERVAL_MS: 30_000,
  RESET_TOKEN_PREFIX: 'reset:',
  RESET_TOKEN_TTL: 60 * 60 * 1000,
  EMAIL_VERIFY_TOKEN_TTL_HOURS: 24,
  MAX_IMPORT_SETS: 500,
  SPOTIFY_CACHE_TTL_MS: 86_400_000,
  SPOTIFY_CACHE_MAX: 500,
  MAX_EXPORT_COOLDOWN_ENTRIES: 1_000,
  MAX_PROFILES_CACHE: 10_000,
  MEMORY_WARNING_MB: 384,
  MEMORY_CHECK_INTERVAL_MS: 120_000,
  WEBHOOK_TOKEN_HMAC_KEY: '', // REQUIRED when FCM_RETRY_WEBHOOK_URL is set; startup validator enforces
  FCM_RETRY_WEBHOOK_URL: '', // optional; triggers WEBHOOK_TOKEN_HMAC_KEY requirement when set
  TOKEN_CLEANUP_INTERVAL_MS: 300_000,
  WEATHER_API_TIMEOUT_MS: 8_000,
  WEBHOOK_RETRY_TIMEOUT_MS: 5_000,
  SPOTIFY_CLIENT_ID: '',
  SPOTIFY_CLIENT_SECRET: '',
  CLUSTER_SIZE: 1, // matches the single PM2 fork worker; ecosystem.config.cjs sets CLUSTER_SIZE=1 to keep the in-memory rate-limit divisor accurate
  // Live Location + SOS kill switches. Both default ON; flip to false (env
  // LIVE_LOCATION_ENABLED / SOS_ENABLED) to dark-ship or disable in an incident.
  // Live location is ephemeral (socket-only, never persisted); SOS writes one
  // crew_activity row + pushes safety-critical alerts.
  LIVE_LOCATION_ENABLED: true,
  SOS_ENABLED: true,
  REMINDER_TICK_INTERVAL_MS: 60_000,
  REMINDER_FIRE_WINDOW_MS: 65_000,
  REMINDER_DEDUP_TTL_MS: 7_200_000,
  REDIS_PREFIX: 'fp:',
  LOG_LEVEL: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  SENTRY_DSN: '',
  SENTRY_TRACES_RATE: 0.05,
  SENTRY_PROFILES_RATE: 0,
  APP_VERSION: '', // loaded from package.json at boot
} as const;

function readInt(value: any, fallback: number, min = 0, max = Infinity): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function readBool(value: any, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function readList(value: any): string[] {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// Express 'trust proxy' accepts boolean | number | preset string
// ('loopback' | 'linklocal' | 'uniquelocal'). We pass those preset strings
// through unchanged so production can run with 'loopback' (defense in depth:
// only loopback peers are trusted to set X-Forwarded-* even though the
// hardened getRequestIp no longer relies on XFF). See
// docs/security/trust-proxy-hardening.md.
const TRUST_PROXY_PRESETS = ['loopback', 'linklocal', 'uniquelocal'] as const;

function readTrustProxy(value: any, fallback: boolean | number | string = false): boolean | number | string {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['false', 'off', 'no'].includes(normalized)) return false;
  if (['true', 'on', 'yes'].includes(normalized)) return true;
  if ((TRUST_PROXY_PRESETS as readonly string[]).includes(normalized)) return normalized;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSameSite(value: any): 'strict' | 'lax' | 'none' {
  const normalized = String(value || 'lax')
    .trim()
    .toLowerCase();
  if (normalized === 'strict') return 'strict';
  if (normalized === 'none') return 'none';
  return 'lax';
}

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(overrides: Record<string, any> = {}): {
  NODE_ENV: string;
  PORT: number;
  BIND_ADDRESS: string;
  TRUST_PROXY: boolean | number | string;
  DATA_DIR: string;
  DATABASE_URL: string;
  PUBLIC_DIR: string;
  PUBLIC_ORIGIN: string;
  ALLOWED_ORIGINS: string[];
  USER_SESSION_COOKIE: string;
  ADMIN_SESSION_COOKIE: string;
  COOKIE_SAME_SITE: 'strict' | 'lax' | 'none';
  COOKIE_SECURE: boolean;
  RATE_LIMIT_WINDOW: number;
  RATE_LIMIT_MAX: number;
  MAX_RATE_LIMIT_ENTRIES: number;
  AUTH_RATE_LIMIT_WINDOW: number;
  AUTH_RATE_LIMIT_MAX: number;
  SESSION_CLEANUP_INTERVAL_MS: number;
  SESSION_TTL: number;
  SOCKET_CONNECT_WINDOW: number;
  SOCKET_HEADERS_TIMEOUT: number;
  SOCKET_KEEPALIVE_TIMEOUT: number;
  SOCKET_MAX_HTTP_BUFFER: number;
  SOCKET_PING_INTERVAL: number;
  SOCKET_PING_TIMEOUT: number;
  SOCKET_CONNECT_RATE_LIMIT: number;
  SOCKET_EVENT_WINDOW: number;
  SOCKET_JOIN_RATE_LIMIT: number;
  SOCKET_LEAVE_RATE_LIMIT: number;
  JSON_LIMIT: string;
  MAX_USERS: number;
  MAX_PROFILES_PER_FESTIVAL: number;
  MAX_STAGES: number;
  MAX_DAYS: number;
  MAX_SETS_PER_DAY: number;
  MAX_PICKS: number;
  MAX_NOTES: number;
  MAX_NOTE_LENGTH: number;
  MAX_STATUS_TEXT: number;
  AVATAR_SIZE: number;
  AVATAR_MAX_UPLOAD_BYTES: number;
  AVATAR_MAX_PIXELS: number;
  AVATAR_WEBP_QUALITY: number;
  ADMIN_SESSION_MAX: number;
  USER_SESSION_MAX: number;
  MAX_CONCURRENT_EXPORTS: number;
  MAX_CREW_IN_EXPORT: number;
  EXPORT_COOLDOWN_MS: number;
  EXPORT_TIMEOUT_MS: number;
  MAX_EXPORT_SETS_PER_STREAM: number;
  SSE_HEARTBEAT_INTERVAL: number;
  AUDIT_LOG_RETENTION_DAYS: number;
  SHUTDOWN_TIMEOUT_MS: number;
  DRAIN_BATCH_SIZE: number;
  DRAIN_BATCH_DELAY_MS: number;
  REQUEST_TIMEOUT_MS: number;
  ROOM_CAPACITY_LIMIT: number;
  MAX_HEAP_BYTES: number;
  RATE_LIMIT_CLEANUP_INTERVAL: number;
  EXPORT_COOLDOWN_CLEANUP_INTERVAL: number;
  FCM_REQUEST_TIMEOUT_MS: number;
  API_VERSION: string;
  MOBILE_ORIGINS: string[];
  FIREBASE_CREDENTIALS_PATH: string;
  APNS_KEY_PATH: string;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_BUNDLE_ID: string;
  APNS_PRODUCTION: boolean;
  REDIS_URL: string;
  REDIS_ENABLED: boolean;
  REDIS_PREFIX: string;
  APPLE_TEAM_ID: string;
  ANDROID_CERT_FINGERPRINTS: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  REFRESH_TOKEN_TTL: number;
  MAX_LOGIN_FAILURES: number;
  LOGIN_LOCKOUT_MS: number;
  PROFILE_RATE_LIMIT_MAX: number;
  OVERLAP_RATE_LIMIT_MAX: number;
  ADMIN_WRITE_RATE_LIMIT_MAX: number;
  IDEMPOTENCY_TTL: number;
  IDEMPOTENCY_MAX_ENTRIES: number;
  ERROR_DEDUP_WINDOW: number;
  ERROR_DEDUP_MAX: number;
  ERROR_DEDUP_CLEANUP_INTERVAL_MS: number;
  PG_POOL_MIN: number;
  PG_POOL_MAX: number;
  EMAIL_VERIFY_TOKEN_TTL_HOURS: number;
  MAX_IMPORT_SETS: number;
  SPOTIFY_CACHE_TTL_MS: number;
  SPOTIFY_CACHE_MAX: number;
  MAX_EXPORT_COOLDOWN_ENTRIES: number;
  MEMORY_WARNING_MB: number;
  MEMORY_CHECK_INTERVAL_MS: number;
  REMINDER_TICK_INTERVAL_MS: number;
  REMINDER_FIRE_WINDOW_MS: number;
  REMINDER_DEDUP_TTL_MS: number;
  TOKEN_CLEANUP_INTERVAL_MS: number;
  WEATHER_API_TIMEOUT_MS: number;
  WEBHOOK_TOKEN_HMAC_KEY: string;
  WEBHOOK_RETRY_TIMEOUT_MS: number;
  FCM_RETRY_WEBHOOK_URL: string;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  CLUSTER_SIZE: number;
  LIVE_LOCATION_ENABLED: boolean;
  SOS_ENABLED: boolean;
  LOG_LEVEL: string;
  SENTRY_DSN: string;
  SENTRY_TRACES_RATE: number;
  SENTRY_PROFILES_RATE: number;
  APP_VERSION: string;
  SESSION_SECRET: string;
} {
  let APP_VERSION = '';
  try {
    APP_VERSION = require('../package.json').version;
  } catch {
    /* noop */
  }

  const nodeEnv = overrides.NODE_ENV || process.env.NODE_ENV || 'development';
  const publicDir = path.resolve(
    overrides.PUBLIC_DIR || process.env.PUBLIC_DIR || path.join(import.meta.dirname, '..', 'public'),
  );
  const dataDir = path.resolve(overrides.DATA_DIR || process.env.DATA_DIR || path.join(import.meta.dirname, 'data'));
  const databaseUrl = overrides.DATABASE_URL || process.env.DATABASE_URL || 'postgresql://localhost/festival_planner';
  if (!process.env.DATABASE_URL && !overrides.DATABASE_URL && process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL environment variable is required in production. Set it in .env.');
  }
  const publicOrigin = 'PUBLIC_ORIGIN' in overrides ? overrides.PUBLIC_ORIGIN || '' : process.env.PUBLIC_ORIGIN || '';
  const allowedOrigins = new Set([...readList(process.env.ALLOWED_ORIGINS), ...readList(overrides.ALLOWED_ORIGINS)]);
  if (publicOrigin) allowedOrigins.add(publicOrigin);
  const cookieSecureDefault = publicOrigin.startsWith('https://');

  const port = readInt(overrides.PORT || process.env.PORT, DEFAULTS.PORT, 1, 65535);
  const sessionTtl = readInt(overrides.SESSION_TTL || process.env.SESSION_TTL, DEFAULTS.SESSION_TTL, 60000);
  const maxUsers = readInt(overrides.MAX_USERS || process.env.MAX_USERS, DEFAULTS.MAX_USERS, 1);
  const avatarSize = readInt(overrides.AVATAR_SIZE || process.env.AVATAR_SIZE, DEFAULTS.AVATAR_SIZE, 32, 1024);

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    BIND_ADDRESS: overrides.BIND_ADDRESS || process.env.BIND_ADDRESS || '127.0.0.1',
    TRUST_PROXY: readTrustProxy(overrides.TRUST_PROXY || process.env.TRUST_PROXY, false),
    DATA_DIR: dataDir,
    DATABASE_URL: databaseUrl,
    PUBLIC_DIR: publicDir,
    PUBLIC_ORIGIN: publicOrigin,
    ALLOWED_ORIGINS: [...allowedOrigins],
    USER_SESSION_COOKIE: overrides.USER_SESSION_COOKIE || process.env.USER_SESSION_COOKIE || 'festie_session',
    ADMIN_SESSION_COOKIE:
      overrides.ADMIN_SESSION_COOKIE || process.env.ADMIN_SESSION_COOKIE || 'festival_admin_session',
    COOKIE_SAME_SITE: normalizeSameSite(overrides.COOKIE_SAME_SITE || process.env.COOKIE_SAME_SITE),
    COOKIE_SECURE: readBool(overrides.COOKIE_SECURE || process.env.COOKIE_SECURE, cookieSecureDefault),
    RATE_LIMIT_WINDOW: readInt(
      overrides.RATE_LIMIT_WINDOW || process.env.RATE_LIMIT_WINDOW,
      DEFAULTS.RATE_LIMIT_WINDOW,
    ),
    RATE_LIMIT_MAX: readInt(overrides.RATE_LIMIT_MAX || process.env.RATE_LIMIT_MAX, DEFAULTS.RATE_LIMIT_MAX),
    MAX_RATE_LIMIT_ENTRIES: readInt(
      overrides.MAX_RATE_LIMIT_ENTRIES || process.env.MAX_RATE_LIMIT_ENTRIES,
      DEFAULTS.MAX_RATE_LIMIT_ENTRIES,
      1,
    ),
    AUTH_RATE_LIMIT_WINDOW: readInt(
      overrides.AUTH_RATE_LIMIT_WINDOW || process.env.AUTH_RATE_LIMIT_WINDOW,
      DEFAULTS.AUTH_RATE_LIMIT_WINDOW,
    ),
    AUTH_RATE_LIMIT_MAX: readInt(
      overrides.AUTH_RATE_LIMIT_MAX || process.env.AUTH_RATE_LIMIT_MAX,
      DEFAULTS.AUTH_RATE_LIMIT_MAX,
    ),
    SESSION_CLEANUP_INTERVAL_MS: readInt(
      overrides.SESSION_CLEANUP_INTERVAL_MS || process.env.SESSION_CLEANUP_INTERVAL_MS,
      DEFAULTS.SESSION_CLEANUP_INTERVAL_MS,
      1000,
    ),
    SESSION_TTL: sessionTtl,
    SOCKET_CONNECT_WINDOW: readInt(
      overrides.SOCKET_CONNECT_WINDOW || process.env.SOCKET_CONNECT_WINDOW,
      DEFAULTS.SOCKET_CONNECT_WINDOW,
    ),
    SOCKET_HEADERS_TIMEOUT: readInt(
      overrides.SOCKET_HEADERS_TIMEOUT || process.env.SOCKET_HEADERS_TIMEOUT,
      DEFAULTS.SOCKET_HEADERS_TIMEOUT,
      1000,
    ),
    SOCKET_KEEPALIVE_TIMEOUT: readInt(
      overrides.SOCKET_KEEPALIVE_TIMEOUT || process.env.SOCKET_KEEPALIVE_TIMEOUT,
      DEFAULTS.SOCKET_KEEPALIVE_TIMEOUT,
      1000,
    ),
    SOCKET_MAX_HTTP_BUFFER: readInt(
      overrides.SOCKET_MAX_HTTP_BUFFER || process.env.SOCKET_MAX_HTTP_BUFFER,
      DEFAULTS.SOCKET_MAX_HTTP_BUFFER,
      1000,
    ),
    SOCKET_PING_INTERVAL: readInt(
      overrides.SOCKET_PING_INTERVAL || process.env.SOCKET_PING_INTERVAL,
      DEFAULTS.SOCKET_PING_INTERVAL,
      1000,
    ),
    SOCKET_PING_TIMEOUT: readInt(
      overrides.SOCKET_PING_TIMEOUT || process.env.SOCKET_PING_TIMEOUT,
      DEFAULTS.SOCKET_PING_TIMEOUT,
      1000,
    ),
    SOCKET_CONNECT_RATE_LIMIT: readInt(
      overrides.SOCKET_CONNECT_RATE_LIMIT || process.env.SOCKET_CONNECT_RATE_LIMIT,
      DEFAULTS.SOCKET_CONNECT_RATE_LIMIT,
    ),
    SOCKET_EVENT_WINDOW: readInt(
      overrides.SOCKET_EVENT_WINDOW || process.env.SOCKET_EVENT_WINDOW,
      DEFAULTS.SOCKET_EVENT_WINDOW,
    ),
    SOCKET_JOIN_RATE_LIMIT: readInt(
      overrides.SOCKET_JOIN_RATE_LIMIT || process.env.SOCKET_JOIN_RATE_LIMIT,
      DEFAULTS.SOCKET_JOIN_RATE_LIMIT,
    ),
    SOCKET_LEAVE_RATE_LIMIT: readInt(
      overrides.SOCKET_LEAVE_RATE_LIMIT || process.env.SOCKET_LEAVE_RATE_LIMIT,
      DEFAULTS.SOCKET_LEAVE_RATE_LIMIT,
    ),
    JSON_LIMIT: overrides.JSON_LIMIT || process.env.JSON_LIMIT || DEFAULTS.JSON_LIMIT,
    MAX_USERS: maxUsers,
    MAX_PROFILES_PER_FESTIVAL: readInt(
      overrides.MAX_PROFILES_PER_FESTIVAL || process.env.MAX_PROFILES_PER_FESTIVAL,
      DEFAULTS.MAX_PROFILES_PER_FESTIVAL,
    ),
    MAX_STAGES: readInt(overrides.MAX_STAGES || process.env.MAX_STAGES, DEFAULTS.MAX_STAGES),
    MAX_DAYS: readInt(overrides.MAX_DAYS || process.env.MAX_DAYS, DEFAULTS.MAX_DAYS),
    MAX_SETS_PER_DAY: readInt(overrides.MAX_SETS_PER_DAY || process.env.MAX_SETS_PER_DAY, DEFAULTS.MAX_SETS_PER_DAY),
    MAX_PICKS: readInt(overrides.MAX_PICKS || process.env.MAX_PICKS, DEFAULTS.MAX_PICKS),
    MAX_NOTES: readInt(overrides.MAX_NOTES || process.env.MAX_NOTES, DEFAULTS.MAX_NOTES),
    MAX_NOTE_LENGTH: readInt(overrides.MAX_NOTE_LENGTH || process.env.MAX_NOTE_LENGTH, DEFAULTS.MAX_NOTE_LENGTH),
    MAX_STATUS_TEXT: readInt(overrides.MAX_STATUS_TEXT || process.env.MAX_STATUS_TEXT, DEFAULTS.MAX_STATUS_TEXT),
    AVATAR_SIZE: avatarSize,
    AVATAR_MAX_UPLOAD_BYTES: readInt(
      overrides.AVATAR_MAX_UPLOAD_BYTES || process.env.AVATAR_MAX_UPLOAD_BYTES,
      DEFAULTS.AVATAR_MAX_UPLOAD_BYTES,
    ),
    AVATAR_MAX_PIXELS: readInt(
      overrides.AVATAR_MAX_PIXELS || process.env.AVATAR_MAX_PIXELS,
      DEFAULTS.AVATAR_MAX_PIXELS,
    ),
    AVATAR_WEBP_QUALITY: readInt(
      overrides.AVATAR_WEBP_QUALITY || process.env.AVATAR_WEBP_QUALITY,
      DEFAULTS.AVATAR_WEBP_QUALITY,
    ),
    ADMIN_SESSION_MAX: readInt(
      overrides.ADMIN_SESSION_MAX || process.env.ADMIN_SESSION_MAX,
      DEFAULTS.ADMIN_SESSION_MAX,
    ),
    USER_SESSION_MAX: readInt(overrides.USER_SESSION_MAX || process.env.USER_SESSION_MAX, DEFAULTS.USER_SESSION_MAX),
    MAX_CONCURRENT_EXPORTS: readInt(
      overrides.MAX_CONCURRENT_EXPORTS || process.env.MAX_CONCURRENT_EXPORTS,
      DEFAULTS.MAX_CONCURRENT_EXPORTS,
    ),
    MAX_CREW_IN_EXPORT: readInt(
      overrides.MAX_CREW_IN_EXPORT || process.env.MAX_CREW_IN_EXPORT,
      DEFAULTS.MAX_CREW_IN_EXPORT,
    ),
    EXPORT_COOLDOWN_MS: readInt(
      overrides.EXPORT_COOLDOWN_MS || process.env.EXPORT_COOLDOWN_MS,
      DEFAULTS.EXPORT_COOLDOWN_MS,
    ),
    EXPORT_TIMEOUT_MS: readInt(
      overrides.EXPORT_TIMEOUT_MS || process.env.EXPORT_TIMEOUT_MS,
      DEFAULTS.EXPORT_TIMEOUT_MS,
    ),
    MAX_EXPORT_SETS_PER_STREAM: readInt(
      overrides.MAX_EXPORT_SETS_PER_STREAM || process.env.MAX_EXPORT_SETS_PER_STREAM,
      DEFAULTS.MAX_EXPORT_SETS_PER_STREAM,
    ),
    SSE_HEARTBEAT_INTERVAL: readInt(
      overrides.SSE_HEARTBEAT_INTERVAL || process.env.SSE_HEARTBEAT_INTERVAL,
      DEFAULTS.SSE_HEARTBEAT_INTERVAL,
    ),
    AUDIT_LOG_RETENTION_DAYS: readInt(
      overrides.AUDIT_LOG_RETENTION_DAYS || process.env.AUDIT_LOG_RETENTION_DAYS,
      DEFAULTS.AUDIT_LOG_RETENTION_DAYS,
    ),
    SHUTDOWN_TIMEOUT_MS: readInt(
      overrides.SHUTDOWN_TIMEOUT_MS || process.env.SHUTDOWN_TIMEOUT_MS,
      DEFAULTS.SHUTDOWN_TIMEOUT_MS,
    ),
    DRAIN_BATCH_SIZE: readInt(overrides.DRAIN_BATCH_SIZE || process.env.DRAIN_BATCH_SIZE, DEFAULTS.DRAIN_BATCH_SIZE, 1),
    DRAIN_BATCH_DELAY_MS: readInt(
      overrides.DRAIN_BATCH_DELAY_MS || process.env.DRAIN_BATCH_DELAY_MS,
      DEFAULTS.DRAIN_BATCH_DELAY_MS,
      0,
    ),

    REQUEST_TIMEOUT_MS: readInt(
      overrides.REQUEST_TIMEOUT_MS || process.env.REQUEST_TIMEOUT_MS,
      DEFAULTS.REQUEST_TIMEOUT_MS,
    ),
    ROOM_CAPACITY_LIMIT: readInt(
      overrides.ROOM_CAPACITY_LIMIT || process.env.ROOM_CAPACITY_LIMIT,
      DEFAULTS.ROOM_CAPACITY_LIMIT,
      1,
    ),
    MAX_HEAP_BYTES: readInt(overrides.MAX_HEAP_BYTES || process.env.MAX_HEAP_BYTES, DEFAULTS.MAX_HEAP_BYTES, 1),
    RATE_LIMIT_CLEANUP_INTERVAL: readInt(
      overrides.RATE_LIMIT_CLEANUP_INTERVAL || process.env.RATE_LIMIT_CLEANUP_INTERVAL,
      DEFAULTS.RATE_LIMIT_CLEANUP_INTERVAL,
      1,
    ),
    EXPORT_COOLDOWN_CLEANUP_INTERVAL: readInt(
      overrides.EXPORT_COOLDOWN_CLEANUP_INTERVAL || process.env.EXPORT_COOLDOWN_CLEANUP_INTERVAL,
      DEFAULTS.EXPORT_COOLDOWN_CLEANUP_INTERVAL,
      1,
    ),
    FCM_REQUEST_TIMEOUT_MS: readInt(
      overrides.FCM_REQUEST_TIMEOUT_MS || process.env.FCM_REQUEST_TIMEOUT_MS,
      DEFAULTS.FCM_REQUEST_TIMEOUT_MS,
      1000,
    ),
    API_VERSION: overrides.API_VERSION || process.env.API_VERSION || DEFAULTS.API_VERSION,

    // Mobile app origins (TWA or custom schemes)
    MOBILE_ORIGINS: readList(overrides.MOBILE_ORIGINS || process.env.MOBILE_ORIGINS),

    // Firebase Cloud Messaging (optional — push notifications disabled when unset)
    FIREBASE_CREDENTIALS_PATH: overrides.FIREBASE_CREDENTIALS_PATH || process.env.FIREBASE_CREDENTIALS_PATH || '',

    // Apple Push Notification service (optional — iOS direct push disabled when unset).
    // expo-notifications returns a RAW APNs device token on iOS, which firebase-admin
    // cannot send. These enable a direct APNs/2 sender for iOS device tokens.
    // All empty/unset = APNs disabled (iOS tokens are skipped, never deleted).
    APNS_KEY_PATH: overrides.APNS_KEY_PATH || process.env.APNS_KEY_PATH || '',
    APNS_KEY_ID: overrides.APNS_KEY_ID || process.env.APNS_KEY_ID || '',
    APNS_TEAM_ID: overrides.APNS_TEAM_ID || process.env.APNS_TEAM_ID || 'J63QL8R63J',
    APNS_BUNDLE_ID: overrides.APNS_BUNDLE_ID || process.env.APNS_BUNDLE_ID || 'us.festie.app',
    APNS_PRODUCTION: readBool(overrides.APNS_PRODUCTION ?? process.env.APNS_PRODUCTION, true),

    // Redis (optional — falls back to in-memory when unset or disabled)
    REDIS_URL: overrides.REDIS_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    REDIS_ENABLED: readBool(overrides.REDIS_ENABLED || process.env.REDIS_ENABLED, true),
    REDIS_PREFIX: overrides.REDIS_PREFIX || process.env.REDIS_PREFIX || DEFAULTS.REDIS_PREFIX,

    // Live Location + SOS kill switches (default ON; see DEFAULTS).
    LIVE_LOCATION_ENABLED: readBool(
      overrides.LIVE_LOCATION_ENABLED ?? process.env.LIVE_LOCATION_ENABLED,
      DEFAULTS.LIVE_LOCATION_ENABLED,
    ),
    SOS_ENABLED: readBool(overrides.SOS_ENABLED ?? process.env.SOS_ENABLED, DEFAULTS.SOS_ENABLED),

    // Deep linking — populate when you have your Apple/Android signing credentials
    APPLE_TEAM_ID: overrides.APPLE_TEAM_ID || process.env.APPLE_TEAM_ID || '',
    ANDROID_CERT_FINGERPRINTS: overrides.ANDROID_CERT_FINGERPRINTS || process.env.ANDROID_CERT_FINGERPRINTS || '',

    // Resend transactional email (optional — email features disabled when unset)
    RESEND_API_KEY: overrides.RESEND_API_KEY || process.env.RESEND_API_KEY || '',
    EMAIL_FROM: overrides.EMAIL_FROM || process.env.EMAIL_FROM || 'Festie <no-reply@festie.us>',

    REFRESH_TOKEN_TTL: readInt(
      overrides.REFRESH_TOKEN_TTL || process.env.REFRESH_TOKEN_TTL,
      DEFAULTS.REFRESH_TOKEN_TTL,
      60000,
    ),
    MAX_LOGIN_FAILURES: readInt(
      overrides.MAX_LOGIN_FAILURES || process.env.MAX_LOGIN_FAILURES,
      DEFAULTS.MAX_LOGIN_FAILURES,
      1,
    ),
    LOGIN_LOCKOUT_MS: readInt(
      overrides.LOGIN_LOCKOUT_MS || process.env.LOGIN_LOCKOUT_MS,
      DEFAULTS.LOGIN_LOCKOUT_MS,
      1000,
    ),
    PROFILE_RATE_LIMIT_MAX: readInt(
      overrides.PROFILE_RATE_LIMIT_MAX || process.env.PROFILE_RATE_LIMIT_MAX,
      DEFAULTS.PROFILE_RATE_LIMIT_MAX,
      1,
    ),
    OVERLAP_RATE_LIMIT_MAX: readInt(
      overrides.OVERLAP_RATE_LIMIT_MAX || process.env.OVERLAP_RATE_LIMIT_MAX,
      DEFAULTS.OVERLAP_RATE_LIMIT_MAX,
      1,
    ),
    ADMIN_WRITE_RATE_LIMIT_MAX: readInt(
      overrides.ADMIN_WRITE_RATE_LIMIT_MAX || process.env.ADMIN_WRITE_RATE_LIMIT_MAX,
      DEFAULTS.ADMIN_WRITE_RATE_LIMIT_MAX,
      1,
    ),
    IDEMPOTENCY_TTL: readInt(overrides.IDEMPOTENCY_TTL || process.env.IDEMPOTENCY_TTL, DEFAULTS.IDEMPOTENCY_TTL, 1000),
    IDEMPOTENCY_MAX_ENTRIES: readInt(
      overrides.IDEMPOTENCY_MAX_ENTRIES || process.env.IDEMPOTENCY_MAX_ENTRIES,
      DEFAULTS.IDEMPOTENCY_MAX_ENTRIES,
      100,
    ),
    ERROR_DEDUP_WINDOW: readInt(
      overrides.ERROR_DEDUP_WINDOW || process.env.ERROR_DEDUP_WINDOW,
      DEFAULTS.ERROR_DEDUP_WINDOW,
      1000,
    ),
    ERROR_DEDUP_MAX: readInt(overrides.ERROR_DEDUP_MAX || process.env.ERROR_DEDUP_MAX, DEFAULTS.ERROR_DEDUP_MAX, 10),
    ERROR_DEDUP_CLEANUP_INTERVAL_MS: readInt(
      overrides.ERROR_DEDUP_CLEANUP_INTERVAL_MS || process.env.ERROR_DEDUP_CLEANUP_INTERVAL_MS,
      DEFAULTS.ERROR_DEDUP_CLEANUP_INTERVAL_MS,
      1000,
    ),
    PG_POOL_MIN: readInt(overrides.PG_POOL_MIN || process.env.PG_POOL_MIN, DEFAULTS.PG_POOL_MIN, 1, 20),
    PG_POOL_MAX: readInt(overrides.PG_POOL_MAX || process.env.PG_POOL_MAX, DEFAULTS.PG_POOL_MAX, 2, 50),
    EMAIL_VERIFY_TOKEN_TTL_HOURS: readInt(
      overrides.EMAIL_VERIFY_TOKEN_TTL_HOURS || process.env.EMAIL_VERIFY_TOKEN_TTL_HOURS,
      DEFAULTS.EMAIL_VERIFY_TOKEN_TTL_HOURS,
      1,
      168,
    ),

    MAX_IMPORT_SETS: readInt(overrides.MAX_IMPORT_SETS || process.env.MAX_IMPORT_SETS, DEFAULTS.MAX_IMPORT_SETS, 1),
    SPOTIFY_CACHE_TTL_MS: readInt(
      overrides.SPOTIFY_CACHE_TTL_MS || process.env.SPOTIFY_CACHE_TTL_MS,
      DEFAULTS.SPOTIFY_CACHE_TTL_MS,
      1000,
    ),
    SPOTIFY_CACHE_MAX: readInt(
      overrides.SPOTIFY_CACHE_MAX || process.env.SPOTIFY_CACHE_MAX,
      DEFAULTS.SPOTIFY_CACHE_MAX,
      1,
    ),
    MAX_EXPORT_COOLDOWN_ENTRIES: readInt(
      overrides.MAX_EXPORT_COOLDOWN_ENTRIES || process.env.MAX_EXPORT_COOLDOWN_ENTRIES,
      DEFAULTS.MAX_EXPORT_COOLDOWN_ENTRIES,
      1,
    ),
    MEMORY_WARNING_MB: readInt(
      overrides.MEMORY_WARNING_MB || process.env.MEMORY_WARNING_MB,
      DEFAULTS.MEMORY_WARNING_MB,
      64,
    ),
    MEMORY_CHECK_INTERVAL_MS: readInt(
      overrides.MEMORY_CHECK_INTERVAL_MS || process.env.MEMORY_CHECK_INTERVAL_MS,
      DEFAULTS.MEMORY_CHECK_INTERVAL_MS,
      1000,
    ),
    REMINDER_TICK_INTERVAL_MS: readInt(
      overrides.REMINDER_TICK_INTERVAL_MS || process.env.REMINDER_TICK_INTERVAL_MS,
      DEFAULTS.REMINDER_TICK_INTERVAL_MS,
      1000,
    ),
    REMINDER_FIRE_WINDOW_MS: readInt(
      overrides.REMINDER_FIRE_WINDOW_MS || process.env.REMINDER_FIRE_WINDOW_MS,
      DEFAULTS.REMINDER_FIRE_WINDOW_MS,
      1000,
    ),
    REMINDER_DEDUP_TTL_MS: readInt(
      overrides.REMINDER_DEDUP_TTL_MS || process.env.REMINDER_DEDUP_TTL_MS,
      DEFAULTS.REMINDER_DEDUP_TTL_MS,
      1000,
    ),
    TOKEN_CLEANUP_INTERVAL_MS: readInt(
      overrides.TOKEN_CLEANUP_INTERVAL_MS || process.env.TOKEN_CLEANUP_INTERVAL_MS,
      DEFAULTS.TOKEN_CLEANUP_INTERVAL_MS,
      1000,
    ),
    WEATHER_API_TIMEOUT_MS: readInt(
      overrides.WEATHER_API_TIMEOUT_MS || process.env.WEATHER_API_TIMEOUT_MS,
      DEFAULTS.WEATHER_API_TIMEOUT_MS,
      1000,
    ),

    // Webhook / FCM retry integration
    WEBHOOK_TOKEN_HMAC_KEY:
      overrides.WEBHOOK_TOKEN_HMAC_KEY || process.env.WEBHOOK_TOKEN_HMAC_KEY || DEFAULTS.WEBHOOK_TOKEN_HMAC_KEY,
    WEBHOOK_RETRY_TIMEOUT_MS: readInt(
      overrides.WEBHOOK_RETRY_TIMEOUT_MS || process.env.WEBHOOK_RETRY_TIMEOUT_MS,
      DEFAULTS.WEBHOOK_RETRY_TIMEOUT_MS,
      1000,
    ),
    FCM_RETRY_WEBHOOK_URL:
      overrides.FCM_RETRY_WEBHOOK_URL || process.env.FCM_RETRY_WEBHOOK_URL || DEFAULTS.FCM_RETRY_WEBHOOK_URL,

    // Spotify (optional — lineup import / search disabled when unset)
    SPOTIFY_CLIENT_ID: overrides.SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID || DEFAULTS.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET:
      overrides.SPOTIFY_CLIENT_SECRET || process.env.SPOTIFY_CLIENT_SECRET || DEFAULTS.SPOTIFY_CLIENT_SECRET,

    // Cluster / observability
    CLUSTER_SIZE: Number(readInt(overrides.CLUSTER_SIZE || process.env.CLUSTER_SIZE, DEFAULTS.CLUSTER_SIZE, 1, 64)),
    LOG_LEVEL: overrides.LOG_LEVEL || process.env.LOG_LEVEL || DEFAULTS.LOG_LEVEL,
    SENTRY_DSN: overrides.SENTRY_DSN || process.env.SENTRY_DSN || DEFAULTS.SENTRY_DSN,
    SENTRY_TRACES_RATE: Number(
      overrides.SENTRY_TRACES_RATE ?? process.env.SENTRY_TRACES_RATE ?? DEFAULTS.SENTRY_TRACES_RATE,
    ),
    SENTRY_PROFILES_RATE: Number(
      overrides.SENTRY_PROFILES_RATE ?? process.env.SENTRY_PROFILES_RATE ?? DEFAULTS.SENTRY_PROFILES_RATE,
    ),
    APP_VERSION: overrides.APP_VERSION || process.env.APP_VERSION || APP_VERSION || DEFAULTS.APP_VERSION,

    // SESSION_SECRET: reserved for future HMAC-signed session tokens.
    // Currently NOT used cryptographically — session tokens are random opaque
    // strings stored server-side (SHA-256 hashed). The production startup
    // check in server.js ensures this is set to a strong value so the key is
    // available when session signing is introduced without a redeployment.
    // See ADR-004 for the CSRF/session security design rationale.
    SESSION_SECRET: overrides.SESSION_SECRET || process.env.SESSION_SECRET || '',
  };
}
