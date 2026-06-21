# Festie Architecture

## Overview

Festie is a real-time festival crew coordination app built as a monorepo. The backend is a Node.js 22 server using Express 5 and TypeScript, with Socket.IO 4, PostgreSQL 16, and Redis 7. The frontend is a React 19 SPA with TanStack Router, Zustand, and Tailwind CSS 4, built with Vite 8. A shared TypeScript package provides stores, hooks, types, and utilities consumed by the frontend.

**Stack:** Node.js 22 + Express 5 + TypeScript + Socket.IO 4 + PostgreSQL 16 + Redis 7 | React 19 + Vite 8 + TanStack Router + Zustand + Tailwind CSS 4

---

## Backend Architecture

### Entry Point: `server.ts`

The server is a thin orchestrator. It delegates all infrastructure setup to extracted modules:

```
server.ts ─── orchestrator
  lib/app-context/ ─── DI composition (config, DB, Redis, caches, auth, rate limiters)
  lib/middleware.ts ── Express middleware stack (security, CORS, parsing, metrics)
  lib/socket-setup.ts  Socket.IO server + Redis adapter
  lib/shutdown.ts ──── graceful shutdown + background cleanup tasks
  routes/*.ts ──────── 38 API route modules (factory pattern)
```

`server.ts` calls `createAppContext()` to build the dependency injection container, applies middleware, mounts routes, starts Socket.IO, and registers shutdown handlers. It validates startup configuration (PUBLIC_ORIGIN, SESSION_SECRET, webhook keys) before any initialization runs.

### Dependency Injection: `lib/app-context/` (418 lines)

`lib/app-context/index.ts` is the central composition root. It creates and wires together every infrastructure dependency into a single `deps` object that route factories receive. Extracted sub-modules:

| File | Lines | Responsibility |
|------|-------|----------------|
| `index.ts` | 418 | Compose config, DB pool, Redis, caches, auth, sessions, utilities |
| `csp.ts` | 36 | Content Security Policy header generation |
| `avatar.ts` | 130 | Avatar upload validation, resizing (Sharp worker pool), storage |
| `request-helpers.ts` | 118 | IP extraction, origin checks, CSRF enforcement |
| `cookies.ts` | 103 | Session cookie management (set, clear, parse) |

### Core Library Modules: `lib/`

| Module | Lines | Purpose |
|--------|-------|---------|
| `config.ts` | 253 | Centralized env vars with typed readers (`readInt`, `readBool`, `readList`) and defaults |
| `schemas.ts` | 538 | Zod validation schemas for all API inputs + normalization helpers |
| `rate-limiting.ts` | 458 | Multi-tier rate limiting: in-memory (single process) or Redis-backed (cluster) |
| `planner-db-pg.ts` | 441 | PostgreSQL connection pool, migration runner, store factory |
| `redis.ts` | 405 | Redis client, rate limiter, presence store, cache invalidation bus, circuit breaker |
| `middleware.ts` | 338 | Express middleware composition (Helmet, CORS, compression, body parsing, metrics, rate limits) |
| `reset-pages.ts` | 306 | Password reset HTML page templates |
| `metrics.ts` | 267 | Prometheus metrics (prom-client) collection and endpoint |
| `shutdown.ts` | 254 | Graceful shutdown (drain requests, close DB/Redis, clear timers) + background task scheduling |
| `openapi.ts` | 203 | OpenAPI 3.0 spec generation from route metadata |
| `emitter.ts` | 208 | Typed event emitter for internal pub/sub |
| `reminder-scheduler.ts` | 199 | Background scheduler for set reminders (push notifications) |
| `invite-pages.ts` | 194 | Crew invite HTML page templates |
| `presence.ts` | 191 | Socket.IO presence tracking (online users per festival) |
| `helpers.ts` | 190 | Legacy utilities (being migrated to `lib/helpers/`) |
| `logger.ts` | 180 | Pino logger with JSON output, sensitive field redaction |
| `email.ts` | 143 | Transactional email via Resend (password reset, invites) |
| `audit-middleware.ts` | 116 | Express middleware for audit log entries |
| `avatar-pool.ts` | 116 | Worker thread pool for Sharp image processing |
| `sentry.ts` | 114 | Sentry error tracking integration |
| `spotify.ts` | 114 | Spotify API client for artist metadata |
| `socket-setup.ts` | 96 | Socket.IO server creation + Redis adapter attachment |
| `crypto-auth.ts` | 55 | Password hashing (scrypt) + session token hashing (SHA-256) |

Smaller modules (<100 lines): `analytics-template.ts`, `pagination.ts`, `error-codes.ts`, `tracing.ts`, `file-storage.ts`, `response.ts`, `swagger-ui-setup.ts`, `avatar-worker.ts`, `export-worker.ts`, `constants.ts`, `validation.ts`.

### Helpers: `lib/helpers/`

