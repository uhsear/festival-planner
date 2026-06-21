# ADR-007: tsx No-Build TypeScript Runtime in Production

**Status:** Accepted
**Date:** 2026-06-19

## Context

After migrating the backend to TypeScript (ADR-005), a production execution strategy was needed.
The standard approach is a compile step (`tsc --outDir dist`) followed by running the emitted
JavaScript. An alternative is to run TypeScript source directly at runtime using a loader that
transpiles on the fly. The project already used `tsx` (an esbuild-backed TypeScript loader) for
development and for the test suite. Introducing a separate build step would require managing output
directories, source maps, import path rewriting, and a more complex deploy pipeline.

The backend has no dynamic `require()` calls — all imports are static — and the real-time layer is
documented as having 100x headroom over current load, making transpilation overhead a non-issue.
ADR-005's analysis explicitly noted that tsx is suitable for both dev and production on this
workload.

## Decision

The backend runs directly from TypeScript source in production via `node --import tsx/esm server.ts`
(npm scripts) and with `tsx` as the PM2 interpreter
(`interpreter: 'node_modules/.bin/tsx'` in `ecosystem.config.cjs`). There is no `dist/` directory
and no `tsc --build` step in the deploy pipeline. Type correctness is enforced separately via
`npm run typecheck` (`tsc --noEmit`) in CI without emitting files. The test suite also runs under
the same tsx loader: `node --import tsx/esm --test ...`.

## Consequences

- Deploy pipeline is simpler: `git reset --hard origin/main && pm2 restart festie` — no build
  artifact to produce or validate for the backend.
- Source maps in error traces are accurate because tsx (esbuild) provides them automatically.
- The `typecheck` script remains the type-safety gate; it is separated from execution, meaning a
  type error does not prevent the server from starting (only CI blocks a merge).
- Trade-off: tsx keeps the transpiled backend in memory; PM2 is configured with
  `max_memory_restart: '768M'` specifically to give esbuild's in-process cache sufficient headroom.
  A compiled-JS server would have a smaller RSS footprint.
- Trade-off: PM2 cluster mode (`exec_mode: 'cluster'`) is incompatible with tsx as interpreter —
  PM2 cannot fork worker processes that load a `.ts` entry point. The ecosystem config uses
  `exec_mode: 'fork'` with `instances: 1` as a direct consequence. Horizontal scaling within a
  single host therefore requires either compiling to JS or a different process supervisor.
- Trade-off: `node --import tsx/esm` and `interpreter: tsx` are two slightly different invocation
  paths; the ecosystem config comment documents that the `--import` flag form caused PM2 to SIGKILL
  the process ~3 seconds after start due to supervisor timing conflicts. Running tsx directly as
  the interpreter in fork mode is the stable path.

## Addendum (2026-06-20): build-readiness artifact

The no-build **runtime** above stays unchanged — tsx remains the dev and prod execution path, and
`ecosystem.config.cjs` / `Dockerfile` / the deploy pipeline are untouched. As a readiness step
toward the horizontal-scaling option called out in the "Consequences" above (PM2 cluster mode and
multi-instance deploys both want a compiled JS entry), an `npm run build` script now exists that
proves the backend compiles to a single runnable ESM bundle:

```
esbuild server.ts --bundle --platform=node --format=esm --target=node22 \
  --packages=external --outfile=dist/server.js --sourcemap
```

`--packages=external` keeps `node_modules` (pg, sharp, bullmq, firebase-admin, etc.) out of the
bundle and lets esbuild resolve the codebase's extensionless relative imports. `import.meta`
(`.url` / `.dirname` / `.filename`), `createRequire(import.meta.url)`, and the dynamic
`require()`s in `lib/config.ts`, `lib/sentry.ts`, `lib/swagger-ui-setup.ts`, and
`lib/notifications/send.ts` are preserved natively by the ESM target — no `__dirname` banner is
needed because the source already uses `import.meta` forms. `dist/` is gitignored.

This is a **build-readiness artifact only**: the bundle is verified with `esbuild` exit 0 plus
`node --check dist/server.js` (syntax smoke), not a full boot. The actual switch of the prod
runtime to compiled JS — including a real boot test against DB/Redis and a worker-thread path
check (the `new URL('./avatar-worker.ts', import.meta.url)` and `'../lib/export-worker.ts'` paths
in `lib/avatar-pool.ts` / `routes/export.ts` resolve next to the bundle and must be handled at
that time) — happens during the actual infra migration, not here.
