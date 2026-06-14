# packages/shared — @festie/shared

The shared core consumed by BOTH `packages/web` and `packages/mobile`: zustand stores, hooks,
services, types, utils. See the root [`CLAUDE.md`](../../CLAUDE.md) for monorepo-wide rules.

## Commands

| Task | Command |
|------|---------|
| Test / lint | `pnpm --filter @festie/shared {test,lint}` |

<important if="adding code or a dependency here">
This package is imported by React Native (mobile) AND the web SPA. Do NOT use web-only DOM APIs
(`window`, `document`, `localStorage`) or Node-only APIs unguarded — they crash one of the two
consumers. Keep platform specifics behind injected adapters, not direct globals.
</important>

## Conventions

- This is where business logic belongs — prefer adding here over duplicating in web/mobile.
- Pure logic (utils, store reducers) should be unit-tested with Vitest; keep functions side-effect
  free where possible so both platforms can wire their own effects.
- Export types via subpaths (`@festie/shared/...`) so mobile can import them without pulling
  transitive runtime deps.
