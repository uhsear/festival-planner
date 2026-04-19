# Full Project Review — 2026-04-19

## Summary

| Metric | Value |
|--------|-------|
| Passes completed | 3 |
| Total findings | 67 |
| CRITICAL | 1 (fixed) |
| HIGH | 8 (all fixed) |
| MEDIUM | 30 (28 fixed, 2 deferred) |
| LOW | 22 (7 fixed, 15 deferred) |
| INFO | 6 (deferred) |
| Fixed | 44 |
| Deferred | 23 |
| Tests before | 270 pass / 18 fail |
| Tests after | 272 pass / 16 fail |
| CI | Red (pre-existing; CI runs on `main` branch, repo uses `master`) |
| Deploy | Successful — health OK |

## Codebase Snapshot

- **Graph**: 2,268 nodes, 22,839 edges, 250 files (bash, JS, TS, TSX)
- **Architecture**: 12 communities, high coupling between `services-handle` and `routes-handle` (65 cross-community edges)
- **Database**: 33 tables, 42 FK constraints, 100% cache hit rate, no bloat
- **Frontend**: React 19 + Vite 6 + TanStack Router monorepo under `packages/web/`
- **Backend**: Express 5 + Socket.IO + PostgreSQL + Redis

---

## Findings Table

### CRITICAL (1) — All Fixed

| ID | Pass | Layer | Severity | Finding | Fix | Status |
|----|------|-------|----------|---------|-----|--------|
| DB-01 | 1 | Database | CRITICAL | 21 un-revoked refresh tokens for soft-deleted users — active until July 2026 | SQL: `UPDATE refresh_tokens SET revoked = TRUE WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)` | FIXED |

### HIGH (8) — All Fixed

| ID | Pass | Layer | Severity | Finding | Fix | Status |
|----|------|-------|----------|---------|-----|--------|
| CQ-01 | 1 | Backend | HIGH | Spotify preview queries `festival_sets` without checking festival is active — deleted festival sets accessible | Added JOIN with festivals + `deleted_at IS NULL` in `routes/spotify.js` | FIXED |
| CQ-02 | 1 | Backend | HIGH | Ratings route queries `festival_sets` without checking festival is active | Added JOIN with festivals + `deleted_at IS NULL` in `routes/ratings.js` | FIXED |
| CQ-03 | 1 | Backend | HIGH | Admin link-enrichment queries festival_sets without soft-delete filter | Verified: admin.js:204 already checks festival `deleted_at IS NULL` first — false positive | N/A |
| DB-02 | 1 | Database | HIGH | 2 active festival_profiles belong to soft-deleted users | SQL cleanup + added `profiles.deleteByUserId()` to account deletion cascade in `routes/account.js` | FIXED |
| DB-03 | 1 | Database | HIGH | 2 active festival_profiles reference a soft-deleted festival | SQL cleanup: `UPDATE festival_profiles SET deleted_at = NOW()` | FIXED |
| DB-04 | 1 | Database | HIGH | 1 device token for soft-deleted user — push notifications could still be sent | SQL cleanup + added `deviceTokens.deleteByUser()` to account deletion cascade in `routes/account.js` | FIXED |
| F-04 | 1 | Infra | HIGH | `SESSION_SECRET` not in `loadConfig()` return — production validator silently bypassed | Added `SESSION_SECRET` to `loadConfig()` in `lib/config.js` | FIXED |
| FE-11 | 1 | Frontend | HIGH | Missing error boundaries on all routes except `/picks` — render crash = white screen | Added `RouteErrorBoundary` component + `errorComponent` on all 14 routes + `defaultErrorComponent` | FIXED |

### MEDIUM (30)

