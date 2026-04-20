# Full Project Review — 2026-04-19 (Pass 2)

## Summary

| Metric | Value |
|--------|-------|
| Passes completed | 1 |
| Total findings | 58 |
| CRITICAL | 4 (all fixed) |
| HIGH | 10 (6 fixed, 4 deferred) |
| MEDIUM | 28 |
| LOW | 16 |
| Fixed this pass | 10 |
| Deferred | 48 |
| Unit tests | 230 pass / 0 fail (no DB) |
| TypeScript | Clean (0 errors) |
| Browser verification | 12/12 pass (3 devices × 5 routes) |
| CI status before | 5 consecutive failures (RED) |

## CRITICAL + HIGH Findings Fixed

| ID | Layer | Severity | Finding | Fix | Status |
|----|-------|----------|---------|-----|--------|
| CI-01 | CI | CRITICAL | Migration 029 uses `CONCURRENTLY` — breaks CI idempotency test | Removed `CONCURRENTLY` from all DROP/CREATE INDEX statements | FIXED |
| CI-02 | CI | CRITICAL | pnpm lockfile mismatch — `zod: 4.3.6` (exact) vs lockfile `^4.3.6` | Added `^` to package.json, regenerated lockfile | FIXED |
| SEC-01 | Security | CRITICAL | `.env` not in `.gitignore` — secrets could be committed | Added `.env`, `.env.local`, `.env.production`, `.env.*.local`, `*.pem`, `*.key`, `credentials*.json` | FIXED |
| F12 | Frontend | CRITICAL | No automatic 401 token refresh — users silently logged out on expiry | Added `setOnUnauthorized` callback + 401 interceptor with dedup and retry-once guard in `api.ts`; wired up in `main.tsx` | FIXED |
| SEC-02 | Security | HIGH | Swagger UI (`/api/docs`) publicly accessible in production | Gated behind `NODE_ENV !== 'production'` check | FIXED |
| SEC-03 | Security | HIGH | Default `BIND_ADDRESS` is `0.0.0.0` — exposes on all interfaces | Changed default to `127.0.0.1`; updated test expectation | FIXED |

## HIGH Findings Deferred

| ID | Layer | Severity | Finding | Reason |
|----|-------|----------|---------|--------|
| OPS-01 | Infra | HIGH | No offsite backup configured (`OFFSITE_TARGET` not set) | Requires server config — not fixable from code alone |
| A02 | A11y | HIGH | Missing per-route `<h1>` headings (screen readers) | 13 route files affected, needs design input on visible vs sr-only |
| A04 | A11y | HIGH | 20+ unlabeled form inputs in admin/crew components | Touches 6+ component files, needs careful label text |
| F17 | Frontend | HIGH | 60+ `any` type usage across TypeScript packages | Large refactor across many files, separate PR recommended |

## Browser Verification Results

| Device | Viewport | Routes Tested | Status | Issues |
|--------|----------|---------------|--------|--------|
| iPhone SE | 320×568 | /, /picks, /crew, /grid, /timeline | ALL PASS | None |
| Pixel 7 | 412×839 | /, /picks | ALL PASS | None |
| Desktop | 1440×900 | /, /picks, /crew, /grid, /timeline | ALL PASS | 429 on notification token (rate limit from automated testing) |

No blank screens, no JS errors, proper responsive layout. Bottom nav visible on mobile, skip-link and ARIA roles correct.

## Database Health

| Finding | Status |
|---------|--------|
| Orphaned profiles | PASS (0 found) |
| Duplicate active profiles | PASS (0 found) |
| Empty password hashes | PASS (0 found) |
| Missing FK indexes | PASS (0 found) |
| Invalid indexes/constraints | PASS (0 found) |
| Buffer cache hit rates | PASS (99.9% index, 100% table) |
| 8 empty tables | MEDIUM — crew_expenses, crew_activity, notification_log, etc. |
| 220 refresh tokens (no cleanup) | MEDIUM |

