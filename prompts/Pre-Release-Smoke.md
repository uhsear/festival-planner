# Pre-Release Smoke -- Claude Code Prompt

End-to-end smoke test using the Playwright MCP for browser-side checks. Two modes: **everyday** (after any deploy) and **pre-festival** (stricter go/no-go gate).

---

## The Prompt

```
Smoke-test Festie (version from `cat package.json`). Fix anything broken. Do NOT just catalog.

MODE: everyday | pre-festival  (default: everyday)
  - everyday      -- 20 min; run after any deploy
  - pre-festival  -- 60+ min; stricter gates; produces go/no-go verdict

Test fails -> fix -> deploy via paramiko -> re-verify.
DATA SAFETY: unique timestamped IDs. Delete ONLY by exact ID -- never broad DELETE.

SSH: paramiko from main thread (Windows). Never from subagents.
Browser: Playwright MCP tools (`mcp__playwright__browser_navigate`, `browser_snapshot`, `browser_take_screenshot`, `browser_console_messages`, `browser_click`, `browser_type`). Registered at user scope.

===============================================================
PHASE 1 -- Infrastructure (paramiko SSH)
===============================================================
PM2 4/4 online (process name "festie" -- NOT festival-planner), 0 crashes since last deploy.
Health 200 (< 500ms). Redis PONG (< 50ms). PostgreSQL ready, no queries > 5s.
Disk < 85%, memory < 80%. npm test: 0 failing (check `# fail` line in footer).
schema_migrations count == `ls migrations/*.sql | wc -l`.

pre-festival ONLY: uptime > 24h, memory < 300MB/instance, DB pool < 50% max,
backup within 24h, crons healthy (auto-deploy, reminder-scheduler, audit-log-cleanup).

===============================================================
PHASE 1b -- React Build Artifacts (paramiko SSH)
===============================================================
`packages/web/dist/` exists and contains hashed assets:
  - `ls packages/web/dist/index.html` -> file exists (React SPA entry point)
  - `ls packages/web/dist/assets/*.js` -> at least one hashed `.js` bundle
  - `ls packages/web/dist/assets/*.css` -> at least one hashed `.css` bundle
Express serves React `index.html` (not legacy `public/index.html`) for `/`:
  - `curl -s http://127.0.0.1:4000/ | head -20` -> contains `<div id="root">` or Vite asset references

===============================================================
PHASE 2 -- Public surface (Playwright MCP)
===============================================================
browser_navigate -> festie.us, /privacy, /terms, /security-whitepaper.
browser_console_messages level=error -> only expected 401s on /auth/verify, /auth/me, /profiles/:fk for guests.
No CSP violations. No blank screens.

===============================================================
PHASE 3 -- Auth + Core Flows
===============================================================
Register testuser_<ts>/TestPass123! -> logout -> login -> socket connected -> wrong-password returns error.
Join festival -> profile created -> schedule shows sets -> pick Must/Want/Maybe -> correct colors -> remove clears -> add note -> detail panel (Spotify artist preview for matched, genre chips, reminder Off/15m/30m/1h).
Crews: create SmokeTestCrew_<ts> -> invite code + expiry visible -> Picks/Conflicts/Activity/Expenses/Polls tabs lazy-load on first click -> expired invite returns 410.
Crew features: activity feed, expense with split picker, balances + Settle Up, poll vote, weather widget.
Spotify preview endpoint: guest GET /api/v1/spotify/preview/<real-set-id> returns 200 (verifies userAuth removal + rate limit).

===============================================================
PHASE 4 -- Navigation + Theming + Real-time
===============================================================
History API routing: direct URL, back/forward, hash auto-migrate for /, /picks, /crew, /grid, /timeline.
Dark -> light toggle -> readable contrast -> persists.
Festival-mode toggle works. Socket cross-tab sync < 2s.

===============================================================
PHASE 5 -- Export, Admin, PWA
===============================================================
HTML export triggers, ICS calendar sync, share link generates + resolves, Canvas PNG via user menu triggers Web Share or download fallback.
/admin without auth -> 401. /api/docs loads. Admin tabs: Dashboard, Users, Festivals, Crews, Analytics, Audit.
SW registered, manifest loads, install prompt works on Chrome/Edge.

===============================================================
PHASE 6 -- Multi-device (Playwright MCP)
===============================================================
Routes x {guest, logged-in} x {iPhone SE 320x568, iPhone 14, iPhone 14 Pro Max, Pixel 7}: /, /cards, /picks, /crew, /grid, /timeline, /account, /wrap, /compare, /festival-mode.

Per cell, verify via browser_snapshot:
- view matches URL
- cookie banner + guest banner do NOT occlude bottom-nav
- touch targets >= 44x44 CSS px
- no horizontal scroll at 320x568
- timeline defaults to all stages
- browser_console_messages level=error returns only expected guest 401s

Dump screenshots to `.playwright-mcp/smoke-<YYYY-MM-DD>/`.

pre-festival ONLY: throttled 3G -> festie.us loads < 3s; no regression on LCP, CLS, INP vs previous run (saved to docs/session-logs/smoke-<date>/metrics.json).

===============================================================
PHASE 7 -- A11y + Security
===============================================================
ARIA landmarks, keyboard tab navigation (no traps), focus ring visible, focus trap on modals.
Color contrast samples: body, primary CTA, error, disabled state.
HTTPS enforced, no mixed content. Headers present: HSTS, CSP (strict nonce-based, no unsafe-inline), X-Frame-Options.
SQL/XSS sanitized. npm audit: 0 unaddressed critical/high.

===============================================================
PHASE 8 -- Data sanity (pre-festival only)
===============================================================
Target festival exists with correct dates + stages. Set times display.
Spotify linking works end-to-end. Share links generate + resolve.
Backups exist and are < 24h old.

===============================================================
CLEANUP + VERDICT
===============================================================
Delete test data by exact ID.
Call `mcp__playwright__browser_close` at the end.

everyday verdict:      "All PASS (N routes x N devices)" | "X failures: [list]"
pre-festival verdict:  READY | READY WITH NOTES | NOT READY (list blockers)
```
