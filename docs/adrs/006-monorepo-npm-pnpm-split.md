# ADR-006: Monorepo with npm-at-root / pnpm-in-packages Split

**Status:** Accepted
**Date:** 2026-06-19

## Context

Festie is a three-surface product (backend API, React SPA, React Native mobile) that shares
significant business logic. A monorepo keeps all surfaces in a single git history, enables atomic
cross-package refactors, and lets the shared package be consumed without publishing to a registry.
The complicating factor is toolchain heterogeneity: the backend entry point is `server.ts`
(consumed directly by Node via `tsx`), while the frontend packages are built with Vite and Expo.
These two halves have different lockfile, workspace, and lifecycle requirements that make a single
package manager awkward.

pnpm workspaces (`packages/`) handle `@festie/web`, `@festie/mobile`, and `@festie/shared` using
`workspace:*` references and a single `pnpm-workspace.yaml` at the packages level. The root (`/`)
is a plain npm project: it has its own `package-lock.json`, its own `node_modules`, and is
deliberately kept off pnpm's workspace graph. This split was codified when PM2's `tsx` interpreter
requirement (`interpreter: 'node_modules/.bin/tsx'`) made it necessary for the backend to resolve
tsx from its own `node_modules` without pnpm hoisting interference.

## Decision

The root directory is managed with npm (`package.json`, `package-lock.json`, `npm install`). The
`packages/` subtree is managed with pnpm (`pnpm-workspace.yaml`, `pnpm-lock.yaml`,
`pnpm install`). The root `package.json` must never carry a `packageManager` field, as doing so
re-points npm at pnpm and breaks installs and CI. Deploy scripts install both halves explicitly:
`npm install --omit=dev` at the root, then `pnpm install --frozen-lockfile` inside `packages/`.

## Consequences

- Web and mobile can reference `@festie/shared` as `"workspace:*"` and get live TypeScript source
  with zero publish/build overhead.
- Adding a backend dependency goes through npm; adding a frontend/shared dependency goes through
  pnpm — engineers must know which tool to use and in which directory.
- CI must run both installers in the correct directories; the deploy script encodes this sequence
  explicitly.
- Trade-off: two lockfiles and two package managers increase cognitive overhead and create a novel
  failure mode (accidentally running `pnpm install` at the root, or `npm install` inside
  `packages/`, produces an inconsistent tree).
- Trade-off: `syncpack` is wired as a devDependency to catch version skew between the two lockfile
  trees, but it requires active maintenance to stay effective.
- Trade-off: the `packageManager` field prohibition is non-obvious and must be documented (it is,
  in `CLAUDE.md`) — a new contributor following standard pnpm onboarding docs would naturally add
  it and break the setup.
