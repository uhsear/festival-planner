# packages/mobile — Expo SDK 56 + expo-router (React Native)

Native app for Festie. See the root [`CLAUDE.md`](../../CLAUDE.md) for monorepo-wide rules.

## Commands

| Task | Command |
|------|---------|
| Typecheck / lint | `pnpm --filter @festie/mobile {typecheck,lint}` |

<important if="adding or changing an import">
Import only from this package's own declared deps or `@festie/shared`. Never import shared's
transitive deps (e.g. `socket.io-client`) directly — import shared types via `@festie/shared/...`,
or CI mobile-typecheck fails with `TS2307`.
</important>

## Conventions

- **Business logic lives in `@festie/shared`**, not here — keep mobile screens thin so web/mobile
  stay in parity.
- Routing is expo-router. For native UI, consult the `expo-building-native-ui` skill before
  hand-rolling components.
- Do NOT run `eas build` / `eas submit` / `eas update` without explicit sign-off (credit-capped).
