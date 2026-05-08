# Festie Architecture

## Overview

Festie is a real-time festival crew coordination app built as a monorepo. The backend is a Node.js 22 server using Express 5, Socket.IO 4, PostgreSQL 16, and Redis 7. The frontend is a React 19 SPA with TanStack Router, Zustand, and Tailwind CSS 4, built with Vite 8. A shared TypeScript package provides stores, hooks, types, and utilities consumed by the frontend.

**Stack:** Node.js 22 + Express 5 + Socket.IO 4 + PostgreSQL 16 + Redis 7 | React 19 + Vite 8 + TanStack Router + Zustand + Tailwind CSS 4

---

## Backend Architecture

### Entry Point: `server.js` (392 lines)

The server is a thin orchestrator. It delegates all infrastructure setup to extracted modules:

```
server.js ─── orchestrator
  lib/app-context/ ─── DI composition (config, DB, Redis, caches, auth, rate limiters)
  lib/middleware.js ── Express middleware stack (security, CORS, parsing, metrics)
  lib/socket-setup.js  Socket.IO server + Redis adapter
  lib/shutdown.js ──── graceful shutdown + background cleanup tasks
  routes/*.js ──────── 29 API route modules (factory pattern)
```

`server.js` calls `createAppContext()` to build the dependency injection container, applies middleware, mounts routes, starts Socket.IO, and registers shutdown handlers. It validates startup configuration (PUBLIC_ORIGIN, SESSION_SECRET, webhook keys) before any initialization runs.

### Dependency Injection: `lib/app-context/` (580 lines)

`lib/app-context/index.js` is the central composition root. It creates and wires together every infrastructure dependency into a single `deps` object that route factories receive. Extracted sub-modules:

| File | Lines | Responsibility |
|------|-------|----------------|
| `index.js` | 580 | Compose config, DB pool, Redis, caches, auth, sessions, utilities |
| `csp.js` | 36 | Content Security Policy header generation |
| `avatar.js` | 130 | Avatar upload validation, resizing (Sharp worker pool), storage |
| `request-helpers.js` | 118 | IP extraction, origin checks, CSRF enforcement |
| `cookies.js` | 103 | Session cookie management (set, clear, parse) |

### Core Library Modules: `lib/`

| Module | Lines | Purpose |
|--------|-------|---------|
| `config.js` | 253 | Centralized env vars with typed readers (`readInt`, `readBool`, `readList`) and defaults |
| `schemas.js` | 538 | Zod validation schemas for all API inputs + normalization helpers |
| `rate-limiting.js` | 458 | Multi-tier rate limiting: in-memory (single process) or Redis-backed (cluster) |
| `planner-db-pg.js` | 441 | PostgreSQL connection pool, migration runner, store factory |
| `redis.js` | 405 | Redis client, rate limiter, presence store, cache invalidation bus, circuit breaker |
| `middleware.js` | 338 | Express middleware composition (Helmet, CORS, compression, body parsing, metrics, rate limits) |
| `reset-pages.js` | 306 | Password reset HTML page templates |
| `metrics.js` | 267 | Prometheus metrics (prom-client) collection and endpoint |
| `shutdown.js` | 230 | Graceful shutdown (drain requests, close DB/Redis, clear timers) + background task scheduling |
| `openapi.js` | 203 | OpenAPI 3.0 spec generation from route metadata |
| `emitter.js` | 208 | Typed event emitter for internal pub/sub |
| `reminder-scheduler.js` | 199 | Background scheduler for set reminders (push notifications) |
| `invite-pages.js` | 194 | Crew invite HTML page templates |
| `presence.js` | 191 | Socket.IO presence tracking (online users per festival) |
| `helpers.js` | 190 | Legacy utilities (being migrated to `lib/helpers/`) |
| `logger.js` | 180 | Pino logger with JSON output, sensitive field redaction |
| `email.js` | 143 | Transactional email via Resend (password reset, invites) |
| `audit-middleware.js` | 116 | Express middleware for audit log entries |
| `avatar-pool.js` | 116 | Worker thread pool for Sharp image processing |
| `sentry.js` | 114 | Sentry error tracking integration |
| `spotify.js` | 114 | Spotify API client for artist metadata |
| `socket-setup.js` | 96 | Socket.IO server creation + Redis adapter attachment |
| `crypto-auth.js` | 55 | Password hashing (scrypt) + session token hashing (SHA-256) |

