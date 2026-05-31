# CLAUDE.md

Project conventions and orientation for Claude Code (and other agents) working in this repo.
For deeper detail see [`ARCHITECTURE.md`](./ARCHITECTURE.md). (Festie is proprietary; setup and
deployment guides are intentionally not part of this repository — see [`LICENSE`](./LICENSE).)

## What this is

Festie — a real-time festival crew-coordination app. Live at [festie.us](https://festie.us).

## Monorepo layout

- **`/` (root)** — Express 5 + TypeScript backend, run directly via `tsx` (no JS build step;
  entry is `server.ts`). PostgreSQL 16, Redis 7, Socket.IO 4. **Root installs with `npm`.**
- **`packages/web`** — React 19 + Vite + TanStack Router + Tailwind 4 SPA.
- **`packages/mobile`** — Expo SDK 54 + expo-router (React Native).
- **`packages/shared`** — `@festie/shared`: zustand stores, hooks, services, types, utils
  consumed by both web and mobile. **The `packages/` workspace installs with `pnpm`.**

## Commands

| Scope | Command |
|-------|---------|
| Backend dev / start | `npm run dev` / `npm start` |
| Backend tests / lint / typecheck | `npm test` / `npm run lint` / `npm run typecheck` |
| Web | `pnpm --filter @festie/web {dev,build,test,lint,typecheck}` |
| Shared | `pnpm --filter @festie/shared {test,lint}` |
| Mobile | `pnpm --filter @festie/mobile {typecheck,lint}` |

## Conventions & guardrails

- **Do NOT add a `packageManager` field to the root `package.json`.** The root is an npm project;
  only `packages/` is a pnpm workspace (see the orphaned-root-lock note in `.gitignore`).
- **Mobile may only import from its own declared deps or `@festie/shared`** — never from shared's
  transitive deps (e.g. `socket.io-client`); import shared types via `@festie/shared/...` instead,
  or CI mobile-typecheck fails with `TS2307`.
- **Business logic lives in `@festie/shared`** so web and mobile stay in parity; prefer adding to
  shared over duplicating per-app.
- **Never commit secrets.** `tests/e2e/.auth/` holds a live session cookie and is gitignored —
  keep it that way.
- Validate all API inputs with the Zod schemas in `lib/schemas.ts`.
- CI must stay green: backend tests + web/shared vitest + mobile typecheck + lint + quality.

## Branches

Production tracks the `main` branch; day-to-day work lands on `master`. Operational and deployment
detail is kept private and is not documented in this repository.
