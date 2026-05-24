# Full Codebase Review — 2026-05-02

Full audit + implementation sprint. All 40 findings addressed.

## Verification

| Check | Result |
|-------|--------|
| TypeScript (`pnpm --filter @festie/web typecheck`) | 0 errors |
| Backend lint (`npm run lint`) | 0 errors, 1 pre-existing warning |
| Frontend lint (`pnpm --filter @festie/web lint`) | 0 errors, 32 pre-existing warnings |
| Vite build (`pnpm build`) | Success (34 chunks, 943 KiB precache) |
| Backend syntax (`node --check`) | All 16 modified files pass |
| Test file syntax | All 6 new test files pass |

## Implemented (34 items)

### Dead Code & Config Cleanup (Agent 1)
- Deleted `lib/etag.js` (zero imports)
- Deleted `lib/avatar-file-helpers.js` (superseded by lib/app-context/avatar.js)
- Deleted `lib/cache-helpers.js` (inlined into app-context)
- Deleted `lib/migrate.js` (SQLite-to-PG migration, no longer needed)
- Removed `DB_PATH` computation from `lib/config.js` (SQLite remnant)
- Removed `ADMIN_USER`/`ADMIN_PASSWORD` env vars from config + tests
- Updated `.dockerignore` (+6 exclusions: .github/, docs/, *.md, *.png, .claude/, prompts/)
- Updated `Dockerfile` (removed python3 dep, fixed comment)

### Code Quality (Agent 2)
- Fixed 3 bare `throw err` in `routes/account.js` with descriptive errors + `{ cause }`
- Removed 18 unused imports from `lib/app-context/index.js`
- Renamed `createFestivalPlanner` -> `createFestieApp` in `server.js` (backward-compat alias kept)
- Updated 5 shell scripts: cosmetic "festival-planner" -> "festie"

### API Validation & Security (Agent 3)
- Added 7 Zod schemas: refreshToken, ratingCreate, expenseCreate, expenseSettle, adminBulkDeactivate, adminBulkArchive, adminAddRole
- Wired validation middleware on 6 unvalidated endpoints (auth, ratings, expenses, admin-bulk, admin-users)
- Fixed inconsistent error response in `routes/analytics-install.js`
- Fixed inconsistent success response in `routes/share.js`
- Added SQL injection guard (regex allowlist) in `lib/db/stores/profiles.js` batchInsert

### Performance (Agent 4)
- Batched `deleteByUserId` from 2N to 2 queries (profiles.js)
- Batched `replaceAll` from 5N to 5 queries via multi-row UPSERT (profiles.js)
- Added cached memory usage in socket.js (5s refresh, .unref())
- Added `getByIds(userIds)` method to users store (ANY($1) batch)
- Changed profiles route from getUserMap (all users) to getByIds (filtered)
- CSS: `transition: all` -> specific properties on `.btn` and `.input-base`

### DetailPanel Split (Agent 5)
- Refactored `DetailPanel.tsx` from 695 -> 225 lines
- Extracted `useDetailPanelData.ts` hook (122 lines)
- Extracted `DetailPriorityPicker.tsx` (52 lines)
- Extracted `DetailArtistHeader.tsx` (123 lines)
- Imported 4 pre-existing sub-components (SpotifySection, ConflictWarning, CrewSection, NotesSection)

### Error Boundaries & Types (Agent 6)
- Created `RouteErrorBoundary.tsx` (reusable class component)
- Wrapped 4 routes: timeline, grid, crew, cards
- Replaced `any` types in `useOffline.ts` with `unknown`
- Replaced `any` type in `socket.ts` with proper error type

### Documentation (Agent 7)
- Rewrote `ARCHITECTURE.md` (299 lines, all SQLite/monolithic references removed)
- Created `README.md` (135 lines — tech stack, setup, scripts, structure, env vars)
- Updated project docs with OpenAPI reference, removed stale caveat

### CI/CD (Agent 8)
- Added `master` branch to CI triggers (push + PR)
- Added pnpm setup + frontend lint step to CI
- Removed Lighthouse failure suppression (`|| echo` removed)
- Added `master` to Lighthouse and Docker job conditionals
- Added `best-practices` Lighthouse assertion at 0.9

### Tests (Agent 9)
- `integration-ratings.test.js` — 7 tests (CRUD, upsert, validation, aggregates)
- `integration-weather.test.js` — 4 tests (404, no-coords, fetch, public)
- `integration-calendar-sync.test.js` — 6 tests (create, idempotent, auth, no-profile, invalid, empty)
- `integration-client-metrics.test.js` — 6 tests (valid, all types, invalid, range, public, content-type)
- `integration-analytics.test.js` — 7 tests (track, platforms, validation, optional fields, clamping)

### Socket Tests & Legacy SW (Agent 10)
- Added 4 socket tests: join:crew, leave:crew, reconnect:restore, reconnect:restore unauthenticated
- Fixed legacy SW conflict in `lib/middleware.js` (serves React dist SW when present)

## Phase 2 — Previously Deferred (6 items, all implemented)

### Cookie Rename (Agent 11)
- Renamed `festival_user_session` -> `festie_session` in config.js, openapi.js, tests, docs
- Added backward-compatible dual-read in cookies.js (checks legacy cookie name as fallback)
- Existing sessions unaffected — identified by SHA-256 token, not cookie name

### Legacy Public/ Cleanup (Agent 12)
- Deleted 49 legacy files: app.css (3493 lines), app.js, app-deferred.css, index.html, sw.js, manifest.webmanifest, styles/, app/ (27 modules), views/ (15 files)
- Kept 16 static assets: .well-known/, icons/, screenshots/, legal pages, robots.txt, sitemap.xml, firebase-messaging-sw.js, offline.html, export-template.html
- Removed app.css link from React index.html and /app.css Vite proxy
- Simplified middleware.js: SW always from React dist, removed /legacy mount

### Dark Mode (Agent 13)
- Added `[data-theme="light"]` CSS variables in globals.css (12 color overrides + component-specific tweaks)
- Covers glass cards, skeleton shimmer, scrollbar, timeline shadows, crew activity, admin tabs
- Header.tsx now updates `meta[name="theme-color"]` on toggle (#080810 dark / #f5f5f7 light)

### Cursor Pagination (Agent 14)
- Added `paginationQuery` Zod schema (cursor + limit 1-100, default 50)
- Paginated 4 endpoints: admin users, ratings by festival, crew ratings, crew activity
- Store methods use `LIMIT N+1` pattern with nextCursor
- Fully backward-compatible: params optional, first page returned by default

### Branch Protection (Agent 15)
- Configured via `gh api` on `main` branch
- Required status checks (strict): lint, test(20), test(22), quality
- Required 1 PR approval, force push blocked, branch deletion blocked