Smaller modules (<100 lines): `analytics-template.js`, `pagination.js`, `error-codes.js`, `tracing.js`, `file-storage.js`, `response.js`, `swagger-ui-setup.js`, `avatar-worker.js`, `export-worker.js`, `constants.js`, `validation.js`.

### Helpers: `lib/helpers/`

| File | Lines | Purpose |
|------|-------|---------|
| `export-utils.js` | 353 | HTML + ICS export generation, crew filtering |
| `sanitize.js` | 186 | Input sanitization, HTML escaping, log field redaction |
| `validation.js` | 136 | Time, color, festival structure validation |

### Notifications: `lib/notifications/`

FCM push notification subsystem with retry and do-not-disturb support.

| File | Lines | Purpose |
|------|-------|---------|
| `send.js` | 491 | Firebase Cloud Messaging dispatch (batch + individual) |
| `payload.js` | 74 | Notification payload builders (chat, picks, crew events) |
| `retry.js` | 70 | Exponential backoff retry for failed sends |
| `dnd.js` | 23 | Do-not-disturb time window checks |
| `index.js` | 38 | Module barrel export |

### Data Access: `lib/db/stores/`

13 store modules, each exporting CRUD functions that accept a `pool` (pg Pool) parameter. All queries use parameterized SQL (`$1, $2`).

| Store | Lines | Tables |
|-------|-------|--------|
| `profiles.js` | 283 | `festival_profiles` -- picks, notes, reminders, live status |
| `crews.js` | 278 | `crews`, `crew_members`, `crew_activity` |
| `festivals.js` | 248 | `festivals`, `festival_stages`, `festival_days`, `festival_sets` |
| `users.js` | 211 | `users` -- accounts, avatars, display names |
| `sessions.js` | 209 | `user_sessions`, `admin_sessions`, `refresh_tokens` |
| `notifications.js` | 186 | `device_tokens`, `notification_preferences` |
| `roles.js` | 126 | `user_roles`, `permissions` |
| `audit.js` | 119 | `audit_log` -- user actions, admin operations |
| `polls.js` | 112 | `crew_polls`, `poll_votes` |
| `expenses.js` | 93 | `crew_expenses`, `expense_splits` |
| `ratings.js` | 88 | `set_ratings` -- post-festival artist ratings |
| `calendar-tokens.js` | 36 | `calendar_tokens` -- ICS feed authentication |
| `activity.js` | 29 | `crew_activity` -- crew event feed |

### Routes: `routes/`

29 route modules, each a factory function receiving `deps` and returning an Express Router:

```js
module.exports = function createFeatureRoutes({ pool, redis, config, io, log, ... }) {
  const router = express.Router();
  // ...
  return router;
};
```

