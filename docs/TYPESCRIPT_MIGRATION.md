# TypeScript Migration Plan

**Status**: Complete (Phases 1-4)
**Decision date**: 2026-05-21
**Completed**: 2026-05-22
**Target**: Full-stack TypeScript (backend + frontend + shared + mobile)

## Decision

After analysis by 10 parallel agents across 7 dimensions (codebase inventory, backend complexity, mobile feasibility, alternative languages, dependency support, real-time performance, SaaS readiness), TypeScript was confirmed as the only language that can unify all layers of Festie without a rewrite.

See ADR in `docs/adrs/005-typescript-migration.md` for the full decision record.

## Current State

| Layer | Language | Module System | Status |
|-------|----------|---------------|--------|
| Backend (lib/, routes/, server.ts) | TypeScript | ESM | Complete |
| Frontend (packages/web/) | TypeScript | ESM | Already done |
| Shared (packages/shared/) | TypeScript | ESM | Already done |
| Tests (tests/) | TypeScript | ESM | Complete |
| Mobile (packages/mobile/) | — | — | New package |

## Migration Phases

### Phase 1: Foundation - COMPLETE
- [x] Add `"type": "module"` to root package.json
- [x] Add TypeScript, tsx, @types/express, @types/node, @types/multer, @types/supertest to devDependencies
- [x] Create root `tsconfig.json` (target ES2022, module NodeNext, strict mode)
- [x] Add `npm run typecheck` script
- [x] Convert `server.js` → `server.ts`
- [x] Replace `__dirname` usages with `import.meta.url` pattern
- [x] Update ESLint config for TypeScript (typescript-eslint)
- [x] Update PM2 `ecosystem.config.cjs` entry point
- [x] Update CI workflow with backend typecheck job

### Phase 2: Core Modules - COMPLETE
- [x] Convert all `lib/` modules from CommonJS JavaScript to TypeScript ESM
- [x] Convert `lib/app-context/` (index, csp, avatar, request-helpers, cookies, cache, session)
- [x] Convert `lib/db/` — connection pool, 15 store modules
- [x] Convert `lib/redis.ts`, `lib/rate-limiting.ts`, `lib/middleware.ts`
- [x] Convert `lib/socket-setup.ts`
- [x] Convert remaining lib/ modules (emitter, presence, logger, shutdown, crypto-auth, email, metrics, helpers/, notifications/)

### Phase 3: Routes - COMPLETE
- [x] Convert all 29 route factory modules to TypeScript ESM
- [x] Update `server.ts` route mounting with ESM imports

### Phase 4: Tests & Polish - COMPLETE
- [x] Convert test helpers (`_integration-helpers.ts`)
- [x] Convert all backend test files (.js → .ts)
- [x] Convert Playwright E2E specs (.spec.js → .spec.ts)
- [x] Update npm test scripts for tsx/esm
- [x] Replace CJS `require.cache` patterns with ESM cache busting
- [x] Add `fileURLToPath(import.meta.url)` polyfill for `__dirname` in all test files
- [x] Worker thread inline fallback for .ts file loading limitations
- [x] Inject test dependencies (email client) instead of CJS cache patching
- [x] TypeScript compiles cleanly (0 errors)
- [x] 2472 unit tests pass, 0 fail
- [x] ESLint updated with TypeScript parser and @typescript-eslint rules

### Phase 5: Mobile (Future)
- [ ] Initialize Expo project in `packages/mobile/`
- [ ] Create platform adapters (storage, connectivity, offline queue)
- [ ] Wire `@festie/shared` imports
- [ ] Build React Native screens
- [ ] Set up React Navigation
- [ ] Push notification integration (Expo Notifications)

## Key Decisions

### ESM First, Then TypeScript
Converted `require`/`module.exports` to `import`/`export` before adding types. This avoided fighting two module systems simultaneously.

### Worker Thread Limitation
tsx's import hooks don't propagate to Worker threads in Node 23. Solution: inline fallback for export route (`buildExportHtml` runs in-process when Worker can't load .ts), direct function testing in tests.

### ESM Cache Busting
Replaced CJS `require.cache` deletion with ESM dynamic import cache busting: `await import(\`./module.js?v=\${++counter}\`)` for modules with per-import state.

### No ORM
Kept raw `pg` queries with store interfaces. The parameterized SQL pattern is working well and adding Prisma/Drizzle would be a separate migration.

### Zod → TypeScript Types
`z.infer<typeof schema>` provides both runtime validation and compile-time types. No duplication of type definitions.

## Estimated Total Effort

| Phase | Hours | Status |
|-------|-------|--------|
| Foundation | 8-10 | Complete |
| Core modules | 30-40 | Complete |
| Routes | 15-18 | Complete |
| Tests & polish | 10-15 | Complete |
| **Backend total** | **63-83** | **Complete** |
| Mobile (separate track) | ~340 | Future |

## GitHub Issues

Migration work is tracked under the `migration` label with phase-specific labels (`phase-1` through `phase-4`).
