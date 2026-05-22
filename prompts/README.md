# Festie -- Claude Code Prompts

Reusable prompt templates for multi-phase workflows in Claude Code. Paste a prompt's fenced block into a new session to kick off the flow.

## Prompt Index

| Prompt | When |
|---|---|
| `Feature-Development.md` | End-to-end feature build (critique -> design -> implement -> test -> review -> ship) |
| `DB-Migration.md` | Schema change: inspect -> plan -> write -> backfill -> ship -> verify -> rollback |
| `Debug-Sweep.md` | 6-layer sweep, single or loop mode |
| `Mobile-Design-Critique-Loop.md` | Iterative mobile UX audit with real CSS/markup patches, Playwright re-verify |
| `Accessibility-Audit.md` | Multi-persona x multi-device WCAG 2.2 AA audit |
| `Pre-Release-Smoke.md` | Full smoke test (everyday) or pre-festival go/no-go gate |
| `Skill-Sync.md` | Periodic skill/prompt/memory reconciliation against live codebase |
| `Tech-Debt-Audit.md` | Catalog debt only -- no fixes |
| `Tech-Debt-Remediation.md` | Act on audit findings in batched sprints |

## Skill Workflow

Default: `/spec` -> `/plan` -> `/build` -> `/test` -> `/review` -> `/ship`. Skip steps that don't apply. See CLAUDE.md Skills & Slash Commands table for full routing.

## Shared Conventions

**SSH**: paramiko Python scripts from main thread only (Windows-compatible; pexpect lacks pty). Password from `$FP_SSH_PASS`. Subagents cannot SSH reliably.

**Playwright MCP** (user-scope): `mcp__playwright__browser_navigate`, `browser_snapshot`, `browser_take_screenshot`, `browser_console_messages`, `browser_click`, `browser_type`, `browser_press_key`, `browser_resize`, `browser_evaluate`, `browser_close`. Screenshots to `.playwright-mcp/<flow>-<date>/`.

**Context7 MCP**: `mcp__claude_ai_Context7__query-docs` for up-to-date library docs (React 19, Vite 8, TanStack Router, Express 5, etc.).

**Code-review-graph MCP**: For token-efficient code context -- `get_review_context_tool`, `get_impact_radius_tool`, `get_architecture_overview_tool`, `detect_changes_tool`, `find_large_functions_tool`. Build/update graph with `build_or_update_graph_tool`.

**Deploy** (paramiko SFTP from main thread):
1. SFTP files to `/home/asir/festival-planner/`
2. `node --check` changed TS files (via tsx)
3. `npm test` on server (halt if fail != 0)
4. `pnpm build` in `packages/web/` (must exit 0)
5. git commit/push
6. `pm2 restart festie`
7. Health check: `curl http://127.0.0.1:4000/api/health`
8. CI watch: `gh run list --limit 1` then `gh run view <id>`

**Stack**: Node 22 + Express 5 + TypeScript + Socket.IO 4 + PostgreSQL 16 + Redis 7. React 19 + Vite 8 + TanStack Router + Zustand + Tailwind CSS 4. Monorepo: all packages use pnpm workspaces + Turborepo. Full-stack TypeScript (backend, frontend, shared). Vite produces content-hashed assets -- no manual cache-bust.

**Parallel work**: Agent tool with `run_in_background: true` for independent pieces. Sequential only for writes to shared files.

## Reports

- a11y -> `docs/session-logs/a11y/`
- mobile loop -> `docs/session-logs/mobile-loop-<date>/`
- smoke -> `docs/session-logs/smoke-<date>/`
- tech-debt -> `docs/audits/tech-debt-<date>.md`
- full review -> `docs/audits/full-review-<date>.md`
- CI logs -> `docs/session-logs/ci_watch.log`

## Retired

**Full-Project-Review-Loop** -- retired. Its functionality is covered by combining Debug-Sweep (layers 1-6) + Tech-Debt-Audit (catalog) + `/review` (code quality). For code-review-graph context loading, use the MCP tools directly (see conventions above).
