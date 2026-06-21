import { describe, it, expect } from 'vitest';
import {
  FESTIE_RUNTIME_CACHING,
  FESTIVAL_CATALOG_RE,
  WEATHER_RE,
  type RuntimeCachingRule,
} from './runtimeCaching';

// THE GATE (unification plan v2 §3.3).
//
// The cross-account cache boundary lives in the festival-catalog regex: the SW
// may URL-key cache the PUBLIC catalog, but must NEVER cache per-user paths
// (those are keyed by session cookie, so on a shared device an account switch
// would repaint the previous user's data). vite.config.ts imports
// FESTIE_RUNTIME_CACHING and spreads it into the shipped SW, so this test guards
// the real service worker — not a copy. If it fails, do NOT relax it: the
// boundary is a security property.

describe('SW cache boundary — festival catalog regex', () => {
  it('matches the public catalog endpoints', () => {
    expect(FESTIVAL_CATALOG_RE.test('/api/v1/festivals')).toBe(true);
    expect(FESTIVAL_CATALOG_RE.test('/api/v1/festivals/abc')).toBe(true);
  });

  it('REJECTS per-user and sub-resource paths (cross-account boundary)', () => {
    // Festival sub-resource that carries inline per-user pick state.
    expect(FESTIVAL_CATALOG_RE.test('/api/v1/festivals/abc/picks')).toBe(false);
    // The four per-user prefixes that must stay out of the URL-keyed cache.
    expect(FESTIVAL_CATALOG_RE.test('/api/v1/profiles/me')).toBe(false);
    expect(FESTIVAL_CATALOG_RE.test('/api/v1/crews')).toBe(false);
    expect(FESTIVAL_CATALOG_RE.test('/api/v1/auth/me')).toBe(false);
  });
});

describe('SW cache boundary — weather regex', () => {
  it('matches the public per-festival weather endpoint', () => {
    expect(WEATHER_RE.test('/api/v1/weather/abc')).toBe(true);
  });

  it('rejects the bare /weather path (no festival id)', () => {
    expect(WEATHER_RE.test('/api/v1/weather')).toBe(false);
    expect(WEATHER_RE.test('/api/v1/weather/')).toBe(false);
  });
});

describe('runtimeCaching config parity (vite.config.ts ↔ shared)', () => {
  it('has exactly four rules', () => {
    expect(FESTIE_RUNTIME_CACHING).toHaveLength(4);
  });

  it('declares the expected cacheNames in order', () => {
    const names = FESTIE_RUNTIME_CACHING.map((r) => r.options?.cacheName);
    expect(names).toEqual(['api-cache', 'weather-cache', 'art-cache', 'google-fonts']);
  });

  it('declares the expected handlers in order', () => {
    const handlers = FESTIE_RUNTIME_CACHING.map((r) => r.handler);
    expect(handlers).toEqual([
      'StaleWhileRevalidate',
      'NetworkFirst',
      'CacheFirst',
      'CacheFirst',
    ]);
  });

  it('keeps the load-bearing per-rule options (timeouts + expiration)', () => {
    const byName = Object.fromEntries(
      FESTIE_RUNTIME_CACHING.map((r) => [r.options?.cacheName, r] as const),
    ) as Record<string, RuntimeCachingRule>;

    expect(byName['api-cache'].options?.expiration).toEqual({
      maxEntries: 50,
      maxAgeSeconds: 60 * 60,
    });
    expect(byName['weather-cache'].options?.networkTimeoutSeconds).toBe(4);
    expect(byName['weather-cache'].options?.expiration).toEqual({
      maxEntries: 30,
      maxAgeSeconds: 60 * 60 * 6,
    });
    expect(byName['art-cache'].options?.expiration).toEqual({
      maxEntries: 300,
      maxAgeSeconds: 60 * 60 * 24 * 30,
    });
    expect(byName['google-fonts'].options?.expiration).toEqual({
      maxEntries: 10,
      maxAgeSeconds: 60 * 60 * 24 * 365,
    });
  });
});
