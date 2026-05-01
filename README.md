# Festie

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-blue.svg)](https://github.com/uhsear/festival-planner/blob/main/LICENSE)
[![Uptime Status](https://img.shields.io/badge/status-uptime-brightgreen.svg)](https://github.com/uhsear/upptime)

Real-time festival schedule coordination for event crews. Plan sets, sync picks with friends, and resolve conflicts — built for the chaos of multi-stage festivals.

**Live at [festie.us](https://festie.us)**

## What It Does

Festie lets groups coordinate festival schedules in real time. Crew members mark artists as must-see, interested, or skip, and the app surfaces conflicts, highlights consensus, and keeps everyone in sync — even offline.

Core capabilities include real-time crew synchronization via WebSockets, priority-based set selection with conflict detection, ICS calendar export, offline-first with automatic reconnection sync, Firebase push notifications, full account lifecycle (email verification, recovery, GDPR self-deletion), and an admin dashboard for event and user management.

## Architecture

The app is a server-rendered Node.js application with a real-time layer, backed by PostgreSQL and Redis.

**Stack**: Node.js 22, Express 5, Socket.IO 4, PostgreSQL 16, Redis 7, PM2 cluster mode, Cloudflare Tunnel. React 19 + Vite 6 + TypeScript frontend.

**Backend structure**: Core concerns are extracted into focused `lib/` modules — logger, crypto-auth, presence tracking, and templated pages. Route files export factory functions (`createXRoutes(deps)`) for testability. All SQL uses parameterized queries; all user input is sanitized through dedicated helpers.

**Frontend**: React 19 with Vite 6, TanStack Router, and Zustand for state management (`packages/web/`). TypeScript throughout, Tailwind CSS for styling, and a Workbox service worker for offline support. Real-time updates flow through Socket.IO with Redis-backed adapter for multi-process consistency.

**Security model**: SHA-256 session tokens with refresh rotation, scrypt password hashing with account lockout, Content Security Policy, CSRF via origin enforcement, and multi-tier rate limiting per endpoint.

## Testing

The test suite covers unit, integration, critical path, hardening, and coverage gap scenarios across 6 test files using Node's built-in test runner. Coverage tracking via c8.

```
npm test                  # all suites, sequential
npm run test:unit         # unit tests only
npm run test:integration  # integration tests only
npm run test:coverage     # with c8 coverage report
npm run test:e2e          # playwright end-to-end
```

## API

Interactive API docs are served at `/api/docs` with an OpenAPI spec at `/api/spec`.

## Project Structure

```
server.js              # Express app, Socket.IO, middleware, route mounting
lib/                   # Core modules (config, logger, crypto-auth, presence, etc.)
routes/                # Route factories organized by domain
packages/web/          # React 19 frontend (Vite, TanStack Router, Zustand, TypeScript)
packages/shared/       # Shared types and utilities
public/                # Static assets, service worker, manifest
tests/                 # Test suites (unit, integration, critical-paths, hardening, coverage-gaps)
scripts/               # Operational scripts (backup, monitoring)
migrations/            # PostgreSQL schema migrations
docs/                  # Documentation
```

## License

Festie is source-available under the [Business Source License 1.1](LICENSE). You can read the code, learn from the patterns, and run it for non-production evaluation. Commercial hosted use requires a license — see the LICENSE file or contact uhsear@gmail.com.

After four years from each release, the code converts to Apache 2.0.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Author

Built by [Asir Khan](https://github.com/uhsear).
