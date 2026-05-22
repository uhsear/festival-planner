# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Festie is a real-time festival crew coordination app. Users create/join festivals, pick sets from the schedule, coordinate with crews via real-time chat, and export personalized schedules. The app is offline-first with WebSocket-driven live updates.

## Tech Stack

- **Backend**: Node.js 22 + Express 5 + **TypeScript** + Socket.IO 4 + PostgreSQL 16 + Redis 7
- **Frontend**: React 19 + Vite 8 + TypeScript + TanStack Router + Zustand + Tailwind CSS 4
- **Monorepo**: Backend at root (npm), frontend + shared packages under `packages/` (pnpm workspaces + Turborepo)
- **Migration Status**: Backend TypeScript migration in progress (ESM + TypeScript). See `docs/TYPESCRIPT_MIGRATION.md` for plan.

See `ARCHITECTURE.md` for detailed design patterns, module inventory, and codebase statistics.

See `CONTEXT.md` for the ubiquitous language glossary (domain terms, relationships, flagged ambiguities).

## Skills & Slash Commands

Default workflow: `/spec` -> `/plan` -> `/build` -> `/test` -> `/review` -> `/ship`. Skip steps that don't apply.

| Task | Skill / Command |
|------|----------------|
| New feature spec | `/spec` (spec-driven-development) |
| Task breakdown | `/plan` (planning-and-task-breakdown) |
| Implementation | `/build` (incremental-implementation) |
| Test-first dev | `/test` (tdd or test-driven-development) |
| Code review | `/review` (code-review-and-quality) |
| Simplify code | `/code-simplify` (code-simplification) |
| Ship to prod | `/ship` (shipping-and-launch) |
| Security audit | security-and-hardening |
| Debug/diagnose | `/diagnose` (debugging-and-error-recovery) |
| Performance | performance-optimization |
| API design | api-and-interface-design |
| UI work | frontend-ui-engineering |
| Stress-test plan | `/grill-with-docs` |
| Architecture | improve-codebase-architecture or `/zoom-out` |
| Create issues | `/to-issues` or `/triage` |
| Documentation/ADR | documentation-and-adrs |

The karpathy-guidelines skill is always active: Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution.

## Commands

```bash
# Development (root uses npm, packages/ use pnpm)
npm run dev                    # Backend + Vite frontend (proxied)
npm start                      # Backend only

# Testing (Node built-in test runner, not Jest)
npm test                       # All backend tests (sequential, ~27 test files)
npm run test:unit              # Unit tests only
npm run test:e2e               # Playwright E2E
npm run test:coverage          # c8 coverage (text + lcov + json-summary)
node --loader tsx --test tests/integration-auth.test.ts   # Single test file

# Linting & Types
npm run lint                   # ESLint on lib/, routes/, server.ts
npm run lint:fix               # Auto-fix
npm run typecheck                # Backend TypeScript check
pnpm --filter @festie/web typecheck   # Frontend TypeScript check
pnpm --filter @festie/web lint        # Frontend ESLint

# Frontend (from packages/web/)
pnpm dev                       # Vite dev server standalone
pnpm build                     # TypeScript + Vite production build
```

## Architecture

### Backend (root)

**Entry point**: `server.ts` -- Express app, Socket.IO setup, middleware stack, route mounting, graceful shutdown.

**Key pattern -- Dependency Injection via Factory Functions**: Every route module exports a factory function that receives a `deps` object (db pool, redis, config, logger, etc.) and returns an Express Router. This is the central architectural pattern:

```ts
// routes/feature.ts
import { Router } from 'express';
import type { AppContext } from '../lib/app-context/types.js';

export default function createFeatureRoutes({ pool, redis, config, io }: AppContext): Router {
  const router = Router();
  // ...
  return router;
}
```

**`lib/`** -- Core modules: `config.ts` (centralized env vars with typed readers and defaults), `schemas.ts` (Zod validation for all API inputs — types inferred via `z.infer`), database pool, Redis client, auth middleware, rate limiting, logging (Pino). Sub-directories: `lib/app-context/` (CSP, cookies, avatars, request helpers), `lib/db/stores/` (typed data access layer per table), `lib/helpers/` (export-utils, sanitize, validation), `lib/notifications/` (push notification subsystem).

**`routes/`** -- Route factories. `socket.ts` handles all real-time events (presence, chat, reactions, crew updates).

**API docs** are available at `/api/docs` (Swagger UI), served by `lib/openapi.ts`.

**`migrations/`** -- PostgreSQL migrations (004 baseline onward; run `ls migrations/` for current set). Must be idempotent. All use parameterized queries (`$1, $2`).

### Frontend (`packages/web/`)

React 19 SPA with file-based routing (TanStack Router). Vite config has manual chunk splitting for HTTP/2 cache longevity (react-core, router, data, ui-motion, icons, export-tools, telemetry). Routes are lazy-loaded with skeleton fallbacks.

