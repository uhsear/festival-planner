# ADR-016: esbuild Bundle as the Production Backend Runtime

**Status:** Accepted
**Date:** 2026-09-09
**Supersedes:** [ADR-007](./007-tsx-no-build-production-runtime.md)

## Context

ADR-007 decided that the backend would run TypeScript source directly in production
under the `tsx` loader, with no build step. That decision held from 2026-06-19, and
it was correct for the trade-offs it weighed. Transpilation overhead is negligible on
this workload. A build step adds output directories, source maps and import
rewriting to the deploy pipeline.

It did not weigh one consequence, because the consequence arrived later. Worker
threads cannot load TypeScript. Two subsystems spawn workers by resolving a path
relative to their own module URL:

- `routes/export.ts:52-54` resolves `../lib/export-worker.ts` when its own URL ends
  in `.ts`, and `./export-worker.js` otherwise.
- `lib/avatar-pool.ts:16-17` does the same extension swap for the avatar worker.

`routes/export.ts:125-130` therefore sets `useInlineExport` and skips the pool
whenever the entry is TypeScript. Under tsx that branch was taken on every boot. The
export worker pool never existed in production, and every export ran inline on the
request thread. The guard itself was added deliberately, to stop a doomed
`new Worker()` spawn. Sentry recorded 286 of those between 2026-05-29 and
2026-08-19. The guard made exports correct, but left them single-threaded. The only
way to get the pool is a JavaScript entry point.

Two earlier attempts at the switch were made and reverted. Their causes are recorded
in `docs/runbooks/deploy.md §1.1` and in the header comment of
`ecosystem.config.cjs`.

## Decision

The backend runs the esbuild bundle in production. `ecosystem.config.cjs` sets
`script: 'dist/server.js'` and `interpreter: 'node'`. `npm run build`
(`scripts/build.mjs`) bundles three entry points: `server.ts`,
`lib/avatar-worker.ts` and `lib/export-worker.ts`. `entryNames: '[name]'` flattens
all three into `dist/`, so each worker is a sibling of `dist/server.js`. That is
where the runtime extension swap looks for it.

`npm start`, `npm run dev` and the test suite continue to run TypeScript under tsx.
`npm run typecheck` (`tsc --noEmit`) remains the type-safety gate; `tsc` still never
emits.

Two code changes were prerequisites, and both are load-bearing:

- **`server.ts:472-474` accepts `process.env.pm_exec_path`.** The boot gate
  previously matched only `process.argv[1]`. PM2 fork mode with a `node` interpreter
  runs its own `ProcessContainerFork.js` as argv[1], and passes the real entry in
  `pm_exec_path` (`pm2/lib/God/ForkMode.js:58`). The gate was therefore false, the
  whole boot block was skipped, and the process exited 0 with no log. tsx had
  escaped this only because a non-node interpreter bypasses the container.
- **`scripts/deploy/rollback.sh` rebuilds the bundle and uses delete + start.**
  See Consequences.

## Consequences

- **The export worker pool runs.** Measured OS thread counts: 11 under tsx, 13 under
  the bundle. The difference is `POOL_SIZE` in `routes/export.ts:83`,
  `Math.min(MAX_CONCURRENT_EXPORTS, 2)`, which resolves to 2. Verified on the live
  process with `ls /proc/<pid>/task | wc -l`.
- **`dist/` is gitignored and built on the host.** No committed artifact can arrive
  over git, and `git reset --hard` can neither create nor remove it. `deploy.py`
  step 4 is the only thing that produces it on the box.
- **A restart alone can boot a stale bundle.** `pm2 restart` re-execs whatever is on
  disk. Any change to backend source needs `npm run build` before the restart. Skip
  it and the restart succeeds, `/api/ready` returns 200, and the old code is still
  serving.
- **A rollback must rebuild.** Without the rebuild, `git reset --hard <tag>` restores
  source and leaves the bundle built from the release being escaped, so the rollback
  reports success and reverts nothing on the backend. `rollback.sh:68` runs
  `npm run build` before anything touches PM2, under `set -euo pipefail`, so a build
  failure aborts with the current release still serving. One limit follows: a
  rollback to a tag from before `scripts/build.mjs` existed aborts at that line
  rather than completing.
- **Changing `script` or `interpreter` needs `pm2 delete` then `pm2 start`.**
  `pm2 restart <name>` re-reads nothing and `pm2 restart <config file>` re-reads the
  `env` block only. Measured on `festie-staging` on 2026-09-09. The config file was
  reverted to `server.ts` + `tsx`, then restarted from that file. PM2 applied the new
  interpreter and kept the stored script. That left tsx interpreting the esbuild
  bundle, a runtime matching neither the config nor any release, while `/api/ready`
  still returned 200. `rollback.sh` uses delete + start because of this.
  A routine deploy still restarts by name, which is correct, because a routine deploy
  changes neither field.
- **Stack frames name the bundle.** `scripts/build.mjs` sets `sourcemap: true`, so
  `dist/server.js.map` sits beside the bundle. Nothing consumes it automatically:
  the process runs without `--enable-source-maps`, and `lib/sentry.ts` sets no
  source-map option. Resolve backend frames against the on-disk map.
- **Cluster mode is still not available, and this ADR did not change that.**
  ADR-007 named the tsx interpreter as the blocker and predicted that compiling to
  JS would unlock `exec_mode: 'cluster'`. Compiling to JS shipped; `exec_mode: 'fork'`
  with `instances: 1` stayed. The real blocker is per-process state:
  send-idempotency in `lib/email.ts` and the two in-memory limiters in
  `routes/email-auth.ts`. `ecosystem.config.cjs` records this at the `instances`
  line. ADR-011, ADR-012 and ADR-014 each used to attribute that constraint to
  ADR-007; all three were corrected alongside this record and now point at the
  per-process state instead. Their config facts always held; only the reason was
  wrong.
- **The memory ceiling is unchanged and the new figure is unmeasured.** ADR-007
  justified `max_memory_restart: '768M'` as headroom for esbuild's in-process
  transpile cache. That cache is gone, but the export workers have their own heaps,
  so the net is unknown. The ceiling was deliberately left at 768M rather than
  guessed at. Live RSS at the time of writing is about 166 MB.
