# packages/web — React 19 + Vite + TanStack Router + Tailwind 4

SPA frontend for Festie. See the root [`CLAUDE.md`](../../CLAUDE.md) for monorepo-wide rules.

## Commands

| Task | Command |
|------|---------|
| Dev / build | `pnpm --filter @festie/web {dev,build}` |
| Test / lint / typecheck | `pnpm --filter @festie/web {test,lint,typecheck}` |

## Conventions

- **Business logic lives in `@festie/shared`** (zustand stores, hooks, services, utils). Components
  here are presentation + wiring; don't duplicate logic that web and mobile should share.
- **Dark-theme only.** No theme toggle; clear any stale `data-theme` / persisted theme preference.
- Routing is TanStack Router (file-based). Tests are Vitest + Testing Library — mock `@festie/shared`
  hooks/stores at the module boundary (see existing `*.test.tsx` for the pattern).
- Validate nothing client-side as a security boundary; the backend Zod schemas are authoritative.

## Design tokens & accent discipline

- All color/type/spacing/motion live as tokens in `src/styles/theme.css`. Use the named `type-*`
  roles and token vars — never ad-hoc `text-[Npx]` or raw hex.
- **One accent rule:** `aqua` is the single primary/selection accent. `coral` (`#ff3366`) is
  reserved for DANGER / SOS / the live exception only. Anything "selected/active" is aqua.
- **Filled coral fails AA.** Behind white/light text use `bg-accent-coral-strong` (`#c01d3a`,
  ~6:1), not `bg-accent-coral`/`bg-priority-must` (`#ff3366`, 3.55:1). Keep `#ff3366` for
  borders/glows only.