**State management**: Zustand stores in `packages/shared/src/stores/` for auth, festival, crew, UI. Socket.IO listeners push real-time updates into stores. localStorage for offline snapshots + sync queue. PWA via Workbox service worker.

### Shared (`packages/shared/`)

TypeScript package exporting types, Zustand stores, Socket.IO service client, React hooks, utilities, and constants. Imported by frontend via workspace aliases (`@festie/shared/stores`, `@festie/shared/types`, etc.).

## Database

PostgreSQL 16 with connection pooling (pg, min 2 / max 20). Key tables: `users`, `user_sessions`, `festivals`, `festival_profiles` (picks/notes/reminders), `crews`, `crew_activity`, `audit_log`. All queries use parameterized SQL -- no string interpolation.

## Code Conventions

- **Style**: 2-space indent, single quotes, trailing commas, semicolons, `const`/`let` only (enforced by ESLint flat config + Prettier)
- **All code is ESM TypeScript** — backend, frontend, and shared. Legacy CommonJS files are being migrated per `docs/TYPESCRIPT_MIGRATION.md`
- **API error responses**: `{ data: null, error: { message, status, code, retryable } }`
- **API success responses**: `{ data: {...}, error: null }`
- **Validation**: Zod schemas in `lib/schemas.ts` for all API endpoints
- **Logging**: Pino with JSON output; sensitive fields are sanitized
- **Config**: All env vars read through `lib/config.ts` with `DEFAULTS` object and typed readers (`readInt`, `readBool`, `readList`)

## Security Model

- SHA-256 session tokens, scrypt password hashing (64-byte key, random 16-byte salt)
- Max 5 concurrent sessions per user
- CSRF via origin enforcement, CSP with inline hashes
- Multi-tier rate limiting: in-memory (single process) or Redis-backed (cluster mode) with graceful fallback
- Helmet for HTTP security headers

## Testing

Tests use **Node's built-in test runner** (`node:test` + `node:assert`). Test files:

- `tests/unit.test.ts` -- isolated function tests
- `tests/integration-*.test.ts` -- full app with test database (~20 files covering auth, festivals, crews, chat, etc.)
- `tests/critical-paths.test.ts` -- end-to-end user journeys
- `tests/hardening.test.ts` -- security, rate limits, session edge cases
- `tests/e2e/*.spec.ts` -- Playwright browser automation

## Adding a New API Endpoint

1. Add Zod schema to `lib/schemas.ts`
2. Create route factory in `routes/` (or add to existing `.ts` file)
3. Mount router in `server.ts`
4. Write integration test in `tests/`

For real-time features: add Socket.IO event handler in `routes/socket.ts`, client-side listener in `packages/shared/src/services/socket.ts`.

## Critical Rules

### Code Quality
Use `/review` before merging. Functions <50 lines, files <800 lines, nesting <4 levels. Parameterized queries only (`$1, $2`). No hardcoded values (use `config.ts`).

### Security
Use security-and-hardening skill before commits. Festie-specific: all inputs via Zod in `lib/schemas.ts`, parameterized SQL, rate limiting on public endpoints, CSP headers. Grep diff for secrets (`sk-`, `ghp_`, `AKIA`, `password=`, `secret=`).

### Performance
Use performance-optimization skill. Festie-specific: cursor pagination (`WHERE id > $last_id`) over OFFSET, `CREATE INDEX CONCURRENTLY`, `content-visibility: auto` for scrollable lists, animate only `transform`/`opacity`.

## Development Methodology

For features touching 3+ files or new API endpoints: use `/spec` then `/plan`, then `/grill-with-docs` to stress-test against domain model. For bug fixes and single-file changes, proceed directly.

Use `/plan` to break work into atomic tasks, then `/build` to execute with verification at each step.

## Verification Workflow
Run `/ship` or manually: `npm run typecheck && pnpm --filter @festie/web typecheck && npm run lint && pnpm --filter @festie/web lint && npm test`. Grep diff for secrets.

## CI

GitHub Actions on push to `main`. Jobs: lint, quality (typecheck + semgrep), security (npm audit), test (Node 20 + 22 with real Postgres/Redis services), Lighthouse CI, Docker build. Check with `gh run list --limit 5`.

## Deployment

- **Dev/test**: Single process, in-memory rate limits, local file storage
- **Production**: PM2 cluster mode (`ecosystem.config.js`), Redis-backed rate limits/sessions, Cloudflare Tunnel
- **Docker**: Multi-stage build, Node 22 slim, non-root user, health check at `/api/health`
- **Required env vars**: `PUBLIC_ORIGIN`, `DATABASE_URL`, `SESSION_SECRET`, `FIREBASE_CREDENTIALS_PATH`, `RESEND_API_KEY`; `REDIS_URL` for cluster mode
