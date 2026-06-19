# ADR-011: Multi-Tier Rate Limiting with Redis Primary / In-Memory Fallback

**Status:** Accepted
**Date:** 2026-06-19

## Context

A single-process in-memory rate limiter is straightforward but becomes inaccurate under PM2
multi-worker deployments: with N workers, the effective cluster-wide limit inflates to N × the
configured maximum because each process tracks its own counters independently. A pure Redis-based
limiter is accurate cluster-wide but introduces a hard dependency on Redis availability — if Redis
goes down, all API requests would either be unthrottled or blocked entirely depending on the
failure policy.

A 2026-04-09 hardening audit (documented in `lib/rate-limiting.ts`) found that the previous
implementation silently fell back to per-process counters with no logging, no metrics, and no
cluster-size correction, meaning Redis degradation was invisible and the effective limit drifted
under any Redis outage.

## Decision

`lib/rate-limiting.ts` implements a multi-tier check via `tryRedisRateCheck()`. For each
rate-limited request, Redis is tried first using an atomic `INCR` + `PEXPIRE` pipeline
(`lib/redis.ts::redisRateCheck`). If Redis returns a result without the `fallback` flag, that
result is used. If Redis throws or signals fallback, the function falls back to a per-process
in-memory `Map` but divides the configured maximum by `CLUSTER_SIZE` (read from
`config.CLUSTER_SIZE`, default 1) so that each worker's local counter approximates the
cluster-wide budget. Fallback events are counted per tier (`global`, `scoped`, `auth`, `socket`)
and a throttled `WARN` log fires at most once per 30 seconds per tier; a `prom-client` counter
(`rateLimitFallbackCounter`) is incremented for metric alerting. Map entries are pruned via LRU
eviction at 10,000 entries, and a 60-second interval removes expired windows.

Specialized limiters follow the same pattern: the per-email password-reset limiter hashes the
email address with SHA-256 before using it as a Redis key (for privacy), then falls back to a
module-local Map. Socket-event limiters (`PICK_SET_LIMIT`, `NOTE_ADD_LIMIT`,
`STATUS_UPDATE_LIMIT`, `PRESENCE_UPDATE_LIMIT`, `LOCATION_UPDATE_LIMIT`, `SOS_RAISE_LIMIT`) are
in-memory with optional `consumeAsync()` Redis variants.

## Consequences

- Rate limits remain functional during Redis outages; the server does not fail open or hard-block
  all traffic.
- Fallback events are immediately observable in logs and Prometheus metrics, ending the previous
  silent-drift problem.
- With `CLUSTER_SIZE` correctly configured, the fallback approximation bounds abuse even during
  Redis downtime — a 3-attempt-per-hour password-reset limit becomes 3/N per worker, which is
  conservative.
- Trade-off: Redis is the accuracy baseline; the in-memory fallback is an approximation. A
  sophisticated attacker who can time requests to hit different workers during a Redis outage may
  exceed the intended limit by a small factor, up to `CLUSTER_SIZE × effectiveMax`.
- Trade-off: `CLUSTER_SIZE` is a static config value, not auto-detected from PM2. If the number
  of workers changes without updating this config key, the fallback divisor becomes incorrect.
- Trade-off: the `ecosystem.config.cjs` currently sets `instances: 1` and `exec_mode: 'fork'`
  (see ADR-007), so `CLUSTER_SIZE=1` is accurate today. If the deployment grows to multiple
  workers (requiring a compiled-JS backend), the rate-limiting tier remains correct — but that
  transition requires a coordinated config update.
- Trade-off: socket-event limiters (`SOS_RAISE_LIMIT` is noted explicitly in code comments) are
  per-process in-memory with no Redis variant, meaning under multi-worker PM2 the effective SOS
  raise cap drifts to `N × 1 per 120s`. A coarse HTTP-layer `rateLimit()` middleware on the route
  bounds the worst case.
