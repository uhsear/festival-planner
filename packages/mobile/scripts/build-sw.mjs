#!/usr/bin/env node
/**
 * build-sw.mjs — Generate the Expo-web service worker via workbox-build.
 *
 * Usage (called by build:web):
 *   node scripts/build-sw.mjs
 *
 * Override the export dir:
 *   EXPO_WEB_DIST=/path/to/dist node scripts/build-sw.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SERIALIZATION CAVEAT — READ BEFORE EDITING
 * ─────────────────────────────────────────────────────────────────────────────
 * workbox-build's generateSW serializes function urlPattern matchers via
 * fn.toString().  The first two rules in FESTIE_RUNTIME_CACHING reference
 * module-scope regex constants (FESTIVAL_CATALOG_RE, WEATHER_RE) whose *names*
 * will appear as string tokens in the generated SW, but the regex objects they
 * reference are NOT in scope in the generated file → both matchers would be
 * broken at runtime (ReferenceError, every request falls through uncached).
 *
 * vite-plugin-pwa (packages/web) is not affected because it re-bundles the
 * entire config through Rollup, bringing the consts into scope in the SW
 * bundle. generateSW does NOT re-bundle — it inlines a fn.toString() verbatim.
 *
 * RESOLUTION: this script inlines self-contained regex literals for those two
 * rules rather than re-using the shared arrow functions.  The regex literals are
 * identical to FESTIVAL_CATALOG_RE and WEATHER_RE (verified by inspection of
 * packages/shared/src/pwa/runtimeCaching.ts).  The remaining two rules in
 * FESTIE_RUNTIME_CACHING are safe:
 *   - art-cache   : matcher uses inline regex literals inside the arrow fn
 *   - google-fonts: urlPattern is a plain RegExp (not a function), serialized
 *                   directly as a regex literal by workbox-build
 *
 * TRACKING: packages/shared/src/pwa/runtimeCaching.ts should be updated so
 * the first two matcher functions inline their regex literals (making them
 * self-contained) rather than referencing module-scope consts.  Until that
 * happens this script provides the safe standalone equivalents.  See the
 * serialization-caveat issue in the task manifest.
 *
 * VALIDATION NOTE: correctness of the generated SW is verified by running
 * build:web and inspecting dist/sw.js.  That run is deferred to the Phase 0
 * build run and is outside the scope of this task.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generateSW } from 'workbox-build';
import { FESTIE_RUNTIME_CACHING } from '@festie/shared/pwa';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ── Export dir ──────────────────────────────────────────────────────────────
const distDir = resolve(
  process.env.EXPO_WEB_DIST ||
  resolve(__dirname, '..', 'dist'),
);

if (!existsSync(distDir)) {
  console.error(
    `[build-sw] ERROR: export dir not found: ${distDir}\n` +
    `Run 'expo export -p web' first (or set EXPO_WEB_DIST to the correct path).`,
  );
  process.exit(1);
}

// ── Self-contained runtime caching rules ────────────────────────────────────
//
// Rules 3 (art-cache) and 4 (google-fonts) come from FESTIE_RUNTIME_CACHING
// directly — their matchers are self-contained and generateSW serializes them
// correctly.
//
// Rules 1 (api-cache) and 2 (weather-cache) are replaced here with inline
// equivalents whose arrow functions do NOT reference any external const.
// The regex literals are identical to FESTIVAL_CATALOG_RE and WEATHER_RE.
// See the serialization caveat comment at the top of this file.

/** @type {import('workbox-build').RuntimeCaching[]} */
const runtimeCaching = [
  {
    // api-cache: self-contained equivalent of FESTIE_RUNTIME_CACHING[0].
    // Regex inlined from FESTIVAL_CATALOG_RE = /^\/api\/v1\/festivals(\/[^/]+)?$/
    urlPattern: ({ url, request }) =>
      request.method === 'GET' &&
      /^\/api\/v1\/festivals(\/[^/]+)?$/.test(url.pathname),
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'api-cache',
      expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
  {
    // weather-cache: self-contained equivalent of FESTIE_RUNTIME_CACHING[1].
    // Regex inlined from WEATHER_RE = /^\/api\/v1\/weather\/[^/]+$/
    urlPattern: ({ url, request }) =>
      request.method === 'GET' &&
      /^\/api\/v1\/weather\/[^/]+$/.test(url.pathname),
    handler: 'NetworkFirst',
    options: {
      cacheName: 'weather-cache',
      networkTimeoutSeconds: 4,
      expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 6 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
  // art-cache and google-fonts from the shared source of truth.
  // Indices 2 and 3 are serialization-safe (see caveat comment above).
  FESTIE_RUNTIME_CACHING[2],
  FESTIE_RUNTIME_CACHING[3],
];

// ── generateSW ──────────────────────────────────────────────────────────────
const { count, size, warnings } = await generateSW({
  swDest: resolve(distDir, 'sw.js'),
  globDirectory: distDir,
  globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  // Metro's web export does NOT emit admin-prefixed chunks — routes are named
  // after the route segment (e.g. account-*.js, audit-*.js) and admin screens
  // are either inlined in the entry bundle or emitted as non-admin filenames.
  // The original '**/admin-*.js' glob matched nothing in dist/_expo/static/js/web/
  // (verified June 2026 against the actual dist listing).  Dropped to avoid a
  // misleading no-op.  If a future refactor extracts admin chunks with a known
  // naming convention, add a targeted pattern here.
  globIgnores: [],

  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,

  // Expo's Metro web export emits a single monolithic entry bundle (~5 MB
  // measured in the Phase 0 spike) rather than Vite's code-split chunks. The
  // workbox default cap (2 MB) would skip precaching the app shell, breaking
  // offline schedule viewing — the core PWA value. Raise the cap so the shell
  // precaches. Shrinking this bundle via expo-router lazy routes is a Phase 2
  // perf follow-up that would let this drop back toward the default.
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,

  navigateFallback: 'index.html',
  navigateFallbackDenylist: [
    /^\/privacy/,
    /^\/terms/,
    /^\/security-whitepaper/,
    /\.html$/,
    /^\/api/,
    /^\/\.well-known/,
    // Server-owned flows: password reset and crew-join links must hit the
    // network so the server can validate tokens / redirect correctly.
    // Without these the installed PWA intercepts them and serves index.html,
    // which means the token never reaches the server and the flow breaks.
    /^\/reset(\/|-password)/,
    /^\/join\//,
  ],

  runtimeCaching,
});

if (warnings.length > 0) {
  console.warn('[build-sw] workbox warnings:');
  warnings.forEach((w) => console.warn(' ', w));
}

console.log(
  `[build-sw] Generated dist/sw.js — ${count} precache entries, ${(size / 1024).toFixed(1)} KB`,
);
