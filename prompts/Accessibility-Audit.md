# Accessibility Audit -- Claude Code Prompt

Standalone WCAG 2.2 AA audit using Playwright MCP. Run outside the Mobile Design Critique Loop when you only want a11y. See also: `.claude/references/accessibility-checklist.md` for progressive-disclosure checklist.

---

## The Prompt

```
Run WCAG 2.2 AA accessibility audit on Festie.

Browser via Playwright MCP (`mcp__playwright__browser_*`, user-scope). SSH via paramiko from main thread if needed.

STANDARD: WCAG 2.2 AA. If a skill references older WCAG, prefer 2.2 and note the gap.

SCOPE per persona x route (critical 5 routes):
  Personas: GUEST, REGULAR (register fresh: qabot_<epoch36>/Qa!bot1234test), ADMIN (asir / password from $FP_APP_TEST_PASS)
  Routes: /, /cards, /picks, /crew, /grid, /timeline, /account, /wrap, /compare, /festival-mode

PARALLEL (Agent tool, run_in_background: true):
  - Agent per persona-route matrix (each agent runs independent Playwright MCP calls and produces a per-cell report)

DO NOT parallelize:
  - fixes (sequential to avoid merge conflicts in component files)

---

## Phase 1 -- Capture (Playwright MCP)
Emulate iPhone SE 320x568 (via browser_resize), Pixel 7, desktop 1440x900. For each (persona, device, route):
- `browser_navigate` to URL
- `browser_take_screenshot` full viewport -> `.playwright-mcp/a11y-<date>/<persona>-<device>-<route>.png`
- `browser_snapshot` (accessibility tree) -- use this for action detection, not screenshots
- axe-core scan: `browser_evaluate` injects `@axe-core/playwright` and runs `axe.run({ runOnly: ['wcag22aa'] })`
- Keyboard tab order: `browser_press_key Tab` N times; count tab stops, confirm focus ring visible; confirm no traps
- Landmarks: main/nav/header/footer present (check in snapshot)
- Color contrast samples: body text, primary CTA, error states, disabled states
- aria-label presence on icon-only buttons
- alt text on all images
- prefers-reduced-motion honored -- set via `browser_evaluate` -> `window.matchMedia` spoof + verify animations disabled

## Phase 2 -- Critique
| ID | Route | Persona | WCAG SC | Severity | Finding | Fix |
|----|-------|---------|---------|----------|---------|-----|
Severity: CRITICAL (blocks ship) / HIGH / MEDIUM / LOW.

WCAG Success Criteria to check explicitly:
- 1.4.3 Contrast (Minimum) -- 4.5:1 text, 3:1 large text
- 1.4.11 Non-text Contrast -- 3:1 UI components
- 2.1.1 Keyboard -- all functions via keyboard
- 2.4.7 Focus Visible -- focus indicator always present
- 2.5.5 Target Size (Enhanced, 2.2) -- 44x44 CSS px
- 2.5.8 Target Size (Minimum, 2.2) -- 24x24 CSS px for inline
- 3.3.8 Accessible Authentication (2.2) -- no cognitive tests on auth
- 4.1.2 Name, Role, Value -- aria on custom components

## Phase 3 -- Fix
Component fixes: edit the precise React component under `packages/web/src/routes/*.tsx` or `packages/web/src/components/**/*.tsx` via Edit tool. Use Tailwind utilities for spacing/sizing adjustments. For custom CSS beyond utilities, add to `packages/web/src/styles/components.css` or `pages.css`.
Ship via paramiko SFTP (test gate -> commit -> `pnpm build` -> `pm2 restart festie` -> health). Vite produces content-hashed filenames -- no manual cache-bust needed.

## Phase 4 -- Re-verify
Re-run Phase 1 capture via Playwright MCP. Diff axe results: every CRITICAL/HIGH closed, no regressions. Any regression = revert + re-plan.

WRAP UP:
"A11y audit: <N> findings ({critical}/{high}/{med}/{low}). Fixed: M. Deferred: K. WCAG 2.2 AA: PASS/FAIL. Commit: <sha>."
Save report to `docs/session-logs/a11y/a11y-report-<date>.md` with before/after screenshots for CRITICAL + HIGH.
```
