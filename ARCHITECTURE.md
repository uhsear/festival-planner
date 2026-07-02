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

### Dependency Injection: `lib/app-context/`

`lib/app-context/index.ts` is the central composition root. It creates and wires together every infrastructure dependency into a single `deps` object that route factories receive. Extracted sub-modules:

| File | Responsibility |
|------|----------------|
| `index.ts` | Compose config, DB pool, Redis, caches, auth, sessions, utilities |
| `csp.ts` | Content Security Policy header generation |
| `avatar.ts` | Avatar upload validation, resizing (Sharp worker pool), storage |
| `request-helpers.ts` | IP extraction, origin checks, CSRF enforcement |
| `cookies.ts` | Session cookie management (set, clear, parse) |

### Core Library Modules: `lib/`

| Module | Purpose |
|--------|---------|
| `config.ts` | Centralized env vars with typed readers (`readInt`, `readBool`, `readList`) and defaults |
| `schemas.ts` | Zod validation schemas for all API inputs + normalization helpers |
| `rate-limiting.ts` | Multi-tier rate limiting: in-memory (single process) or Redis-backed (cluster) |
| `planner-db-pg.ts` | PostgreSQL connection pool, migration runner, store factory |
| `redis.ts` | Redis client, rate limiter, presence store, cache invalidation bus, circuit breaker |
| `middleware.ts` | Express middleware composition (Helmet, CORS, compression, body parsing, metrics, rate limits) |
| `reset-pages.ts` | Password reset HTML page templates |
| `metrics.ts` | Prometheus metrics (prom-client) collection and endpoint |
| `shutdown.ts` | Graceful shutdown (drain requests, close DB/Redis, clear timers) + background task scheduling |
| `openapi.ts` | OpenAPI 3.0 spec generation from route metadata |
| `emitter.ts` | Typed event emitter for internal pub/sub |
| `reminder-scheduler.ts` | Background scheduler for set reminders (push notifications) |
| `invite-pages.ts` | Crew invite HTML page templates |
| `presence.ts` | Socket.IO presence tracking (online users per festival) |
| `helpers.ts` | Legacy utilities (being migrated to `lib/helpers/`) |
| `logger.ts` | Pino logger with JSON output, sensitive field redaction |
| `email.ts` | Transactional email via Resend (password reset, invites) |
| `audit-middleware.ts` | Express middleware for audit log entries |
| `avatar-pool.ts` | Worker thread pool for Sharp image processing |
| `sentry.ts` | Sentry error tracking integration |
| `spotify.ts` | Spotify API client for artist metadata |
| `socket-setup.ts` | Socket.IO server creation + Redis adapter attachment |
| `crypto-auth.ts` | Password hashing (scrypt) + session token hashing (SHA-256) |

Smaller modules (<100 lines): `analytics-template.ts`, `pagination.ts`, `error-codes.ts`, `tracing.ts`, `file-storage.ts`, `response.ts`, `swagger-ui-setup.ts`, `avatar-worker.ts`, `export-worker.ts`, `constants.ts`, `validation.ts`.

### Helpers: `lib/helpers/`

| File | Purpose |
|------|---------|
| `export-utils.ts` | HTML + ICS export generation, crew filtering |
| `sanitize.ts` | Input sanitization, HTML escaping, log field redaction |
| `validation.ts` | Time, color, festival structure validation |

### Notifications: `lib/notifications/`

FCM push notification subsystem with retry and do-not-disturb support.

| File | Purpose |
|------|---------|
| `send.ts` | Firebase Cloud Messaging dispatch (batch + individual) |
| `payload.ts` | Notification payload builders (crew updates, schedule changes, set reminders) |
| `retry.ts` | Exponential backoff retry for failed sends |
| `dnd.ts` | Do-not-disturb time window checks |
| `index.ts` | Module barrel export |

### Data Access: `lib/db/stores/`

14 store modules, each exporting CRUD functions that accept a `pool` (pg Pool) parameter. All queries use parameterized SQL (`$1, $2`).

| Store | Tables |
|-------|--------|
| `profiles.ts` | `festival_profiles` -- picks, notes, reminders, live status |
| `crews.ts` | `crews`, `crew_members`, `crew_activity` |
| `festivals.ts` | `festivals`, `festival_stages`, `festival_days`, `festival_sets` |
| `users.ts` | `users` -- accounts, avatars, display names |
| `sessions.ts` | `user_sessions`, `admin_sessions`, `refresh_tokens` |
| `notifications.ts` | `device_tokens`, `notification_preferences` |
| `roles.ts` | `user_roles`, `permissions` |
| `audit.ts` | `audit_log` -- user actions, admin operations |
| `polls.ts` | `crew_polls`, `poll_votes` |
| `expenses.ts` | `crew_expenses`, `expense_splits` |
| `ratings.ts` | `set_ratings` -- post-festival artist ratings |
| `calendar-tokens.ts` | `calendar_tokens` -- ICS feed authentication |
| `email-tokens.ts` | `email_tokens` -- magic-link and verification tokens |
| `activity.ts` | `crew_activity` -- crew event feed |

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

