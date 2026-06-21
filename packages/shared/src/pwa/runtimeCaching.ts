// Single source of truth for the web PWA service-worker runtimeCaching config.
//
// THE GATE: this file is the cross-account cache boundary. The web build imports
// FESTIE_RUNTIME_CACHING into `vite.config.ts` and spreads it into VitePWA's
// `workbox.runtimeCaching`, so the shipped service worker is generated from THIS
// config — not a copy. `sw-parity.test.ts` guards it. Editing the cache rules in
// vite.config.ts directly is therefore impossible without it drifting from the
// gate; do it here.
//
// Why it lives in @festie/shared and not packages/web: the unification plan
// (v2 §3.3) moves the SW config here so web + mobile share one boundary
// definition. Mobile does not consume the runtimeCaching array at runtime, but
// the regex constants below are the shared contract for "what is safe to cache".
//
// IMPORTANT: do NOT import workbox-build's types here. workbox-build is a
// web-only build dependency; importing it would leak a web-only dep into shared
// (consumed by React Native). The rule shape is hand-written below as
// RuntimeCachingRule.

/**
 * The PUBLIC festival-catalog endpoints that are safe to URL-key cache:
 * `GET /api/v1/festivals` and `GET /api/v1/festivals/:id`.
 *
 * It deliberately REJECTS per-user / sub-resource paths
 * (`/festivals/:id/picks`, `/profiles/me`, `/crews`, `/auth/me`) — those are
 * keyed by session cookie and must never be served stale across an account
 * switch on a shared device. This regex is the cross-account boundary the gate
 * test asserts.
 */
export const FESTIVAL_CATALOG_RE = /^\/api\/v1\/festivals(\/[^/]+)?$/;

/**
 * The PUBLIC weather endpoint (`GET /api/v1/weather/:festivalId`). Weather keys
 * off the festival's coordinates, not the user, so URL-keyed caching is safe.
 */
export const WEATHER_RE = /^\/api\/v1\/weather\/[^/]+$/;

/**
 * Local structural type mirroring the subset of workbox-build's
 * `RuntimeCaching` shape that we use. Hand-written on purpose so shared does not
 * depend on the web-only `workbox-build` package (see file header). `vite-plugin-pwa`
 * accepts this structure directly.
 */
export interface RuntimeCachingRule {
  urlPattern: RegExp | ((opts: { url: URL; request: Request }) => boolean);
  handler: 'StaleWhileRevalidate' | 'NetworkFirst' | 'CacheFirst' | 'NetworkOnly' | 'CacheOnly';
  options?: {
    cacheName?: string;
    networkTimeoutSeconds?: number;
    expiration?: { maxEntries?: number; maxAgeSeconds?: number };
    cacheableResponse?: { statuses?: number[] };
  };
}

/**
 * The four runtimeCaching rules transcribed 1:1 from the (former) inline array
 * in `packages/web/vite.config.ts`. The comments preserve the load-bearing
 * rationale for each rule.
 */
export const FESTIE_RUNTIME_CACHING: RuntimeCachingRule[] = [
  {
    // Cache ONLY the public festival catalog (GET /festivals,
    // /festivals/:id) for offline schedule viewing. Per-user endpoints
    // (/auth, /profiles, /crews, /account) must never be cached —
    // StaleWhileRevalidate keys by URL only (ignores the session
    // cookie), so on a shared device an account switch would otherwise
    // repaint the previous user's data until the revalidate lands.
    urlPattern: ({ url, request }: { url: URL; request: Request }) =>
      request.method === 'GET' && FESTIVAL_CATALOG_RE.test(url.pathname),
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'api-cache',
      expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
  {
    // F5: cache the PUBLIC weather GET (/api/v1/weather/:festivalId) so a
    // downloaded festival shows its forecast offline. Weather is NOT
    // per-user (it keys off the festival's coords), so URL-keyed SW
    // caching is safe here — unlike /profiles or /crews, which stay in
    // zustand-persist. NetworkFirst with a short timeout: prefer fresh
    // data when online, fall back to the cached forecast when offline.
    urlPattern: ({ url, request }: { url: URL; request: Request }) =>
      request.method === 'GET' && WEATHER_RE.test(url.pathname),
    handler: 'NetworkFirst',
    options: {
      cacheName: 'weather-cache',
      networkTimeoutSeconds: 4,
      expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 6 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
  {
    // F5: CacheFirst for artist/album art (Spotify CDNs + our app art
    // host). These are immutable, content-addressed PUBLIC images — once
    // cached they render offline on set cards / detail panels. Bounded to
    // ~300 entries so the cache can't grow unbounded on a big lineup.
    urlPattern: ({ url }: { url: URL }) =>
      /(^|\.)scdn\.co$/.test(url.hostname) ||
      /(^|\.)spotifycdn\.com$/.test(url.hostname) ||
      url.hostname === 'art.festie.us',
    handler: 'CacheFirst',
    options: {
      cacheName: 'art-cache',
      expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
  {
    urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
    handler: 'CacheFirst',
    options: {
      cacheName: 'google-fonts',
      expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
    },
  },
];