| File | Lines | Purpose |
|------|-------|---------|
| `export-utils.ts` | 353 | HTML + ICS export generation, crew filtering |
| `sanitize.ts` | 186 | Input sanitization, HTML escaping, log field redaction |
| `validation.ts` | 136 | Time, color, festival structure validation |

### Notifications: `lib/notifications/`

FCM push notification subsystem with retry and do-not-disturb support.

| File | Lines | Purpose |
|------|-------|---------|
| `send.ts` | 491 | Firebase Cloud Messaging dispatch (batch + individual) |
| `payload.ts` | 60 | Notification payload builders (crew updates, schedule changes, set reminders) |
| `retry.ts` | 70 | Exponential backoff retry for failed sends |
| `dnd.ts` | 23 | Do-not-disturb time window checks |
| `index.ts` | 38 | Module barrel export |

### Data Access: `lib/db/stores/`

14 store modules, each exporting CRUD functions that accept a `pool` (pg Pool) parameter. All queries use parameterized SQL (`$1, $2`).

| Store | Lines | Tables |
|-------|-------|--------|
| `profiles.ts` | 283 | `festival_profiles` -- picks, notes, reminders, live status |
| `crews.ts` | 278 | `crews`, `crew_members`, `crew_activity` |
| `festivals.ts` | 248 | `festivals`, `festival_stages`, `festival_days`, `festival_sets` |
| `users.ts` | 211 | `users` -- accounts, avatars, display names |
| `sessions.ts` | 209 | `user_sessions`, `admin_sessions`, `refresh_tokens` |
| `notifications.ts` | 186 | `device_tokens`, `notification_preferences` |
| `roles.ts` | 126 | `user_roles`, `permissions` |
| `audit.ts` | 119 | `audit_log` -- user actions, admin operations |
| `polls.ts` | 112 | `crew_polls`, `poll_votes` |
| `expenses.ts` | 93 | `crew_expenses`, `expense_splits` |
| `ratings.ts` | 88 | `set_ratings` -- post-festival artist ratings |
| `calendar-tokens.ts` | 36 | `calendar_tokens` -- ICS feed authentication |
| `email-tokens.ts` | — | `email_tokens` -- magic-link and verification tokens |
| `activity.ts` | 29 | `crew_activity` -- crew event feed |

### Routes: `routes/`

38 route modules, each a factory function receiving `deps` and returning an Express Router:

```ts
import { Router } from 'express';
import type { AppContext } from '../lib/app-context/types.js';

export default function createFeatureRoutes({ pool, redis, config, io, log }: AppContext): Router {
  const router = Router();
  // ...
  return router;
}
```

| Route | Lines | Responsibility |
|-------|-------|----------------|
| `crews.ts` | 641 | Crew CRUD, member management, invites, join/leave |
| `auth.ts` | 503 | Register, login, logout, refresh tokens, change password |
| `export.ts` | 485 | HTML/ICS exports, presence list, message export |
| `admin-status.ts` | 433 | Admin dashboard: server status, connections, DB stats |
| `share.ts` | 431 | Festival sharing, public schedule links |
| `socket.ts` | 387 | Real-time: presence, crew updates, festival room management |
| `email-auth.ts` | 368 | Email-based auth (magic links, verification, password reset) |
| `account.ts` | 334 | Profile settings, avatar upload/delete, display name |
| `admin-users.ts` | 283 | Admin user management, search, ban, password reset |
| `festivals.ts` | 278 | Festival CRUD, clone, stage/day/set management |
| `lineup-import.ts` | 273 | Festival lineup import (CSV, JSON, Clashfinder) |
| `notifications.ts` | 269 | Push tokens, notification preferences, mark read |
| `admin.ts` | 267 | Admin login, session management, role checks |
| `admin-metrics.ts` | 255 | Prometheus metrics endpoint, custom dashboards |
| `profiles.ts` | 237 | Join festival, update picks/notes/reminders, live status |
| `crew-features.ts` | 237 | Crew feature aggregation (legacy; sub-features extracted below) |
| `crew-invites.ts` | — | Crew invite link generation and redemption |
| `crew-members.ts` | — | Crew member management (add, remove, role) |
| `crew-meeting-points.ts` | — | Crew meeting point CRUD |
| `crew-packing.ts` | — | Crew shared packing list |
| `crew-polls.ts` | — | Crew polls and voting |
| `crew-rides.ts` | — | Crew ride coordination |
| `crew-sos.ts` | — | SOS signal and crew alert |
| `crew-status.ts` | — | Live crew member status |
| `admin-bulk.ts` | 187 | Bulk admin operations (mass email, data export) |
| `health-core.ts` | 148 | Health checks (DB, Redis, disk), readiness probe |
| `calendar-sync.ts` | 148 | ICS calendar feed generation and sync |
| `pages.ts` | 140 | Static pages, password reset forms, SPA catch-all |
| `spotify.ts` | 122 | Spotify artist search and metadata |
| `expenses.ts` | 115 | Crew expense tracking and splitting |
| `client-metrics.ts` | 96 | Client-side performance metrics ingestion |
| `weather.ts` | 92 | Festival venue weather forecasts |
| `ratings.ts` | 90 | Post-festival set ratings |
| `deep-links.ts` | 72 | Universal/deep link handlers (mobile app) |
| `admin-audit.ts` | 65 | Audit log viewer |
| `health.ts` | 64 | Legacy health endpoint (delegates to health-core) |
| `analytics-install.ts` | 57 | Install/first-launch analytics |
| `activity.ts` | 25 | Crew activity feed |