| Route | Lines | Responsibility |
|-------|-------|----------------|
| `crews.js` | 641 | Crew CRUD, member management, invites, join/leave |
| `auth.js` | 503 | Register, login, logout, refresh tokens, change password |
| `export.js` | 485 | HTML/ICS exports, presence list, message export |
| `admin-status.js` | 433 | Admin dashboard: server status, connections, DB stats |
| `share.js` | 431 | Festival sharing, public schedule links |
| `socket.js` | 404 | Real-time: presence, chat, typing, reactions, crew updates |
| `email-auth.js` | 368 | Email-based auth (magic links, verification, password reset) |
| `account.js` | 334 | Profile settings, avatar upload/delete, display name |
| `admin-users.js` | 283 | Admin user management, search, ban, password reset |
| `festivals.js` | 278 | Festival CRUD, clone, stage/day/set management |
| `lineup-import.js` | 273 | Festival lineup import (CSV, JSON, Clashfinder) |
| `notifications.js` | 269 | Push tokens, notification preferences, mark read |
| `admin.js` | 267 | Admin login, session management, role checks |
| `admin-metrics.js` | 255 | Prometheus metrics endpoint, custom dashboards |
| `profiles.js` | 237 | Join festival, update picks/notes/reminders, live status |
| `crew-features.js` | 237 | Crew polls, expenses, meeting points |
| `admin-bulk.js` | 187 | Bulk admin operations (mass email, data export) |
| `health-core.js` | 148 | Health checks (DB, Redis, disk), readiness probe |
| `calendar-sync.js` | 148 | ICS calendar feed generation and sync |
| `pages.js` | 140 | Static pages, password reset forms, SPA catch-all |
| `spotify.js` | 122 | Spotify artist search and metadata |
| `expenses.js` | 115 | Crew expense tracking and splitting |
| `client-metrics.js` | 96 | Client-side performance metrics ingestion |
| `weather.js` | 92 | Festival venue weather forecasts |
| `ratings.js` | 90 | Post-festival set ratings |
| `deep-links.js` | 72 | Universal/deep link handlers (mobile app) |
| `admin-audit.js` | 65 | Audit log viewer |
| `health.js` | 64 | Legacy health endpoint (delegates to health-core) |
| `analytics-install.js` | 57 | Install/first-launch analytics |
| `activity.js` | 25 | Crew activity feed |

---

## Frontend: `packages/web/`

React 19 SPA with file-based routing via TanStack Router. Built with Vite 8 and Tailwind CSS 4. Routes are lazy-loaded with skeleton fallbacks. Vite config uses manual chunk splitting for HTTP/2 cache optimization (react-core, router, data, ui-motion, icons, export-tools, telemetry).

### Routes (`packages/web/src/routes/`)

| Route | Lines | View |
|-------|-------|------|
| `timeline.tsx` | 656 | Main schedule timeline (drag-scroll, time markers) |
| `account.tsx` | 466 | User settings, avatar, notifications, sessions |
| `grid.tsx` | 368 | Grid/spreadsheet schedule view |
| `crew.tsx` | 343 | Crew management, chat, member list |
| `wrap.tsx` | 269 | Post-festival wrap-up / recap |
| `picks.tsx` | 244 | Personal picks list with conflict detection |
| `festival-mode.tsx` | 198 | Festival day-of mode (current/next set) |
| `register.tsx` | 186 | User registration |
| `compare.tsx` | 184 | Side-by-side crew schedule comparison |
| `forgot-password.tsx` | 139 | Password reset flow |
| `cards.tsx` | 124 | Card-style schedule view |
| `login.tsx` | 118 | Login form |
| `admin.tsx` | 72 | Admin panel |

### PWA

Workbox service worker for offline support. localStorage snapshots of festivals, profiles, and messages are updated on every state change. A sync queue replays profile mutations (picks, notes, reminders) when connectivity is restored.

---

## Shared Package: `packages/shared/`

TypeScript package imported by the frontend via workspace aliases (`@festie/shared/stores`, `@festie/shared/types`, etc.).

### Stores (Zustand)

| Store | Lines | State |
|-------|-------|-------|
| `festivalStore.ts` | 307 | Festival data, sets, stages, days |
| `authStore.ts` | 263 | User session, tokens, login state |
| `crewStore.ts` | 226 | Crew membership, activity, chat |
| `festivalModeStore.ts` | 122 | Day-of festival mode (current set tracking) |
| `uiStore.ts` | 73 | UI state (modals, toasts, theme) |

### Services

- `api.ts` (183 lines) -- HTTP client wrapping fetch with auth headers, error handling
- `socket.ts` (66 lines) -- Socket.IO client with auto-reconnect, event listeners that push into Zustand stores

### Hooks

