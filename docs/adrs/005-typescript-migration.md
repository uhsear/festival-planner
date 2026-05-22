# ADR 005: Migrate Backend to TypeScript

**Status**: Accepted
**Date**: 2026-05-21
**Deciders**: uhsear

## Context

Festie's frontend (packages/web/) and shared package (packages/shared/) are TypeScript, but the backend (197 files in lib/, routes/, server.js) is plain JavaScript with CommonJS modules. This creates a type safety gap at the API boundary and prevents code sharing with a future React Native mobile app.

## Decision

Migrate the backend to ESM TypeScript. Unify the entire codebase on one language.

## Analysis

10 parallel agents evaluated 7 dimensions:

1. **Codebase inventory**: 54% already TypeScript (frontend + shared). Backend is the only JS holdout.
2. **Backend complexity**: 60-80 hours estimated. Clean architecture (factory functions, no circular deps, no dynamic requires). All 233 require() calls are static.
3. **Mobile feasibility**: React Native can reuse 65-70% of packages/shared/ (~1,900 LOC). Any non-TypeScript language would require rewriting this from scratch.
4. **Alternative languages**: Dart/Flutter (weak backend/web), Kotlin MP (experimental web), Go/Rust/Python/Swift (can't unify all layers). Only TypeScript works for backend + web + mobile.
5. **Dependency support**: All major deps have TypeScript types. 4 need @types/* packages (express, multer, swagger-ui-express, supertest).
6. **Real-time performance**: Node.js + Socket.IO is the right runtime. The real-time layer is thin (unidirectional push, rooms capped at 200). Node has 100x headroom.
7. **SaaS readiness**: TypeScript ecosystem has excellent Stripe, auth (Clerk/WorkOS), BullMQ, and OpenTelemetry support.

## Consequences

### Positive
- End-to-end type safety (Zod schemas → TypeScript types → API responses → frontend stores)
- React Native mobile app can reuse shared package directly
- Better IDE support and refactoring confidence across the backend
- Catches real bugs: missing config parameter in normalizers, unguarded rows[0] access, untyped req.user

### Negative
- 60-80 hours of migration work with no new features
- Brief CI complexity while JS and TS coexist
- Slight build overhead (tsx loader for dev, tsc for production)

### Neutral
- Testing infrastructure works unchanged (node:test + c8 support TypeScript via tsx)
- Database layer stays as raw pg queries (no ORM change)

## Alternatives Considered

| Alternative | Why rejected |
|-------------|-------------|
| Dart/Flutter | Backend ecosystem immature, web uses canvas (breaks PWA) |
| Kotlin Multiplatform | Web frontend experimental, full rewrite |
| Stay JavaScript + JSDoc types | Half measure — no inferred types from Zod, no type-safe DI |
| Python (FastAPI) | Can't unify frontend, full rewrite |