---

## Frontend: `packages/web/`

React 19 SPA with file-based routing via TanStack Router. Built with Vite 8 and Tailwind CSS 4. Routes are lazy-loaded with skeleton fallbacks. Vite config uses manual chunk splitting for HTTP/2 cache optimization (react-core, router, data, ui-motion, icons, export-tools, telemetry).

### Routes (`packages/web/src/routes/`)

| Route | Lines | View |
|-------|-------|------|
| `timeline.tsx` | 189 | Main schedule timeline (drag-scroll, time markers) |
| `account.tsx` | 466 | User settings, avatar, notifications, sessions |
| `grid.tsx` | 368 | Grid/spreadsheet schedule view |
| `crew.tsx` | 273 | Crew management, member list |
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
| `crewStore.ts` | 654 | Crew membership, activity |
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

PostgreSQL 16 with connection pooling (pg, min 2 / max 20). 49 migrations in `migrations/` (004 baseline through 052), all idempotent with parameterized queries.

Key tables: `users`, `user_sessions`, `festivals`, `festival_stages`, `festival_days`, `festival_sets`, `festival_profiles`, `crews`, `crew_members`, `crew_activity`, `crew_polls`, `crew_expenses`, `device_tokens`, `audit_log`, `user_roles`.

---

## Key Design Patterns

### Dependency Injection via Factory Functions

The central architectural pattern. Every route module exports a factory that receives the full `deps` object (pool, redis, config, io, log, stores, schemas, helpers, etc.) and returns an Express Router. This makes routes testable with swapped dependencies and keeps the dependency graph explicit.

### Multi-Tier Rate Limiting

- **In-memory** (single process): per-IP API limit, per-IP auth limit, per-userId auth limit
- **Redis-backed** (multi-instance / when scaled): same limits shared across instances
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
- Presence state recovery on reconnect
- Redis adapter for multi-worker pub/sub
- Push notifications (FCM) for offline users with DND support

### API Response Format

```ts
// Success
{ ok: true, ...data }

// Error
{ ok: false, code: 'ERROR_CODE', message: '...' }
```

API docs available at `/api/docs` (Swagger UI), generated by `lib/openapi.ts`.

---

## Deployment

| Mode | Rate Limits | Sessions | Storage |
|------|-------------|----------|---------|
| Development | In-memory | In-memory | Local filesystem |
| Production | Redis-backed | Redis-backed | Local filesystem + CDN |

- **PM2 fork mode** (`ecosystem.config.cjs`), single instance — `tsx` runs as the PM2 interpreter and cannot run under PM2 cluster mode (`.ts` won't load); multi-worker scaling requires compiling the backend to JS. Rate limiting and Socket.IO use the Redis adapter, so the design is horizontally scalable once compiled.
- **Redis 7** for rate limits, sessions, Socket.IO adapter, cache invalidation bus
- **Cloudflare Tunnel** for HTTPS termination and DDoS protection
- **Docker**: multi-stage build, Node 22 slim, non-root user, health check at `/api/health`

### Required Environment Variables

`PUBLIC_ORIGIN`, `DATABASE_URL`, `SESSION_SECRET`, `FIREBASE_CREDENTIALS_PATH`, `RESEND_API_KEY`; `REDIS_URL` for multi-instance mode. All read through `lib/config.ts`.

---

## Testing

Tests use Node's built-in test runner (`node:test` + `node:assert`). ~28 test files covering:

- Unit tests (`tests/unit.test.ts`)
- Integration tests (`tests/integration-*.test.ts`) -- auth, festivals, picks, crews, notifications, admin, export, sockets
- Critical path tests (`tests/critical-paths.test.ts`) -- end-to-end user journeys
- Hardening tests (`tests/hardening.test.ts`) -- security, rate limits, session edge cases
- Feature tests -- email-auth, crew-features, lineup-import, share, profiles, ratings, notifications
- E2E tests (`tests/e2e/*.spec.ts`) -- Playwright browser automation

```bash
npm test              # All backend tests (sequential)
npm run test:unit     # Unit tests only
npm run test:e2e      # Playwright E2E
npm run test:coverage # c8 coverage report
```