`useAuth`, `useFestival`, `useCrew`, `usePicks`, `useSocket`, `useOffline` -- React hooks bridging Zustand stores to components.

### Types

`domain.ts`, `api.ts`, `socket-events.ts` -- TypeScript interfaces for the full domain model, API shapes, and Socket.IO event contracts.

---

## Database

PostgreSQL 16 with connection pooling (pg, min 2 / max 20). 28 migrations in `migrations/` (004 baseline through 032), all idempotent with parameterized queries.

Key tables: `users`, `user_sessions`, `festivals`, `festival_stages`, `festival_days`, `festival_sets`, `festival_profiles`, `crews`, `crew_members`, `crew_activity`, `crew_polls`, `crew_expenses`, `device_tokens`, `audit_log`, `user_roles`.

---

## Key Design Patterns

### Dependency Injection via Factory Functions

The central architectural pattern. Every route module exports a factory that receives the full `deps` object (pool, redis, config, io, log, stores, schemas, helpers, etc.) and returns an Express Router. This makes routes testable with swapped dependencies and keeps the dependency graph explicit.

### Multi-Tier Rate Limiting

- **In-memory** (single process): per-IP API limit, per-IP auth limit, per-userId auth limit, per-user chat limit
- **Redis-backed** (cluster mode): same limits shared across PM2 workers
- **Graceful fallback**: if Redis is unavailable, falls back to in-memory with logged warning
- Maps pruned every 60s; capped at 10,000 entries with LRU eviction

### Session Security

- Scrypt password hashing (64-byte derived key, random 16-byte salt)
- SHA-256 hashed session tokens (32 bytes random, never stored in plaintext)
- HTTP-only, Secure, SameSite=Strict cookies
- Max 5 concurrent sessions per user; new login evicts oldest
- Evicted sessions immediately disconnected via Socket.IO

### Real-Time (Socket.IO)

- Festival rooms for scoped broadcasts
- Presence tracking with debounced updates (500ms)
- Message sequencing for gap-fill on reconnect
- Redis adapter for multi-worker pub/sub
- Push notifications (FCM) for offline users with DND support

### API Response Format

```js
// Success
{ ok: true, ...data }

// Error
{ ok: false, code: 'ERROR_CODE', message: '...' }
```

API docs available at `/api/docs` (Swagger UI), generated by `lib/openapi.js`.

---

## Deployment

| Mode | Rate Limits | Sessions | Storage |
|------|-------------|----------|---------|
| Development | In-memory | In-memory | Local filesystem |
| Production | Redis-backed | Redis-backed | Local filesystem + CDN |

- **PM2 cluster mode** (`ecosystem.config.js`) with 4 workers
- **Redis 7** for rate limits, sessions, Socket.IO adapter, cache invalidation bus
- **Cloudflare Tunnel** for HTTPS termination and DDoS protection
- **Docker**: multi-stage build, Node 22 slim, non-root user, health check at `/api/health`

### Required Environment Variables

`PUBLIC_ORIGIN`, `DATABASE_URL`, `SESSION_SECRET`, `FIREBASE_CREDENTIALS_PATH`, `RESEND_API_KEY`; `REDIS_URL` for cluster mode. All read through `lib/config.js`.

---

## Testing

Tests use Node's built-in test runner (`node:test` + `node:assert`). ~28 test files covering:

- Unit tests (`tests/unit.test.js`)
- Integration tests (`tests/integration-*.test.js`) -- auth, festivals, picks, crews, notifications, admin, export, sockets
- Critical path tests (`tests/critical-paths.test.js`) -- end-to-end user journeys
- Hardening tests (`tests/hardening.test.js`) -- security, rate limits, session edge cases
- Feature tests -- email-auth, crew-features, lineup-import, share, profiles, ratings, notifications
- E2E tests (`tests/e2e/*.spec.js`) -- Playwright browser automation

```bash
npm test              # All backend tests (sequential)
npm run test:unit     # Unit tests only
npm run test:e2e      # Playwright E2E
npm run test:coverage # c8 coverage report
```
