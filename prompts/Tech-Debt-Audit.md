# Technical Debt Audit -- Claude Code Prompt

Run periodically (monthly or pre-major-feature) to surface and prioritize tech debt. Catalog-only -- no fixes. Use `Tech-Debt-Remediation.md` to act on findings.

---

## The Prompt

```
Tech debt audit on Festie. Main thread SSHes via paramiko; subagents do analysis only (no SSH).

Audit only -- catalog everything. Fix nothing. "No debt" is valid.

PARALLEL dispatch (Agent tool, run_in_background: true):
  - Agent A: npm outdated + audit + deprecated APIs (reads package.json + node_modules)
  - Agent B: complexity scan -- files > 700 lines, functions > 50 lines, duplicate logic, dead code
  - Agent C: test-gap analysis -- npm test count, c8 coverage < 60%, TODO/FIXME, 0-coverage features
  - Agent D: DB audit -- 0-row tables, EXPLAIN on hot queries, missing indexes, soft-delete gaps
  - Agent E: frontend audit -- React components at `packages/web/src/`: unused React imports, components > 300 lines, missing TypeScript types, Tailwind theme consistency (globals.css must not re-enable preflight), bundle size (`pnpm build` output), dead/unreachable components, Zustand store patterns
  - Agent F: security -- CSP gaps, rate limits, token cleanup, helmet config drift

Main thread while agents run:
  - Playwright MCP pass for a11y (touch < 44px, horizontal scroll, layout shift) at 320x568
  - psql schema inventory

Categories:
1. Dependencies (patch/minor/major, audit, deprecated, stale 12+ months)
2. Complexity (file + function size, duplication, dead code)
3. Test Gaps (count, coverage, TODO, 0-coverage features)
4. Database (unused tables, missing indexes, schema gaps, orphans)
5. Config (hardcoded values, missing env, rate limits vs scale)
6. Frontend (React component size, unused imports, missing TS types, Tailwind theme drift, bundle size, a11y)
7. Security (audit unaddressed, rate limits, CSP, token cleanup)
8. Operations (log rotation, cron, backups, monitoring, structured logging)

OUTPUT FORMAT:
Per category: | Item | Severity | Effort | Impact | Recommendation |
Severity: CRITICAL / HIGH / MEDIUM / LOW. Effort: XS / S / M / L / XL.

Save report to `docs/audits/tech-debt-YYYY-MM-DD.md`. End with:
- "Tech Debt Score: X/10" (rubric: 10 = zero HIGHs, current-minor deps, >= 80% coverage, all a11y AA)
- top 5 items by Impact/Effort ratio
- blast-radius map for anything CRITICAL
```
