# Skill Sync -- Claude Code Prompt

Audit live codebase and reconcile all skills, prompts, and memory against actual state. Run periodically or after major changes.

---

## The Prompt

```
Synchronize all Festie skills, prompts, and memory against live codebase. Skills live at .claude/skills/<name>/SKILL.md and are edited in-place via Edit tool.

SSH policy:
- Windows session: use a paramiko Python script, NOT pexpect (pexpect lacks Windows pty support).
- SSH password from $FP_SSH_PASS env var.
- Never SSH from inside a subagent. Do SSH work in the main thread; dispatch pure read/analyze tasks to agents.

GATHER from production (paramiko script from main thread):
- Metadata: package.json version, Node version, Vite hashed assets in `packages/web/dist/`, ecosystem.config.js CLUSTER_SIZE, PM2 process name (must be "festie")
- Files: root, lib/, lib/helpers/, lib/db/stores/, lib/app-context/, lib/notifications/, routes/, packages/web/src/, packages/shared/src/ with line counts (wc -l)
- Database: all tables + schemas + indexes + schema_migrations rows (use `PAGER=cat psql -d festival_planner -tA -c "SQL"`)
- Dependencies: npm ls --depth=0, npm audit --json summary
- Tests: `cd /home/asir/festival-planner && npm test` -- record pass/fail counts. Any regression -> halt and flag.
- Security: Helmet config, CORS allowlist, rate-limit table, auth middleware mounts, CSP directives
- Frontend: React 19 + TanStack Router + Zustand + Vite 8 + Tailwind CSS 4. Source at `packages/web/src/`. Shared at `packages/shared/src/`. Scan for drift.
- CI: `gh run list --limit 5` -- latest main-branch run must be success

COMPARE each skill at .claude/skills/<name>/SKILL.md against gathered state for drift:
- File names, route paths, feature inventories, config values, dependency presence.
- Do NOT introduce hardcoded version numbers, line counts, or test counts into skill bodies -- defer to live commands (`npm test`, `wc -l`, `ls migrations/`, `psql -tA`).

FIX discrepancies via the Edit tool -- surgical edits only, preserve formatting. Never rewrite a whole skill unless it's structurally wrong. Parallelize independent skill reviews by dispatching Agent calls with `run_in_background: true` (each agent reads one skill + compares against pulled-local copies -- they do NOT SSH).

PRESENT each updated skill as a bullet: `path/to/SKILL.md -- drift fixed: <one line>`. Skip unchanged skills.

SKILLS INVENTORY (22 skills in .claude/skills/):
- 21 addyosmani/agent-skills: api-and-interface-design, browser-testing-with-devtools, ci-cd-and-automation, code-review-and-quality, code-simplification, context-engineering, debugging-and-error-recovery, deprecation-and-migration, documentation-and-adrs, frontend-ui-engineering, git-workflow-and-versioning, idea-refine, incremental-implementation, performance-optimization, planning-and-task-breakdown, security-and-hardening, shipping-and-launch, source-driven-development, spec-driven-development, test-driven-development, using-agent-skills
- 1 karpathy-guidelines: behavioral guardrails (Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution)

12 slash commands: /build, /code-simplify, /diagnose, /grill-with-docs, /plan, /review, /ship, /spec, /test, /to-issues, /triage, /zoom-out
3 agent personas: code-reviewer, security-auditor, test-engineer
5 references: accessibility, orchestration, performance, security, testing

UPDATE PROMPTS: Review every file in `prompts/` (local prompt library). Fix stale references. Optimize for token usage.

UPDATE MEMORY: Read MEMORY.md and all referenced memory files. Update stale values. Add new entries for significant findings. Remove entries that no longer apply.

COMMIT + PUSH the changes via Bash (git add changed files, git commit, git push). These are tooling changes, not prod code. CI doesn't gate on .claude/.

SUMMARY:
- Total skills checked / updated / in-sync
- Prompts updated
- Memory entries updated/added/removed
- Drift causes grouped (renames, deletes, counts, config)
- Any regressions that blocked continuation
```
