# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Festie is a real-time festival crew coordination app. Users create/join festivals, pick sets from the schedule, coordinate with crews via real-time chat, and export personalized schedules. The app is offline-first with WebSocket-driven live updates.

## Tech Stack

- **Backend**: Node.js 22 + Express 5 + Socket.IO 4 + PostgreSQL 16 + Redis 7
- **Frontend**: React 19 + Vite 6 + TypeScript + TanStack Router + Zustand + Tailwind CSS 4
- **Monorepo**: Backend at root (npm), frontend + shared packages under `packages/` (pnpm workspaces + Turborepo)

See `ARCHITECTURE.md` for detailed design patterns, refactoring history, and module-level documentation (note: some references to Express 4 and SQLite are outdated — the project now uses Express 5 and PostgreSQL).

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
node --test tests/integration-auth.test.js   # Single test file

# Linting & Types
npm run lint                   # ESLint on lib/, routes/, server.js
npm run lint:fix               # Auto-fix
pnpm --filter @festie/web typecheck   # Frontend TypeScript check
pnpm --filter @festie/web lint        # Frontend ESLint

# Frontend (from packages/web/)
pnpm dev                       # Vite dev server standalone
pnpm build                     # TypeScript + Vite production build
```

## Architecture

### Backend (root)

**Entry point**: `server.js` — Express app, Socket.IO setup, middleware stack, route mounting, graceful shutdown.

**Key pattern — Dependency Injection via Factory Functions**: Every route module exports a factory function that receives a `deps` object (db pool, redis, config, logger, etc.) and returns an Express Router. This is the central architectural pattern:

```js
// routes/feature.js
module.exports = function createFeatureRoutes({ pool, redis, config, io }) {
  const router = express.Router();
  // ...
  return router;
};
```

**`lib/`** — Core modules: `config.js` (centralized env vars with typed readers and defaults), `schemas.js` (Zod validation for all API inputs), database pool, Redis client, auth middleware, rate limiting, logging (Pino).

**`routes/`** — Route factories. `socket.js` handles all real-time events (presence, chat, reactions, crew updates).

**`migrations/`** — PostgreSQL migrations (004 baseline onward; run `ls migrations/` for current set). Must be idempotent. All use parameterized queries (`$1, $2`).

### Frontend (`packages/web/`)

React 19 SPA with file-based routing (TanStack Router). Vite config has manual chunk splitting for HTTP/2 cache longevity (react-core, router, data, ui-motion, icons, export-tools, telemetry). Routes are lazy-loaded with skeleton fallbacks.

**State management**: Zustand stores in `packages/shared/src/stores/` for auth, festival, crew, UI. Socket.IO listeners push real-time updates into stores. localStorage for offline snapshots + sync queue. PWA via Workbox service worker.

### Shared (`packages/shared/`)

TypeScript package exporting types, Zustand stores, Socket.IO service client, React hooks, utilities, and constants. Imported by frontend via workspace aliases (`@festie/shared/stores`, `@festie/shared/types`, etc.).

## Database

PostgreSQL 16 with connection pooling (pg, min 2 / max 20). Key tables: `users`, `user_sessions`, `festivals`, `festival_profiles` (picks/notes/reminders), `crews`, `crew_activity`, `audit_log`. All queries use parameterized SQL — no string interpolation.

## Code Conventions

- **Style**: 2-space indent, single quotes, trailing commas, semicolons, `const`/`let` only (enforced by ESLint flat config + Prettier)
- **Backend is CommonJS** (`require`/`module.exports`), frontend is ESM/TypeScript
- **API error responses**: `{ ok: false, code: 'ERROR_CODE', message: '...' }`
- **API success responses**: `{ ok: true, ...data }`
- **Validation**: Zod schemas in `lib/schemas.js` for all API endpoints
- **Logging**: Pino with JSON output; sensitive fields are sanitized
- **Config**: All env vars read through `lib/config.js` with `DEFAULTS` object and typed readers (`readInt`, `readBool`, `readList`)

## Security Model

- SHA-256 session tokens, scrypt password hashing (64-byte key, random 16-byte salt)
- Max 5 concurrent sessions per user
- CSRF via origin enforcement, CSP with inline hashes
- Multi-tier rate limiting: in-memory (single process) or Redis-backed (cluster mode) with graceful fallback
- Helmet for HTTP security headers

## Testing

Tests use **Node's built-in test runner** (`node:test` + `node:assert`). Test files:

- `tests/unit.test.js` — isolated function tests
- `tests/integration-*.test.js` — full app with test database (≈20 files covering auth, festivals, crews, chat, etc.)
- `tests/critical-paths.test.js` — end-to-end user journeys
- `tests/hardening.test.js` — security, rate limits, session edge cases
- `tests/e2e/*.spec.js` — Playwright browser automation

## Adding a New API Endpoint

1. Add Zod schema to `lib/schemas.js`
2. Create route factory in `routes/` (or add to existing one)
3. Mount router in `server.js`
4. Write integration test in `tests/`

For real-time features: add Socket.IO event handler in `routes/socket.js`, client-side listener in `packages/shared/src/services/socket.ts`.

## Critical Rules

### Code Quality Checklist
Before marking work complete:
- Code is readable with clear naming
- Functions are small (<50 lines preferred)
- Files are focused (<800 lines)
- No deep nesting (>4 levels)
- Proper error handling at system boundaries
- No hardcoded values (use config.js constants)
- Parameterized queries only (no string interpolation in SQL)

### Security Checklist
Before ANY commit:
- No hardcoded secrets (API keys, passwords, tokens)
- All user inputs validated via Zod schemas in lib/schemas.js
- SQL injection prevention (parameterized queries with $1, $2)
- XSS prevention (CSP headers, sanitized output)
- Rate limiting on all public endpoints
- Error messages don't leak sensitive data (no stack traces in production)

### Performance Guidelines
- Use cursor pagination (`WHERE id > $last_id`) over OFFSET for large tables
- Create indexes with `CONCURRENTLY` on existing tables (non-blocking)
- Use `Promise.all()` for independent async operations
- Debounce search/filter inputs (300ms)
- Use `content-visibility: auto` for long scrollable lists
- Only animate `transform` and `opacity` (compositor-only properties)

## Development Methodology

### Design Before Code
For features touching 3+ files or adding new API endpoints, present a short design before coding:
1. Explore the relevant code and ask clarifying questions about requirements
2. Propose 2-3 approaches with trade-offs (performance, complexity, migration risk)
3. Present the chosen design in digestible sections for approval
4. Get explicit sign-off before writing implementation code

For bug fixes, small refactors, and single-file changes — proceed directly. Don't force a design phase where none is needed.

### Implementation Plans for Large Features
When starting work that spans multiple files or multiple sessions:
1. Break the work into atomic tasks (each completable in 2-5 minutes)
2. Each task must include exact file paths and specific changes — no placeholders like "add appropriate error handling" or "implement as needed"
3. Include a verification step for each task (which test to run, what output to expect)
4. Execute tasks sequentially, verifying each before moving to the next

### Systematic Debugging Protocol
When a fix attempt fails, don't keep patching. Follow this escalation:
1. **Root cause first** — Read the error, trace the call chain, identify the actual failure point. No fixes until the cause is understood.
2. **Pattern analysis** — Check if the same issue exists elsewhere. A bug in one route handler likely exists in similar handlers.
3. **Hypothesize and test** — Form a specific theory, write a test that proves/disproves it, then fix.
4. **After 3 failed attempts** — Stop and question the architecture. The problem may be structural, not local. Step back and reassess rather than continuing to patch.

### Verification Honesty
Never claim work is complete without running the actual verification commands and reading the output. Specifically:
- Do not use words like "should work", "probably passes", or "seems correct" ��� run it and confirm
- Do not assume a change is safe because it's small — verify it
- If a verification step fails, report it transparently rather than skipping to the next step
- If you cannot run a verification (e.g., no test database), say so explicitly rather than claiming success

## Verification Workflow
Before submitting changes, run this sequence:
1. `pnpm --filter @festie/web typecheck` — TypeScript check
2. `npm run lint` — Backend linting
3. `pnpm --filter @festie/web lint` — Frontend linting
4. `npm test` — All backend tests
5. `npm run test:e2e` — Playwright E2E tests
6. Review diff for leaked secrets (grep for sk-, ghp_, AKIA, password=, secret=)

## Deployment

- **Dev/test**: Single process, in-memory rate limits, local file storage
- **Production**: PM2 cluster mode (`ecosystem.config.js`), Redis-backed rate limits/sessions, Cloudflare Tunnel
- **Docker**: Multi-stage build, Node 22 slim, non-root user, health check at `/api/health`
- **Required env vars**: `PUBLIC_ORIGIN`, `DATABASE_URL`, `SESSION_SECRET`, `FIREBASE_CREDENTIALS_PATH`, `RESEND_API_KEY`; `REDIS_URL` for cluster mode