| Route | Responsibility |
|-------|----------------|
| `crews.ts` | Crew CRUD, member management, invites, join/leave |
| `auth.ts` | Register, login, logout, refresh tokens, change password |
| `export.ts` | HTML/ICS exports, presence list, message export |
| `admin-status.ts` | Admin dashboard: server status, connections, DB stats |
| `share.ts` | Festival sharing, public schedule links |
| `socket.ts` | Real-time: presence, crew updates, festival room management |
| `email-auth.ts` | Email-based auth (magic links, verification, password reset) |
| `account.ts` | Profile settings, avatar upload/delete, display name |
| `admin-users.ts` | Admin user management, search, ban, password reset |
| `festivals.ts` | Festival CRUD, clone, stage/day/set management |
| `lineup-import.ts` | Festival lineup import (CSV, JSON, Clashfinder) |
| `notifications.ts` | Push tokens, notification preferences, mark read |
| `admin.ts` | Admin login, session management, role checks |
| `admin-metrics.ts` | Prometheus metrics endpoint, custom dashboards |
| `profiles.ts` | Join festival, update picks/notes/reminders, live status |
| `crew-features.ts` | Crew feature aggregation (legacy; sub-features extracted below) |
| `crew-invites.ts` | Crew invite link generation and redemption |
| `crew-members.ts` | Crew member management (add, remove, role) |
| `crew-meeting-points.ts` | Crew meeting point CRUD |
| `crew-packing.ts` | Crew shared packing list |
| `crew-polls.ts` | Crew polls and voting |
| `crew-rides.ts` | Crew ride coordination |
| `crew-sos.ts` | SOS signal and crew alert |
| `crew-status.ts` | Live crew member status |
| `admin-bulk.ts` | Bulk admin operations (mass email, data export) |
| `health-core.ts` | Health checks (DB, Redis, disk), readiness probe |
| `calendar-sync.ts` | ICS calendar feed generation and sync |
| `pages.ts` | Static pages, password reset forms, SPA catch-all |
| `spotify.ts` | Spotify artist search and metadata |
| `expenses.ts` | Crew expense tracking and splitting |
| `client-metrics.ts` | Client-side performance metrics ingestion |
| `weather.ts` | Festival venue weather forecasts |
| `ratings.ts` | Post-festival set ratings |
| `deep-links.ts` | Universal/deep link handlers (mobile app) |
| `admin-audit.ts` | Audit log viewer |
| `health.ts` | Legacy health endpoint (delegates to health-core) |
| `analytics-install.ts` | Install/first-launch analytics |
| `activity.ts` | Crew activity feed |

---

## Frontend: `packages/web/`

React 19 SPA with file-based routing via TanStack Router. Built with Vite 8 and Tailwind CSS 4. Routes are lazy-loaded with skeleton fallbacks. Vite config uses manual chunk splitting for HTTP/2 cache optimization (react-core, router, data, ui-motion, icons, export-tools, telemetry).

### Routes (`packages/web/src/routes/`)

| Route | View |
|-------|------|
| `timeline.tsx` | Main schedule timeline (drag-scroll, time markers) |
| `account.tsx` | User settings, avatar, notifications, sessions |
| `grid.tsx` | Grid/spreadsheet schedule view |
| `crew.tsx` | Crew management, member list |
| `wrap.tsx` | Post-festival wrap-up / recap |
| `picks.tsx` | Personal picks list with conflict detection |
| `festival-mode.tsx` | Festival day-of mode (current/next set) |
| `register.tsx` | User registration |
| `compare.tsx` | Side-by-side crew schedule comparison |
| `forgot-password.tsx` | Password reset flow |
| `cards.tsx` | Card-style schedule view |
| `login.tsx` | Login form |
| `admin.tsx` | Admin panel |

### PWA

Workbox service worker for offline support. localStorage snapshots of festivals, profiles, and messages are updated on every state change. A sync queue replays profile mutations (picks, notes, reminders) when connectivity is restored.

---

## Shared Package: `packages/shared/`

TypeScript package imported by the frontend via workspace aliases (`@festie/shared/stores`, `@festie/shared/types`, etc.).

### Stores (Zustand)

| Store | State |
|-------|-------|
| `festivalStore.ts` | Festival data, sets, stages, days |
| `authStore.ts` | User session, tokens, login state |
| `crewStore.ts` | Crew membership, activity |
| `festivalModeStore.ts` | Day-of festival mode (current set tracking) |
| `uiStore.ts` | UI state (modals, toasts, theme) |

### Services

- `api.ts` -- HTTP client wrapping fetch with auth headers, error handling
- `socket.ts` -- Socket.IO client with auto-reconnect, event listeners that push into Zustand stores

### Hooks

`useAuth`, `useFestival`, `useCrew`, `usePicks`, `useSocket`, `useOffline` -- React hooks bridging Zustand stores to components.

### Types

`domain.ts`, `api.ts`, `socket-events.ts` -- TypeScript interfaces for the full domain model, API shapes, and Socket.IO event contracts.

---

## Database

PostgreSQL 16 with connection pooling (pg, min 2 / max 20). 59 migrations in `migrations/` (004 baseline through 059), all idempotent with parameterized queries.

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

Tests use Node's built-in test runner (`node:test` + `node:assert`). 98 test files covering:

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
