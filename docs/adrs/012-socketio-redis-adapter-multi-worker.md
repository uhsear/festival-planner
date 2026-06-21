# ADR-012: Socket.IO with Redis Adapter for Multi-Worker Real-Time Broadcasting

**Status:** Accepted
**Date:** 2026-06-19

## Context

Festie uses Socket.IO for real-time festival room broadcasts (crew updates, presence changes, pick
sync, live status). When the server runs as multiple OS processes (PM2 workers), a socket
connected to worker A cannot receive an event emitted by worker B unless there is a cross-process
pub/sub layer. Without it, broadcasts only reach clients connected to the same worker that emitted
the event, causing silent data loss for a fraction of users.

Redis already exists in the stack for rate limiting, session storage, and presence tracking,
making it a natural pub/sub transport for Socket.IO. The alternative — sticky sessions at the load
balancer — was not applicable because the Cloudflare Tunnel terminates TLS and does not support
session affinity configuration at the application level.

## Decision

`lib/socket-setup.ts` attaches the `@socket.io/redis-adapter` (`createAdapter`) to the Socket.IO
server when a Redis client is available. Two separate ioredis connections are required by the
adapter (one for publish, one for subscribe); the subscriber is created via `duplicateClient(redis)`
which sets `maxRetriesPerRequest: null` so ioredis retries via `retryStrategy` rather than
throwing `MaxRetriesPerRequestError` inside the adapter (an unhandled rejection that would crash
the worker). The adapter key prefix is `fp-sio`. If Redis is unavailable or `createAdapter`
throws, the code catches the error and logs a warning, allowing the server to start with
in-memory (single-process) broadcast only.

Socket.IO is configured for `transports: ['websocket']` only (no long-polling fallback), with a
5-second post-connection authentication timeout: unauthenticated sockets that do not emit a
`join:festival` event within 5 seconds are forcibly disconnected.

## Consequences

- Cross-worker broadcasts work correctly: a crew update emitted by any worker reaches all
  connected clients regardless of which worker their socket landed on.
- Redis pub/sub uses a dedicated subscriber connection (ioredis in subscribe mode cannot issue
  regular commands), resulting in two Redis connections per worker for the Socket.IO adapter plus
  additional connections for rate limiting and presence. Total Redis connections per worker is
  approximately 4–5.
- Graceful fallback: if Redis is down at startup, the adapter is skipped and Socket.IO operates
  in single-process mode. Existing connections are not terminated; only cross-worker fan-out is
  lost.
- Trade-off: currently `ecosystem.config.cjs` runs `instances: 1` (see ADR-007), so the Redis
  adapter provides no practical benefit in the current production configuration — but it is in
  place and correct for future multi-worker scaling.
- Trade-off: the Redis adapter adds latency to every broadcast event (a pub/sub round-trip through
  Redis). For festival rooms broadcasting presence updates at 500ms debounce intervals, this
  overhead is negligible, but it is a consideration for any high-frequency event type added in the
  future.
- Trade-off: the adapter key prefix (`fp-sio`) is hardcoded. If multiple Festie environments
  (staging, production) share the same Redis instance, their Socket.IO events would bleed into
  each other; this is prevented by using separate Redis instances per environment.