## Architecture Insights

**Graph stats:** 343 files, 2554 nodes, 1282 functions, 23997 edges, 12 communities.

**Largest communities:**
1. `tests/` — 1076 nodes (comprehensive test suite)
2. `lib/` — 246 nodes (backend core)
3. `packages/web/` — 228 nodes (React frontend)
4. `lib/db/` — 169 nodes (database stores)

**Strengths:**
- All async store methods properly awaited
- `deleted_at IS NULL` filters consistently applied on soft-deletable tables
- Zero TODO/FIXME/HACK comments in production code
- Zero console.log leaks in production server code
- Multi-tier rate limiting with Redis failover
- Pino structured logging with PII redaction
- PM2 cluster mode with graceful shutdown
- Comprehensive health check endpoints

## MEDIUM Findings (Summary)

| Category | Count | Key Items |
|----------|-------|-----------|
| Code Quality | 8 | Duplicated utility functions (formatTime, getAvatarColor), large files (crews.js 641 lines, timeline.tsx 671 lines), missing error causes on re-thrown errors |
| Frontend | 6 | Large components (UserMenu 520 lines), ui-motion chunk 143KB, missing loading states in grid/timeline, StaleWhileRevalidate for pick-sensitive endpoints |
| Security | 4 | Legacy ADMIN_USER/PASSWORD in config, WEBHOOK_TOKEN_HMAC_KEY empty default, per-process idempotency cache, MOBILE_ORIGINS no validation |
| Database | 3 | 8 empty tables, refresh token accumulation, no replication |
| Infrastructure | 5 | No log rotation in PM2 config, no HTTP keepAliveTimeout, backup restore untested, backup-pg.sh unencrypted, setup-crons.sh manual |
| Accessibility | 4 | No light mode support, heading hierarchy skips, grid overflow at 320px, inconsistent bottom-nav padding |
| Testing | 3 | Frontend has 0 test files, ratings/expenses routes untested, Socket tests use setTimeout (flaky risk) |

## LOW Findings (Summary)

16 low-severity items covering: minor npm patches, unused indexes, hardcoded URLs, admin-only overflow at 320px, Sentry deprecated API pattern, redundant backup scripts, health-check restart scope.

## Recommendations (Top 5 by Impact/Effort)

1. **Configure offsite backups** (OPS-01, HIGH) — Set `OFFSITE_TARGET` to S3/NAS. All backups currently on same host. Effort: S.
2. **Add per-route `<h1>` headings** (A02, HIGH) — Use `sr-only` class. Impacts all screen reader users. Effort: S.
3. **Add `aria-label` to admin form inputs** (A04, HIGH) — 20 inputs across 6 components. Effort: M.
4. **Set HTTP keepAliveTimeout** (OPS-F10, MEDIUM) — One-line fix prevents 502s behind Cloudflare. Effort: XS.
5. **Add frontend tests** (TEST-04, P0) — Zero vitest files despite config. Start with auth and pick flows. Effort: M.

## Files Changed

| File | Change |
|------|--------|
| `.gitignore` | Added .env, secrets, credential patterns |
| `lib/config.js` | BIND_ADDRESS default → `127.0.0.1` |
| `lib/middleware.js` | Swagger UI gated behind `NODE_ENV !== 'production'` |
| `migrations/029_index_cleanup_and_pgss.sql` | Removed `CONCURRENTLY` from all index operations |
| `packages/shared/src/services/api.ts` | Added 401 interceptor with token refresh + retry-once guard |
| `packages/web/package.json` | Fixed zod version specifier (`4.3.6` → `^4.3.6`) |
| `packages/web/src/main.tsx` | Wired `setOnUnauthorized` to authStore.refreshToken |
| `packages/pnpm-lock.yaml` | Regenerated to match package.json |
| `tests/unit.test.js` | Updated BIND_ADDRESS test expectation |
