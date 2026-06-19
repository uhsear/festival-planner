# ADR-010: Shared Business-Logic Package (@festie/shared) Consumed by Both Web and Mobile

**Status:** Accepted
**Date:** 2026-06-19

## Context

The web SPA and mobile app (React Native / Expo) need identical state management, API
communication, real-time socket handling, domain types, and utility functions. Without a shared
package, every behavioral fix or new feature must be implemented twice and kept in sync manually.
ADR-005 identified that React Native can reuse 65–70% of the shared package (~1,900 LOC), and
that this reuse is only possible if the shared code is TypeScript (native can consume TypeScript
directly via Metro/babel-preset-expo) and avoids platform-specific globals.

Alternatives included duplicating logic per-surface, or pulling shared code from the backend
package — both rejected because they either create maintenance debt or violate the layering
boundary between API server and clients.

## Decision

`packages/shared` publishes as `@festie/shared` (private, `workspace:*`) with named subpath
exports: `@festie/shared/types`, `@festie/shared/stores`, `@festie/shared/services`,
`@festie/shared/hooks`, `@festie/shared/utils`, `@festie/shared/constants`,
`@festie/shared/tokens`, and `@festie/shared/platform`. Both `packages/web` and
`packages/mobile` declare `"@festie/shared": "workspace:*"` in their `package.json` dependencies.
The package ships its TypeScript source directly (no build step; `"main": "./src/index.ts"`).
Platform-specific behavior (e.g. `localStorage` vs `AsyncStorage`) is injected via adapters
rather than referenced as globals, so neither web nor React Native runtime crashes on import.

The package owns: Zustand stores (`festivalStore`, `authStore`, `crewStore`, `festivalModeStore`,
`uiStore`), the HTTP API client (`services/api.ts`), the Socket.IO client wrapper
(`services/socket.ts`), React hooks (`useAuth`, `useFestival`, `useCrew`, etc.), full domain type
definitions (`types/domain.ts`, `types/api.ts`, `types/socket-events.ts`), and utility/validation
functions.

## Consequences

- A bug fix in, for example, pick-conflict detection or crew state reduction is applied once and
  takes effect on both web and mobile simultaneously.
- The Socket.IO event contract (`types/socket-events.ts`) is the single source of truth shared
  between client code and backend route type annotations.
- Mobile is prohibited from importing `@festie/shared`'s transitive runtime dependencies directly
  (e.g. `socket.io-client`). It must import only from `@festie/shared/...` subpaths. This rule is
  enforced via CI mobile typecheck (`tsc --noEmit`): a direct transitive import produces `TS2307`
  (module not found in mobile's declared deps) and fails the build.
- Trade-off: the package must remain free of DOM globals (`window`, `document`, `localStorage`)
  and Node globals. Any new utility that touches platform APIs requires an injected adapter, adding
  design overhead vs. writing directly to the platform.
- Trade-off: `socket.io-client` is a runtime dependency of `@festie/shared`, meaning it is bundled
  into the mobile app even on screens that never use real-time features. Metro's tree-shaking is
  less aggressive than Vite's, so dead-code elimination cannot be assumed.
- Trade-off: `@festie/shared` ships TypeScript source without a build step; the web Vite build and
  mobile Metro bundler each transpile it independently. This means type errors in shared code
  surface at each consumer's build, not at a central shared build, which can delay discovery.
