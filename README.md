# Festie

Real-time festival crew coordination: plan sets from the lineup, coordinate with your crew, export personalized schedules.

A multi-day music festival has more stages than any one person can watch and more friends than any one group chat can keep straight. Festie is for the group of people going together. Everyone picks the sets they want, the app shows where those picks collide with each other and where they line up with the crew, and the day-of view narrows to what is happening now. It runs as a web app, an iOS app, and an Android app against one backend.

**Live at [festie.us](https://festie.us)**

## What it does

- **Lineup and picks.** A festival is stages, days, sets, and artists. You mark each set `must`, `want-to-see`, or `maybe`. Your record for a festival is a per-festival profile, separate from your account, so a different festival is a clean slate.
- **Conflict detection.** Two of your own picks overlapping in time is a conflict and is surfaced as one. How many crew members picked the same set is an overlap and is surfaced separately.
- **Seven schedule views.** Grid, Timeline, Cards, Picks, Compare, Festival Mode, and Wrap. Festival Mode is the live day-of view. Wrap is the post-festival summary.
- **Crew coordination.** Shared crew picks, home base and meeting points, split expenses, polls, and an activity feed. Crews are joined by invite code, which expires after seven days.
- **Maps.** Stage and meeting-point maps rendered with MapLibre GL over PMTiles.
- **Export.** Personalized schedules exported as images.
- **Push notifications.** FCM on Android and web. iOS goes through a direct APNs sender rather than FCM, because the Expo notifications module hands back a raw APNs device token that firebase-admin cannot send. APNs is optional at runtime, and iOS tokens are skipped rather than deleted when it is unconfigured.
- **Offline writes.** Mutations made offline are queued and replayed oldest-first on reconnect.

## How it is built

TypeScript everywhere. Four workspaces:

| Package | Role |
|---|---|
| root (`festie`) | Express 5 and Socket.IO backend, `server.ts` entry |
| `packages/web` (`@festie/web`) | React 19, Vite 8, TanStack Router single-page app, installable as a PWA |
| `packages/mobile` (`@festie/mobile`) | Expo SDK 56 and expo-router React Native app for iOS and Android |
| `packages/shared` (`@festie/shared`) | Zustand stores, hooks, API and socket services, offline queue, design tokens, types |

`@festie/shared` is a source-only package. Its `main` and `types` point at `src/index.ts` and it exposes the root plus eleven subpath exports with no build step, so web and mobile consume the same TypeScript directly. Nine Zustand stores live there and are shared by both clients.

Three choices worth explaining:

**Two package managers, on purpose.** The repository root is an npm project holding the backend. `packages/` is a separate pnpm workspace with its own lockfile. Adding a `packageManager` field to the root `package.json` redirects root npm to pnpm and breaks CI installs, so it is deliberately absent. See `docs/adrs/006-monorepo-npm-pnpm-split.md`.

**No build step for the backend.** `tsx` is a runtime dependency rather than a dev dependency. `server.ts` runs under `node --import tsx/esm` in development and in production, in the Docker image and under PM2. An esbuild bundler script exists but is not on either deploy path. See `docs/adrs/007-tsx-no-build-production-runtime.md`.

**Migrations apply themselves at boot.** The first database open per process discovers `migrations/*.sql` by numeric prefix, compares against a `schema_migrations` ledger, and applies each pending file inside one transaction together with its ledger insert. Concurrent index builds are the exception and run in autocommit. There are no down-migrations, so rollback is a git-level operation, and there is no separate migration step in the deploy. See `docs/adrs/008-app-managed-migrations-boot-ledger.md`.

The API contract is generated, not hand-written. Zod schemas in `lib/schemas.ts` are the source of truth for the OpenAPI document and for the shared client types, and CI fails if either generated file drifts from the schemas. Swagger UI is served at `/api/docs` outside production, where the spec is deliberately not exposed.

## Architecture

The backend is 38 Express route modules, each a factory that takes a dependency-injection object and returns a router, sitting over 14 data-access store modules and 58 SQL migrations spanning `004_postgresql_baseline.sql` through `062_rebuild_concurrent_indexes.sql`. Data lives in PostgreSQL. Redis backs rate limiting and the Socket.IO adapter. Dependency-cruiser enforces the boundaries as build errors: no circular imports, routes may not import routes, stores may not import routes.

Real-time is Socket.IO with the Redis adapter fanning out across workers. Clients connect with a token as a query parameter, a bearer header, or the session cookie, and festival rooms scope every broadcast. Authentication is validated on `join:festival` rather than on connect, so an unauthenticated socket is disconnected on its first join. The wire contract is written down in `docs/SOCKET_CONTRACT.md`.

Auth is dual-mode. Browsers use HttpOnly cookie sessions, and every mutating request is checked against an origin allowlist. A request that arrives with no `Origin` header at all is accepted only if it carries the `X-Festie-Request: 1` header, which a cross-site attacker cannot set on a simple request. Mobile uses bearer tokens, and a request holding a bearer token without a session cookie skips the origin check by design, because browsers never auto-attach an `Authorization` header cross-origin. A request carrying both is treated as a browser and stays under enforcement. Passwords are hashed with scrypt, and session tokens are opaque random strings stored as SHA-256 hashes. `SESSION_SECRET` is required and validated at startup in production but is not yet used cryptographically. It is provisioned ahead of HMAC-signed sessions so that change will not need a redeploy.

Offline behavior has an explicit contract rather than best-effort retries. Queued writes are keyed by a deterministic client id so repeated writes to one resource collapse into one. On drain, every queued write either succeeds and is removed, stays queued on a network failure or transient 5xx, or is removed and surfaced to the user on a permanent 4xx. Nothing is dropped silently. Entries expire after 24 hours or 5 retries.

`ARCHITECTURE.md` has the module map and data flow. Twelve ADRs under `docs/adrs/` record the decisions and what each one cost.

## Quality gates

Ten GitHub Actions workflows. Every third-party action is pinned by commit SHA.

The test suite is 106 backend files run under `node:test`, 6 Playwright end-to-end specs with 10 committed screenshot baselines, and 145 Vitest files across the three packages, split 82 web, 55 shared, 8 mobile. That is 257 test files by tracked-file count.

Blocking on every push and pull request:

- **gitleaks** over full history.
- **eslint** on backend, web, and shared, plus **dependency-cruiser** on the import graph.
- The backend suite against real PostgreSQL 16 and Redis 7 service containers, with every migration applied first, gated by **c8** coverage thresholds of 80 percent lines, 80 percent statements, 60 percent branches, 60 percent functions.
- **syncpack** version parity across the four workspaces for the three libraries that must not drift between backend, web, and mobile: `zod`, `socket.io-client`, and `zustand`.
- The OpenAPI drift gate: types are regenerated from the Zod schemas and any diff fails the build.
- **Semgrep** with the React and OWASP Top Ten rulesets, in error mode.
- Typechecking of backend, web, and shared. Mobile typecheck and mobile tests run when mobile files change.

Advisory rather than blocking: knip dead-code detection, `npm audit` inside the main workflow, bundlemon bundle size, and oasdiff breaking-change warnings. The blocking dependency audit is a separate daily workflow. A nightly workflow runs the Playwright suite against real infrastructure. An every-ten-minutes workflow pings the production host and opens or closes a GitHub issue on the result. A license workflow hard-fails on AGPL or SSPL dependencies in either lockfile.

Twenty-six backend test files require `TEST_DATABASE_URL` and refuse to fall back to `DATABASE_URL`. The end-to-end fixtures go further and reject any database not named exactly `festie_test`. There is a test whose only job is to verify that guard still holds.

## Status and scope

Built and deployed: the backend, the web app, and the shared package. The mobile app is built against Expo SDK 56 with its own test suite and typecheck job. Its release, over-the-air update, and device-test workflows are manual triggers rather than automatic.

Deliberately not done:

- **No horizontal scaling today.** PM2 runs one instance in fork mode. Cluster mode cannot load TypeScript, and `node --import tsx/esm` under PM2 gets killed by a spurious SIGINT a few seconds after start. Rate limiting and Socket.IO already run through Redis, so the design is ready for multiple workers, but getting there requires compiling to JavaScript first.
- **No down-migrations.** Rollback means reverting the code and repairing forward.
- **No external contributions.** Issues and pull requests from outside are not accepted, and the license does not permit forks.
- **`CHANGELOG.md` stops at 1.10.2.** The package is at 3.0.0. Everything after that point is tracked in git history, not in the changelog.
- **`ARCHITECTURE.md` lags in places.** Its file counts and store lists predate recent work, and it does not cover the mobile app at all. Where it disagrees with the repository, the repository is correct.

Local development works from this source. `GETTING_STARTED.md` documents the full path, and the backend suite runs against a throwaway Docker PostgreSQL. What is not in this repository is production parity: push notifications, transactional email, third-party music integration, and error reporting each need credentials that are not published here. The code degrades gracefully without every one of them. `.env.example` shows the shape of the configuration without the values.

## License and use

**Proprietary. Copyright 2026 Asir Khan. All rights reserved.**

This source is published for reference and transparency only. It is not open source, and no rights are granted to use, copy, modify, deploy, or redistribute it. See [LICENSE](LICENSE).

- Licensing inquiries: **licensing@festie.us**
- Security reports: see [SECURITY.md](SECURITY.md). Please do not open public issues for vulnerabilities.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) for system design, module map, and data flow
- [GETTING_STARTED.md](GETTING_STARTED.md) for local development setup
- [CONTEXT.md](CONTEXT.md) for the domain vocabulary
- [docs/adrs/](docs/adrs/) for the twelve architecture decision records
- [docs/SOCKET_CONTRACT.md](docs/SOCKET_CONTRACT.md) for the real-time wire contract
- [docs/TESTING.md](docs/TESTING.md) and [docs/runbooks/](docs/runbooks/) for test and deploy procedure
- [CHANGELOG.md](CHANGELOG.md) for release history through 1.10.2
- [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md)

## Author

Built by [Asir Khan](https://www.linkedin.com/in/asir-khan-310317264/).
