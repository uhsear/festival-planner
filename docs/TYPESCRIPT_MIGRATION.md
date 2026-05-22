# TypeScript Migration Plan

**Status**: Planning
**Decision date**: 2026-05-21
**Target**: Full-stack TypeScript (backend + frontend + shared + mobile)

## Decision

After analysis by 10 parallel agents across 7 dimensions (codebase inventory, backend complexity, mobile feasibility, alternative languages, dependency support, real-time performance, SaaS readiness), TypeScript was confirmed as the only language that can unify all layers of Festie without a rewrite.

See ADR in `docs/adrs/005-typescript-migration.md` for the full decision record.

## Current State

| Layer | Language | Module System | Status |
|-------|----------|---------------|--------|
| Backend (lib/, routes/, server.js) | JavaScript | CommonJS | Migration target |
| Frontend (packages/web/) | TypeScript | ESM | Already done |
| Shared (packages/shared/) | TypeScript | ESM | Already done |
| Tests (tests/) | JavaScript | CommonJS | Migration target |
| Mobile (packages/mobile/) | — | — | New package |

## Migration Phases

### Phase 1: Foundation (Est. 8-10 hours)
- [ ] Add `"type": "module"` to root package.json
- [ ] Add TypeScript, tsx, @types/express, @types/node, @types/multer, @types/supertest to devDependencies
- [ ] Create root `tsconfig.json` (target ES2022, module NodeNext, strict mode)
- [ ] Create `tsconfig.build.json` excluding tests
- [ ] Add `npm run typecheck` script
- [ ] Convert `server.js` → `server.ts`
- [ ] Replace 5 `__dirname` usages with `import.meta.url` pattern
- [ ] Update ESLint config for TypeScript (typescript-eslint)
- [ ] Update PM2 ecosystem.config.js entry point
- [ ] Update Dockerfile build step
- [ ] Update CI workflow with backend typecheck job

### Phase 2: Core Modules (Est. 30-40 hours)
- [ ] Define `AppContext` interface in `lib/app-context/types.ts` (~90 properties)
- [ ] Convert `lib/config.ts` — define `Config` type from DEFAULTS
- [ ] Extract Zod inferred types from `lib/schemas.ts` via `z.infer<>`
- [ ] Convert `lib/app-context/` (index, csp, avatar, request-helpers, cookies)
- [ ] Convert `lib/db/` — connection pool, 13 store modules with typed return values
- [ ] Convert `lib/redis.ts` — rate limiter, presence, circuit breaker
- [ ] Convert `lib/rate-limiting.ts`
- [ ] Convert `lib/middleware.ts`
- [ ] Convert `lib/socket-setup.ts` with typed Socket.IO event maps
- [ ] Convert remaining lib/ modules (emitter, presence, logger, shutdown, crypto-auth, email, metrics, helpers/, notifications/)

### Phase 3: Routes (Est. 15-18 hours)
- [ ] Convert all 29 route factory modules to TypeScript
- [ ] Each accepts `AppContext` parameter, returns typed `Router`
- [ ] Request bodies typed via Zod inferred types
- [ ] Update `server.ts` route mounting with typed imports

### Phase 4: Tests & Polish (Est. 10-15 hours)
- [ ] Create typed `makeMockDeps()` factory for test mocks
- [ ] Convert test helpers (`_integration-helpers.ts`)
- [ ] Convert 78 backend test files (.js → .ts)
- [ ] Convert Playwright E2E specs (.spec.js → .spec.ts)
- [ ] Update npm test scripts
- [ ] Verify c8 coverage with TypeScript
- [ ] Enable `strict: true` incrementally (noImplicitAny → strictNullChecks → strictFunctionTypes)
- [ ] Remove all remaining `any` types

### Phase 5: Mobile (Est. 340 hours)
- [ ] Initialize Expo project in `packages/mobile/`
- [ ] Create platform adapters (storage, connectivity, offline queue)
- [ ] Wire `@festie/shared` imports
- [ ] Build React Native screens
- [ ] Set up React Navigation
- [ ] Push notification integration (Expo Notifications)

## Key Decisions

### ESM First, Then TypeScript
Convert `require`/`module.exports` to `import`/`export` before adding types. This avoids fighting two module systems simultaneously.

### Strict Mode Incrementally
Start with `noImplicitAny: true`, add `strictNullChecks` after optional features (Redis, Firebase) are typed, then `strictFunctionTypes` last.

### No ORM
Keep raw `pg` queries with typed store interfaces. The parameterized SQL pattern is working well and adding Prisma/Drizzle would be a separate migration.

### AppContext is the Keystone Type
The `AppContext` interface (~90 properties) flows through all 33 route factories. Define it first — it unlocks type safety everywhere.

### Zod → TypeScript Types
`z.infer<typeof schema>` provides both runtime validation and compile-time types. No duplication of type definitions.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Breaking existing tests during conversion | Convert tests last; keep running JS tests against TS source via tsx |
| Large deps object hard to type | Define AppContext interface first, then convert modules incrementally |
| CI downtime during migration | Keep CI running with both JS and TS in parallel |
| Optional features (Redis, Firebase) complicate types | Use discriminated unions for optional dependencies |

## Estimated Total Effort

| Phase | Hours | Duration (1 dev) |
|-------|-------|-------------------|
| Foundation | 8-10 | 1-2 days |
| Core modules | 30-40 | 4-5 days |
| Routes | 15-18 | 2-3 days |
| Tests & polish | 10-15 | 2-3 days |
| **Backend total** | **63-83** | **~2 weeks** |
| Mobile (separate track) | ~340 | ~8-10 weeks |

## GitHub Issues

Migration work is tracked under the `migration` label with phase-specific labels (`phase-1` through `phase-4`).
