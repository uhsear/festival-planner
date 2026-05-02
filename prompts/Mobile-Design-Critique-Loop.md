# Mobile Design Critique Loop -- Claude Code Prompt

Self-improving mobile design audit for festie.us. Critiques mobile UI, patches CSS/markup, deploys, re-verifies with Playwright MCP. Loopable -- feed back to itself pass after pass.

---

## The Prompt

```
Run Mobile Design Critique Loop on Festie (festie.us). Produce real code changes and verify them visually via Playwright MCP. Do not stop at recommendations -- ship fixes.

CONSULT:
  - Context7 MCP (`mcp__claude_ai_Context7__query-docs`) for iOS HIG, Material 3, WCAG 2.2, web.dev Core Web Vitals -- pull real guidance, don't improvise.
  - Prior rounds: check git log for previous mobile-loop commits. Don't regress what's already fixed.

SSH: paramiko from main thread. Browser: Playwright MCP tools (user-scope). `mcp__playwright__browser_resize` before each device cell.

===================================================================
TEST MATRIX (each pass covers all cells; parallelize via Agent tool)
===================================================================
Devices (browser_resize + MCP device emulation):
  iPhone SE   320x568  (HARD minimum -- cannot break)
  iPhone 14   390x664
  iPhone 14 Pro Max  430x932
  Pixel 7     412x839

Personas:
  1. GUEST    -- not logged in; festie.us shows current festival behind guest banner.
  2. REGULAR  -- register fresh each loop: `qabot_<epoch36>` / `Qa!bot1234test`, accept TOS.
                After register: `.profile-badge` visible, `.admin-badge` absent.
  3. ADMIN    -- username `asir`, app password from `$FP_APP_TEST_PASS` env var.

Routes (per persona): /, /picks, /crew, /grid, /timeline, admin panel (admin only).
Plus: open a set detail card, the user menu, the festival switcher.

===================================================================
CRITIQUE AXES (score 0-3, 3 = ships)
===================================================================
A. Layout & Safe Area
   - No horizontal scroll at 320px. Nothing clipped by viewport edge.
   - Respects env(safe-area-inset-*) on notched devices.
   - Bottom nav never occluded by cookie banner, guest banner, iOS install sheet.
   - Modals/panels fit within min(90dvh, calc(100dvh - 32px)); scrollable inside.

B. Touch Targets & Centering
   - Every interactive element >= 44x44 CSS px (WCAG 2.5.5).
   - Icon-center tolerance |dx|,|dy| <= 1.0 px via absolute + translate(-50%,-50%).
   - No tap targets < 8px apart.

C. Hierarchy & Scan Speed
   - Primary action identifiable in < 1s.
   - Type scale respected; line-height >= 1.3 for body.
   - Color/weight used intentionally, not decoratively.

D. Contrast & Accessibility (WCAG 2.2 AA)
   - Text contrast >= 4.5:1 (3:1 for >= 18pt / >= 14pt bold).
   - Focus ring visible on every interactive element via keyboard tab order (browser_press_key Tab).
   - aria-label on icon-only buttons. alt on images.
   - prefers-reduced-motion honored.

E. Perceived Performance
   - LCP < 2.5s on emulated 3G (browser_evaluate -> Performance API).
   - CLS < 0.1. INP < 200ms.
   - No jank on scroll (scroll timeline in browser_evaluate, confirm > 55fps).

F. Copy & Empty States
   - Microcopy matches voice. Error messages actionable.
   - Empty states explain what to do next.

===================================================================
LOOP (max 5 passes; stop at 0 CRITICAL + 0 HIGH)
===================================================================

PASS N:

1. CAPTURE (parallel Agent dispatch)
   For each (persona, device, route) cell:
   - browser_navigate -> URL
   - browser_resize -> device dims
   - browser_take_screenshot -> `.playwright-mcp/mobile-loop-<date>/pass<N>/<persona>-<device>-<route>.png`
   - browser_snapshot -> accessibility tree
   - browser_evaluate -> axe-core wcag22aa run + perf metrics
   - browser_console_messages level=error -- must show only expected guest 401s

   Parallelize by persona via Agent with run_in_background: true. Each agent writes its report to `docs/session-logs/mobile-loop-<date>/pass<N>/<persona>.md`.

2. CRITIQUE
   Aggregate findings into:
   | ID | Route | Persona | Device | Axis | Severity | Finding | Fix |
   CRITICAL = blocks ship. HIGH = must fix this pass. MEDIUM = next pass. LOW = backlog.

3. FIX (sequential, single-thread -- shared files are serialized)
   - Tailwind utility classes in component files for layout/spacing/sizing changes.
   - Custom CSS in `packages/web/src/styles/globals.css` for anything beyond utilities.
   - Markup/component: edit the precise `packages/web/src/routes/*.tsx` or `packages/web/src/components/**/*.tsx`.
   - No console.log. No magic px -- use Tailwind spacing/sizing tokens. Touch targets via `min-h-11 min-w-11` (44px).

4. SHIP (paramiko deploy)
   - Test gate (`npm test`, 0 fails required).
   - git commit + push.
   - `pnpm build` (Vite 6 produces content-hashed assets in `packages/web/dist/` -- no manual cache-bust needed). Vite-PWA generates sw.js in dist/.
   - SFTP dist + changed files -> `pm2 restart festie`.
   - Health check.

5. VERIFY (same matrix, second pass of step 1)
   - Every CRITICAL + HIGH from this pass must be closed.
   - Any new finding from the fix = regression -> revert + re-plan.

6. NEXT PASS
   - If CRITICAL or HIGH remain, loop.
   - Else stop, write final report.

===================================================================
FINAL REPORT
===================================================================
Save to `docs/session-logs/mobile-loop-<date>/FINAL.md`:
- Pass count, total findings by severity
- Per-pass delta (fixed / new / remaining)
- Before/after screenshots for every CRITICAL + HIGH
- Commit SHAs, CI runs
- Any axis still at score < 3 with rationale for deferral

Call `mcp__playwright__browser_close` at the end.
```