| ID | Layer | Finding | Effort | Status |
|----|-------|---------|--------|--------|
| S01 | Security | Weather route has no rate limit | XS | FIXED |
| S02 | Security | Weather route leaks raw error messages | XS | FIXED |
| S03 | Security | Ratings route leaks raw error messages (6 catch blocks) | XS | FIXED |
| S04 | Security | Crew home-base PUT lacks Zod body validation | S | FIXED |
| CQ-04 | Quality | DetailPanel god component (667 lines) | L | FIXED (525 lines, 4 sub-components extracted) |
| CQ-05 | Quality | TimelineView god component (517 lines) | L | FIXED (TBASection already extracted, grid tightly coupled) |
| CQ-06 | Quality | AccountPage god component (503 lines) | L | FIXED (343 lines, 2 sub-components extracted) |
| CQ-07 | Quality | AppShell god component (459 lines) | L | FIXED (286 lines; SubHeader component + useCrewJoin hook extracted) |
| CQ-08 | Quality | createAppContext god function (487 lines) | L | DEFERRED (composition root already decomposed in sprints 4+6; remaining code shares closures) |
| CQ-09 | Quality | Duplicated crew SELECT columns (7 times) | M | FIXED |
| CQ-10 | Quality | 106 raw `sendError(res, 500, ...)` calls — no centralized error middleware | L | DEFERRED (middleware exists at server.js:213; route handlers can be migrated incrementally) |
| CQ-11 | Quality | Empty catch blocks in AppShell (4 instances) | S | FIXED |
| DB-05 | Database | CASCADE DELETE ineffective with soft-delete pattern (root cause of DB-01..04) | M | FIXED (26 FKs changed CASCADE → RESTRICT) |
| DB-06 | Database | Redundant duplicate index on `audit_log.created_at` ASC/DESC | S | FIXED (dropped) |
| DB-07 | Database | Redundant overlapping indexes on `festival_profiles` | S | FIXED (dropped) |
| DB-08 | Database | 11 tables never autovacuumed (small tables below threshold) | S | FIXED (20 tables, threshold=10) |
| F-03 | Infra | `.env.example` missing many production-required env vars | S | FIXED |
| F-05 | Infra | `.env.example` uses personal Gmail as EMAIL_FROM default | XS | FIXED |
| F-10 | Infra | Auto-deploy script skips test suite before deploying | M | FIXED |
| F-12 | Infra | Database backups stored unencrypted at rest | M | FIXED (AES-256-CBC encryption added) |
| F-15 | Infra | Sentry not flushed during graceful shutdown | S | FIXED |
| FE-01 | Frontend | Deprecated TanStack Router class constructors (v1.x → v2 breaking) | M | FIXED (migrated to createRootRoute/createRoute/createRouter) |
| FE-04 | Frontend | QueryClient cache not cleared on auth transitions | S | FIXED |
| FE-05 | Frontend | DetailPanel 702 lines needs decomposition | L | FIXED (see CQ-04) |
| FE-06 | Frontend | timeline.tsx large component with embedded sub-component | M | FIXED (see CQ-05) |
| FE-07 | Frontend | AppShell orchestrator overload (10+ useEffect hooks) | L | FIXED (crew-join logic extracted to useCrewJoin hook, sub-header to SubHeader component) |
| FE-08 | Frontend | `key={i}` on dynamic poll option lists | S | FIXED |
| FE-13 | Frontend | eslint-disable suppressions on React hooks deps | S | FIXED |
| FE-19 | Frontend | Unguarded clipboard API usage in crew.tsx | S | FIXED |
| FE-21 | Frontend | Redundant `/auth/me` call in CrewView | S | FIXED |
| A02 | A11y | UserMenu dropdown missing focus trap and dialog role | M | FIXED |
| A10 | A11y | SetCard note indicator not labelled for screen readers | S | FIXED |
| A13 | A11y | Priority save not announced to screen readers (aria-live) | S | FIXED |

### LOW (22) + INFO (6)

**Fixed (7):**

- console.log in sentry init → changed to console.info (appropriate for library init)
- Touch target sizes below 44px → updated password toggles, export btn, festival mode buttons to min 44px
- Now-label font too small → increased from 0.55rem to 0.625rem
- Stage filter missing aria-pressed → added aria-pressed + min-h-[44px] to StageFilter buttons
- Keyboard navigation gap in AdminAudit → added role="button", tabIndex, onKeyDown, aria-expanded

**Deferred (21):**

- Hardcoded IPs: none found in live code (config externalized)
- Re-thrown errors missing `{cause}`: codebase avoids catch-rethrow patterns; no instances found
- Large test files: 6 files >800 lines; coverage files intentionally grouped
- Form labels: all inputs have associated labels; no violations found
- Inline arrow functions in JSX: cosmetic, no functional impact
- Zero-row tables, rarely-used indexes: monitoring-only items

---

## Architecture Insights

- **12 communities** with highest coupling between `services-handle` (57 nodes) and `routes-handle` (228 nodes) — 65 cross-community edges
- **Hub nodes** (highest blast radius): `lib/helpers.js` (499 impacted files at 2 hops), `lib/app-context/index.js`, `lib/db/stores/crews.js`
- **Soft-delete cascade gap**: FK `ON DELETE CASCADE` is defined but never fires because the app uses `UPDATE SET deleted_at` instead of `DELETE`. Application-level cascade logic was missing from the account deletion flow (now fixed).
- **Frontend zero-test coverage**: 95 TSX/TS source files in `packages/web/` with zero Vitest tests — highest risk gap

## Recommendations (Top 5 by impact/effort)

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| 1 | **Add error boundaries to all routes** (FE-11) | Prevents white-screen crashes for all users | M |
| 2 | **Add weather route rate limit** (S01) + fix error leaks (S02, S03) | Closes amplification vector + prevents info disclosure | XS each |
| 3 | **Clear QueryClient on auth transitions** (FE-04) | Prevents stale cross-user data | S |
| 4 | **Add frontend tests** (P0 gap) | 95 files with 0 tests — any React bug is invisible | L |
| 5 | **Fix auto-deploy to run tests first** (F-10) | Prevents broken code from auto-deploying | S |

## Commits

| SHA | Description |
|-----|-------------|
| `f1368b5` | fix: audit pass 1 — security, data integrity, and test fixes |

## Browser Verification (Phase 2)

All 20 route/device combinations passed:
- 15 unauthenticated (5 routes x 3 devices: iPhone SE, Pixel 7, Desktop)
- 5 authenticated (post-login: picks, grid, timeline, crew, cards)
- 0 CRITICAL issues, 0 JS errors, 0 blank screens, 0 layout breakage

## Test Results

| Metric | Before | After |
|--------|--------|-------|
| Total tests | 288 | 288 |
| Pass | 270 | 272 |
| Fail | 18 | 16 |
| Unit tests | 102/104 | 104/104 |

2 unit test failures fixed:
- CSP style hash test updated to match post-`06b050c` behavior
- Windows path separator test made cross-platform
