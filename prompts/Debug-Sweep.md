# Debug Sweep -- Claude Code Prompt

Full 6-layer debug sweep with a mode switch. Uses Playwright MCP + paramiko SSH + parallel agents. Use /diagnose for single-issue triage instead.

---

## The Prompt

```
Debug sweep on Festie.

MODE: loop   (loop = up to 10 passes, stop when 0 issues)
BEHAVIOR: Find -> fix -> deploy via paramiko (tests gate; no commit if fail). Never skip a layer.

SSH: paramiko from main thread. Playwright: MCP tools (`mcp__playwright__browser_*`).

PARALLEL where safe (Agent tool, run_in_background: true):
  - Layer-2 DB integrity scans (independent SQL)
  - Layer-3 static code scans (missing awaits, console.log, CORS drift)
  - Layer-4 Playwright device cells (each cell is independent)

SEQUENTIAL:
  - Fix -> deploy -> re-verify loop (paramiko SFTP + pm2 restart)

---

## SWEEP LAYERS

### Layer 1 -- Infrastructure (paramiko)
PM2 4/4 online (name "festie"), restarts < 10 since last deploy. Memory < 80%, disk < 85%.
Health < 500ms. Redis PING < 50ms. PostgreSQL ready. schema_migrations count matches `ls migrations/*.sql`.

### Layer 2 -- Database Integrity
Soft-delete filters: every festival_profiles query must have `deleted_at IS NULL`.
Audit: orphaned profiles/picks, duplicate active profiles, empty password_hash, expired device tokens, queries > 5s.
Check audit_log.target_type -- NOT NULL constraint; default 'unknown' where route unknown.

### Layer 3 -- Backend Code
Missing awaits on store calls (lib/db/stores/*.ts -- each method is async).
Unhandled promise rejections, missing try/catch, CORS/CSRF/rate-limits/admin-auth enforced.
No console.log in prod code. .env complete (RESEND_API_KEY, EMAIL_FROM, SPOTIFY_CLIENT_*, FIREBASE_CREDENTIALS_PATH if push enabled).
`npm test` runs with 0 failing and 0 skipped.
ESLint `preserve-caught-error`: every re-thrown Error carries `{ cause: origErr }`.

### Layer 4 -- Frontend (Playwright MCP)
No JS errors, no failed requests, no mixed content. React 19 frontend served from `packages/web/dist/` (Vite 8, TanStack Router). Client-side routing (/cards, /crew, /picks, /grid, /timeline, /compare, /account, /wrap, /festival-mode) works on direct access + back/forward. Vite hashed assets -- no manual cache-bust needed. Vite-PWA generates `sw.js` + workbox precaching in `dist/`. Socket connected. Security headers present.

Multi-device pass: iPhone SE 320x568, iPhone 14, Pixel 7 x {/, /cards, /picks, /crew, /grid, /timeline, /account, /wrap, /compare, /festival-mode} x {guest, logged-in}.
Per cell: browser_snapshot -> view matches URL; bottom-nav not occluded; touch >= 44px; no horizontal scroll; browser_console_messages level=error returns only expected guest 401s.
React components at `packages/web/src/` (routes, components, hooks). CSS via Tailwind utilities in components + `packages/web/src/styles/components.css` / `pages.css` for custom CSS. Shared logic at `packages/shared/src/` (Zustand stores, hooks, types, services, utils).
Dump snapshots + metrics.json to `.playwright-mcp/debug-<date>/`.

### Layer 5 -- Integration
Cross-tab Socket.IO sync (pick in tab 1 -> tab 2 within 2s). Forgot-password end-to-end. ICS export completes. Device tokens healthy.

### Layer 6 -- Quality Gate
Final checks each pass: `npm test` (0 fail), `pnpm --filter @festie/web typecheck`, `npm run lint`. All must pass before ship.

---

## TRACKING (loop mode only)
| ID | Pass | Layer | Severity | Issue | Fix (files) | Status |
|----|------|-------|----------|-------|-------------|--------|
| P1-01 | 1 | 3 | HIGH | description | lib/x.ts, tests/y.test.ts | FIXED |

## WRAP UP
single: "All clear -- 0 issues" OR "Fixed N issues: [symptom / cause / files per item]"
loop:   "All clear after N passes -- 0 issues. Total X issues (Y CRITICAL, Z HIGH). Final gate PASS."
```
