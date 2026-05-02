# Technical Debt Remediation -- Claude Code Prompt

Act on findings from `Tech-Debt-Audit.md`. Fixes debt in batches via parallel agents -> staging -> test gate -> deploy -> CI watch. Pattern from the 2026-04-14 sprint series.

---

## The Prompt

```
Remediate tech debt using docs/audits/tech-debt-<DATE>.md as input. Work top-down by severity (CRITICAL -> HIGH -> MEDIUM -> LOW). Use as many agents as possible but smart (independent work only).

PREP (main thread):
  - Pull files referenced in audit to `docs/session-logs/sprint-<N>-pull/` via paramiko.
  - Create `docs/session-logs/fixes/staging-v<N>/` with target subdirs.
  - Never SSH from subagents.

PARALLEL AGENTS (Agent tool, run_in_background: true):
  For each independent item (file split, test rewrite, config refactor), dispatch one agent with:
    - explicit file paths (pulled-local copies)
    - hard constraints (no public API changes; keep existing tests passing)
    - output path under staging-v<N>/<subdir>/
    - 250-word max report + surface any surprises

DO IN-THREAD (cannot safely parallelize):
  - DB migration edits
  - package.json scripts list surgery
  - commit/push + CI watch
  - Playwright smoke-test via MCP

DEPLOY (paramiko SFTP from main thread):
  1. SFTP all changed files to server.
  2. `node --check` every changed JS file.
  3. `cd /home/asir/festival-planner && npm test 2>&1` (900s timeout). Parse `# tests/# pass/# fail`. If fail != 0: halt -- no commit.
  4. `cd packages/web && pnpm build` (must exit 0 -- TypeScript/Vite errors block deploy).
  5. git add changed files, commit with descriptive message, push.
  6. `pm2 restart festie`.
  7. Health check: curl http://127.0.0.1:4000/api/health (expect 200 < 100ms).
  8. `gh run list --limit 2` to watch CI.

CI WATCH:
  - `gh run view <id> --json status,conclusion` -- check until completed.
  - If lint/test fails: `gh run view <id> --log-failed`, surface root cause.

COMMON REGRESSIONS (from 2026-04-14 sprints):
  - Permissions: check .claude/settings.json has appropriate tool allowlist configured.
  - CI lint rule `preserve-caught-error`: every re-thrown Error needs `{ cause: origErr }`.
  - audit_log target_type NOT NULL: default to 'unknown' in lib/db/stores/audit.js.
  - Retired migration 014: migration 023 must `ADD COLUMN IF NOT EXISTS` before `ALTER COLUMN` on fresh CI DBs.
  - Migration runner (lib/planner-db-pg.js): skip when NODE_ENV=test or DB URL matches /_test(\?|$)/ to avoid re-applying into the test harness schema.
  - Test DB pollution: each integration suite must run `truncateAllTables()` + its own `ensureTestSchema()` so cross-suite state doesn't leak.
  - Zustand store not re-fetching after auth state changes: stores that cache user-scoped data must subscribe to auth state and invalidate on login/logout.
  - Tailwind preflight re-enabled: must stay disabled -- `globals.css` imports only `theme.css` + `utilities.css`. If preflight is on, component styles break.
  - `pnpm build` must succeed before deploy: TypeScript errors block the Vite build. Never skip the build step.
  - Vite proxy config (`vite.config.ts`): Origin header rewrite required for CSRF, cookie Secure flag must be stripped for local dev. Do not remove proxy rewrites without verifying CSRF + auth still work.

AFTER DEPLOY + CI GREEN:
  - Update docs/audits/tech-debt-<DATE>-SPRINT<N>-COMPLETE.md: scorecard delta, commit SHAs, deferred items with reasons.
  - Memory: add any new pattern learned (file paths, trap fixes) to memory/.

SUMMARY:
- Items closed this sprint + severity mix
- Items deferred with rationale
- Commit SHAs + CI run URL
- Tech Debt Score delta
```
