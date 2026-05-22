# Feature Development -- Claude Code Prompt

End-to-end feature build. Enforces the canonical chain. Use for any "build me X" / "add Y" task.

---

## The Prompt

```
Build feature for Festie: <FEATURE DESCRIPTION>.

Use /spec for requirements, /plan for task breakdown if spanning 3+ files.

CHAIN (strict order):
  critique -> design -> (schema) -> implement -> test -> review -> deploy -> Playwright MCP verify

SSH: paramiko from main thread. Subagents analyze only.

---

## Phase 0 -- Should it exist?
Ask: should this feature exist at all? Is there a simpler workflow that solves the same user need? Is this feature creep? If "cut" or "simplify," stop and report back BEFORE Phase 1. If it passes, write a one-paragraph rationale.

## Phase 1 -- Design
- Scan speed: user acts in < 1s
- Mobile-first: design at 320x568 first, scale up
- Friend-coordination / schedule-conflict context if relevant
- Tailwind CSS tokens, WCAG 2.2 touch targets >= 44px
- Identify: which view modules, which routes, which DB tables, which socket events
- Output: short design note with affected files + new schema (if any)

## Phase 2 -- Schema + Migration (if DB touched)
New migration file under `migrations/` (next number; check `ls migrations/ | tail -1`).
- Idempotent (`IF NOT EXISTS`)
- Respect soft-delete pattern (`deleted_at` column on user-owned tables)
- Rollback notes in header comment
- Pre-apply sanity: `psql -f migrations/NNN.sql` on a dev DB first

## Phase 3 -- Implement (parallel where independent)
- Backend: route handler (.ts) + lib + store method. Parameterized queries only. `deleted_at IS NULL` on all festival_profiles queries.
- Frontend: React component edits under `packages/web/src/` (routes, components, hooks). Keep each component under 300 lines. Shared state/logic at `packages/shared/src/` (Zustand stores, hooks, types).
- Socket.IO events if real-time. Include per-event rate limits (lib/rate-limiting.js).
- No console.log. Structured logger. Sanitize log meta.
- Strict TypeScript — no `any`. Use `AppContext` type for deps. Infer request body types from Zod schemas.
- Every async store-method call is awaited.
- Every re-thrown Error carries `{ cause }`.

Dispatch Agent tool (run_in_background: true) for independent pieces (e.g., frontend view + backend route can be parallel if the API shape is locked).

## Phase 4 -- Test
- Add tests to the appropriate file (unit / integration-<feature> / critical-paths / hardening).
- Run `npm test` (test gate). 0 failing, 0 skipped required. Any NEW failure is a regression you caused.
- P0 features: add to critical-paths.test.js.
- If touching prod code used by multiple suites: run `npm test` locally with `--test-concurrency=1` to detect cross-suite DB pollution.

## Phase 5 -- Review
Run /review or dispatch review agent. Fix CRITICAL + HIGH before shipping. Document MEDIUM/LOW in feature notes.

## Phase 6 -- Ship (paramiko deploy)
Steps: SFTP files to server -> `npm test` on server (halt on regression) -> git commit/push -> `pnpm build` (Vite 8 produces content-hashed assets in `packages/web/dist/`) -> `pm2 restart festie` -> health check -> `gh run list` for CI.
Vite hashed filenames -- no manual cache-bust needed. Vite-PWA generates sw.js + workbox precaching in dist/.

## Phase 7 -- Verify (Playwright MCP)
`mcp__playwright__browser_navigate` -> new feature's routes on iPhone SE, iPhone 14, Pixel 7, in guest AND logged-in.
`browser_snapshot` per cell. `browser_console_messages` level=error -- only expected guest 401s.
Screenshots to `.playwright-mcp/feature-<slug>/`.
Call `browser_close` when done.

## Phase 8 -- CI
Watch CI via `gh run list --limit 1` then `gh run view <id>`. Lint + test(20) + test(22) + security must all succeed before declaring done.

WRAP UP:
"Feature <name> shipped. Commit <sha>. Files: [list]. Tests added: N. CI run: <url>. Screenshots: [paths]."
```
