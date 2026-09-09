# Deploy Runbook

Operational runbook for deploying Festie's backend + web bundle to the single
production box, plus rollback, database migrations, and the Android
`VERSION_CODE_OFFSET` lookup.

> Festie is proprietary. This runbook documents *procedure* only — no secrets.
> All credentials come from the environment; nothing sensitive is committed.

---

## 0. Prerequisites (one-time, local)

The deploy/verify scripts use **SSH key auth only** — there is no password path.

- A working SSH key that authenticates to the prod user (verify with
  `ssh asir@<host> 'echo ok'`). The key may live in your SSH agent / default
  `~/.ssh` identities, or be pointed at explicitly via `FESTIE_SSH_KEY`.
- Python with `paramiko` installed (`pip install paramiko`).

### Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `FESTIE_SSH_HOST` | `192.168.0.150` | prod host/IP |
| `FESTIE_SSH_USER` | `asir` | prod SSH user |
| `FESTIE_SSH_KEY` | *(agent / default keys)* | explicit private-key file (optional) |
| `FESTIE_APP_DIR` | `/home/asir/festival-planner` | app directory on the server |
| `FESTIE_PM2_NAME` | `festie` | PM2 process name |
| `FESTIE_READY_URL` | `http://localhost:4000/api/ready` | readiness probe |
| `FESTIE_LOGIN_URL` | `http://localhost:4000/api/v1/auth/login` | login smoke endpoint |
| `FESTIE_TEST_USER` | *(unset → login check skipped)* | smoke-login username |
| `FESTIE_TEST_PASSWORD` | *(unset)* | smoke-login password |

Keep secrets out of the repo. Use a local, **gitignored** `.env.deploy` or your
shell — never commit them.

---

## 1. Deploy

```sh
python scripts/deploy/deploy.py
```

What it does, in order:

1. SSH (key auth) → `git fetch --tags` + `git reset --hard origin/main`.
2. Install dependencies (`npm install --omit=dev` at the root, `pnpm install
   --frozen-lockfile` in `packages/`).
3. **Bundle the backend** (`npm run build` → `scripts/build.mjs`). See §1.1.
4. Build the web bundle (`pnpm --filter @festie/web build`).
5. `pm2 restart festie` — re-execs the backend; on boot it applies any pending
   migrations itself (see §3). Restarting by NAME is correct here only because a
   normal deploy changes neither `script` nor `interpreter`; it re-execs the
   `dist/server.js` that step 3 just rebuilt. If either of those changes, this
   step silently does nothing — see the blockquote in §2.
6. **Readiness gate** — hit `/api/ready` (which checks Postgres + Redis). If it
   is **not 200**, the deploy ABORTS and prints the exact rollback command
   (P16). Cloudflare keeps routing, so a failed deploy must be rolled back fast.
7. Login smoke test (only if `FESTIE_TEST_USER`/`FESTIE_TEST_PASSWORD` are set).
8. Tag the deploy `deploy-<UTC timestamp>` and `git push` the tag (enables
   rollback — see §4).

> Note: `pm2 restart` is a hard restart and drops live Socket.IO connections for
> ~5s. Avoid deploying mid-festival when possible.

---

## 1.1 The backend bundle (dist/)

PM2 runs **`dist/server.js` under plain node**, not `server.ts` under tsx.
`ecosystem.config.cjs` still has an `interpreter` line; its value is now `'node'`,
on the line directly after `script: 'dist/server.js'`. Do not "fix" the config by
deleting that line.

`npm run build` (esbuild, via `scripts/build.mjs`) emits three files:
`dist/server.js`, `dist/avatar-worker.js`, `dist/export-worker.js`. The workers
must sit next to `dist/server.js`, because the runtime resolves them as siblings
of the server entry.

Three facts that decide how the deploy is shaped:

- **`dist/` is gitignored.** The deploy ships via git, so no committed artifact
  can ever arrive. The build step in `deploy.py` is the only thing that creates
  `dist/` on the box.
- **`esbuild` is a runtime `dependency`, not a devDependency.** `deploy.py`
  installs with `--omit=dev`; if esbuild ever moves back to devDependencies the
  host build fails.
- **A failed build does not fail quietly enough on its own.** `git reset --hard`
  cannot delete a gitignored directory, so a build that fails leaves the
  *previous* `dist/` on disk and PM2 would happily boot stale code. The build step
  in `deploy.py` does pipe to `| tail -5`. A pipeline normally exits with `tail`'s
  status, which would make the `if code != 0` gate dead. `set -o pipefail`, at the
  front of that same command, is what keeps the gate alive. Never remove the
  `pipefail`. Never add a pipe to a gated command without it. The step also runs
  *before* the web build, and long before the PM2 restart. An abort therefore leaves
  production wholly on the previous release, rather than serving new SPA assets from
  an old backend.

### Why this is worth doing

`routes/export.ts` skips building its worker-thread export pool when the entry
path ends in `.ts`, because worker threads cannot load TypeScript, and falls
back to inline export. Booting from `dist/` builds the real pool, so exports
stop running on the request thread.

Be precise about the history: Sentry recorded **286 errors between 2026-05-29
and 2026-08-19** from the doomed spawn, but that was BEFORE the skip guard was
added. The guard is on `main` today and already stopped them. This change gains
the worker pool; it does not fix an error that is still firing.

### The cutover shipped (a8e93533, 2026-09-09)

Production runs the bundle. Do not revert it, and do not run a cutover step — there
is nothing left to cut over. Confirmed on the box on 2026-09-09:

- `pm2 jlist` reports `festie` with `pm_exec_path` `<app dir>/dist/server.js`,
  `exec_interpreter` `node`, `fork_mode`, 1 instance, status `online`.
- `/proc/<pid>/cmdline` is `node <app dir>/dist/server.js`.
- `festie-staging` runs its own `dist/server.js` under `node` as well, so staging
  covers the production runtime.

> **Staging's PM2 definition lives outside this repository.** This
> `ecosystem.config.cjs` declares only `festie`; the staging app is defined in
> its own checkout. So a change to `script` or `interpreter` here does NOT reach
> staging — mirror it by hand, or staging silently stops rehearsing what
> production actually runs. `scripts/deploy/verify_staging.py` builds only the
> web bundle and restarts by name; it never runs `npm run build`, so it will not
> produce a backend bundle for you either. Its `running from TS source` check
> would catch the drift, but only after the fact.

**What it bought.** The export worker pool now runs. `routes/export.ts:52-54`
resolves its worker relative to its own module URL. `:125-130` then skips the pool
and sets `useInlineExport` whenever that URL ends in `.ts`, because a worker thread
cannot load TypeScript. Under tsx that branch was always taken. Every export ran
inline on the request thread. Measured thread counts: 11 OS threads under tsx, 13
under the bundle. The difference is `POOL_SIZE` at `routes/export.ts:83`, which is
`Math.min(MAX_CONCURRENT_EXPORTS, 2)` and resolves to 2. The live process shows 13
(`ls /proc/<pid>/task | wc -l`).

**Two defects had to be fixed first.** Both are worth knowing, because both failed
silently and both would recur in a similar move.

1. **The boot gate (fixed in 8e0d6e91).** `server.ts` gated its entire boot on
   `import.meta.filename === process.argv[1] || process.argv[1]?.endsWith('server.ts')`.
   PM2 fork mode with a `node` interpreter launches its own `ProcessContainerFork.js`
   as argv[1] and passes the real entry in the `pm_exec_path` env var
   (`pm2/lib/God/ForkMode.js:58`). Neither clause matched the bundle, so the block
   holding app creation, listen and the readiness signal was skipped. The module body
   still ran, which is why only the Sentry line appeared; the event loop then drained
   and node exited 0 with no application log. PM2 restarted it and it looped. The
   roughly three-second delay was `@pm2/io` telemetry handles keeping an idle loop
   alive, not a timeout.

   tsx escaped the gate because a non-node interpreter bypasses the container. That
   leaves argv[1] as `server.ts`, which matched the third clause — a clause
   structurally incapable of matching a built `server.js`. `server.ts:472-474` now
   also accepts `process.env.pm_exec_path`. PM2 alone sets that variable, so the new
   clause is inert under `node dist/server.js` and under the test suite.

   Two corrections to earlier entries in this runbook. The first claimed the failure
   was `ERR_REQUIRE_ASYNC_MODULE` from PM2's container calling `require()`.
   `ProcessContainerFork.js:29` checks `isESModule(pm_exec_path)` and uses `import()`
   for an ES module; the CommonJS branch was never taken. The CommonJS entry shim
   built on that reasoning fixed a problem PM2 did not have. The second pointed at the
   pino transport and stdout piping as the place to look next. It was not that either.

2. **Rollback could not roll it back (fixed in 268f5f8f).** See §4.

**The operational consequence: a source change needs a rebuild, not just a restart.**
`dist/` is gitignored. No committed artifact can ever arrive over git, and no
`git reset --hard` can remove or update it. `pm2 restart festie` re-execs whatever
bundle is on disk. Before you restart, run `npm run build` for any change to backend
source — a deploy, a rollback, a hotfix, a one-line edit on the box. If you skip it,
the restart succeeds, `/api/ready` returns 200, and the old code is still serving.

### Confirming what is actually running

Run these after any deploy, rollback or restart. The deploy's own output and the
readiness probe both pass while the wrong thing is running, so neither is proof.

```sh
# 1. PM2 is executing the bundle, not the source.
ssh asir@<host> "pm2 jlist | python3 -c \"import json,sys; p=[a for a in json.load(sys.stdin) if a['name']=='festie'][0]; print(p['pm2_env']['pm_exec_path'], p['pm2_env'].get('exec_interpreter'))\""
# expect: /home/asir/festival-planner/dist/server.js node

# 2. The bundle on disk is newer than the commit you deployed.
#    Print both timestamps; a bundle older than HEAD means the build did not run.
ssh asir@<host> 'cd /home/asir/festival-planner && ls -l --time-style=long-iso dist/server.js && git log -1 --format="%h %ad %s" --date=iso'

# 3. The export pool is up: thread count is 13, not 11.
#    Take the pid from PM2, NOT from pgrep. Two processes match
#    "node .*dist/server.js" on this host — festie and festie-staging — and
#    `pgrep | head -1` returns the lower pid, which is usually staging. Both
#    read 13 today, so that mistake reports a correct-looking number for the
#    wrong process.
ssh asir@<host> 'ls /proc/$(pm2 jlist | python3 -c "import json,sys; print([a for a in json.load(sys.stdin) if a[\"name\"]==\"festie\"][0][\"pid\"])")/task | wc -l'
```

Check 3 replaces an older check that grepped the log for `export: running from TS
source`. That line is the tsx-era marker, and it is written **once at boot**. A
`grep -c` over `logs/pm2-out.log` therefore still returns 1 from a pre-cutover boot,
until the log rotates. A non-zero count is not a failure. Compare any hit's
timestamp against the current restart time, or use the thread count instead.

Also watch `pm2 logs festie` for `ERR_MODULE_NOT_FOUND` in the first minute. A
missing bundled worker shows up there.

---

## 2. Verify (read-only)

Run after a deploy, or any time, to confirm prod health without changing
anything:

```sh
python scripts/deploy/verify.py
```

Checks: PM2 online, `/api/ready` == 200, login == 200 (if creds set), and that
the served `index` references a fresh asset bundle hash. Exits non-zero on any
failure.

> **`pm2 restart <name>` never re-reads `ecosystem.config.cjs`.** It re-launches
> the definition already stored in the PM2 daemon, merging only environment
> variables (verified in the installed pm2 6.0.14: `lib/API.js` routes a bare
> name to `_operate('restartProcessId', ...)`, and `lib/God/ActionMethods.js`
> `restartProcessId` reuses the stored `pm2_env`). So any change to `script`,
> `interpreter`, `node_args` or `max_memory_restart` needs a
> `pm2 delete festie && pm2 start ecosystem.config.cjs && pm2 save` — a normal
> deploy will not apply it, and will look successful anyway. Confirm with
> `pm2 jlist`, never with the deploy output.

---

## 3. Database migrations (app-managed)

Migrations live in `migrations/*.sql` and are **additive + idempotent** by
convention. They are applied by the **application itself**, not by a separate
deploy step: `lib/planner-db-pg.ts` owns a version-keyed `schema_migrations`
ledger and, once per Postgres URL per process boot, applies any file that isn't
already recorded (each in its own transaction) and logs a drift WARN if the
on-disk file count exceeds the ledger.

That means the `pm2 restart` in step 5 of the deploy is also what runs pending
migrations — there is nothing to invoke by hand. To add a migration: drop a new
`migrations/NNN_name.sql` file, deploy, and the next boot applies it.

To inspect the ledger read-only:

```sh
# ON THE SERVER, with DATABASE_URL from the app .env:
psql "$DATABASE_URL" -c 'SELECT version, name, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 10;'
```

> Do NOT add a second, independent migration runner — it will double-run and
> collide with the app's ledger (this is why an earlier `scripts/migrate.mjs`
> experiment was removed: it used a `filename`-keyed table incompatible with the
> app's `version`-keyed one).

---

## 4. Rollback

Each successful deploy pushes a `deploy-<UTC timestamp>` tag. To roll back, pick
the last known-good tag and run the server-side rollback script **on the box**:

```sh
# List available deploy tags:
ssh asir@<host> 'cd /home/asir/festival-planner && git tag -l "deploy-*" | sort'

# Roll back to a chosen tag:
ssh asir@<host> 'cd /home/asir/festival-planner && bash scripts/deploy/rollback.sh deploy-20260611-180000'
```

`rollback.sh` resets the tree to the tag, **rebuilds the backend bundle**,
rebuilds the web bundle, restarts `festie` with
`pm2 delete && pm2 start ecosystem.config.cjs`, and re-checks `/api/ready`.

Both of those are load-bearing since the move to `dist/`:

- `git reset --hard` cannot touch the gitignored `dist/`, so without the backend
  rebuild a rollback would restart the *same* bundle built from the code you are
  rolling back **from**, print `[rollback] done`, report `/api/ready` 200, and
  have reverted nothing on the backend.
- `pm2 restart` would keep the daemon's stored `script`/`interpreter`, so a
  rollback to a tag from before the cutover would not return to tsx.
- Both rebuilds run **before** anything touches PM2 (`rollback.sh:67-77`, PM2 at
  `:86`). The script is `set -euo pipefail`, so a build failure aborts with the
  current release still serving. That is better than stopping the app and then
  finding it cannot start.

> **`rollback.sh` cannot reach a tag from before `scripts/build.mjs` existed.**
> Line 68 runs `npm run build` unconditionally after the reset. On a tag whose
> `package.json` has no `build` script, that call exits non-zero and `set -e`
> aborts the rollback at that line — before `pm2 delete` at line 86. Nothing is
> deleted and nothing is restarted; production stays on the release you were
> trying to leave, and the script prints a failure. To reach such a tag, use the
> manual runtime restore below and pick the source separately.

### Escape hatch: back to tsx

**Use `rollback.sh` first.** It does reach every deploy tag you are realistically
rolling back to. `scripts/build.mjs` has existed since 2026-06-20, well before
the cutover, so any recent tag carries it and a `build` script — checked against
the three newest, which all do. On those, `npm run build` succeeds and the
delete-and-start at the end applies that tag's restored `ecosystem.config.cjs`,
including its `script` and `interpreter`. That is the automated path back to tsx.

The manual restore below is for the two cases the script does not cover: a tag
old enough to predate `scripts/build.mjs` (see the warning above), and a bundle
that misbehaves while the source is fine, where you want the runtime changed
without moving the working tree at all.

Restore the one file that defines the runtime:

```sh
cd /home/asir/festival-planner \
  && git checkout <pre-cutover-tag> -- ecosystem.config.cjs \
  && rm -rf dist \
  && pm2 delete festie \
  && pm2 start ecosystem.config.cjs \
  && pm2 save
```

Verify you are actually back: `pm2 jlist` must show `pm_exec_path` ending in
`server.ts` with the interpreter `node_modules/.bin/tsx`, `/api/ready` must be
200, and the log must contain `export: running from TS source` again — that line
is the positive proof you are on the tsx path. The cost of being there is that
exports run inline on the request thread instead of on the worker pool. That is
a throughput cost under concurrent exports, not an outage, and not the return of
the 286-error class — the skip guard prevents that spawn either way.

> **Migrations are NOT auto-rolled-back.** Festie migrations are additive +
> idempotent, so a rolled-back app runs fine against a forward schema. If a
> deploy shipped a *destructive* migration, restore from backup
> (`scripts/backup-pg.sh` dumps; restore with `pg_restore`) — do not rely on the
> rollback script for schema reversal.

---

## 5. Emergency restart / recovery (on the box)

> **`~/restart.sh` and `~/recover.sh` were repaired on 2026-09-09 and now live in
> `scripts/ops/`**, with the home-directory paths as symlinks so they are covered
> by a repository-wide search. Both had ended in a `pm2 start` naming the config
> file with a `.js` extension when the file on disk is `.cjs`, and their
> `pkill -9 -f "node server.js"` step matched nothing, because the live command
> line ends in `dist/server.js`.
>
> `restart.sh` was the more dangerous of the two. It had no `set -e`, so it
> deleted the app, failed to start it, and then ran `pm2 save`, persisting a
> process list without `festie` and destroying the definition a `pm2 resurrect`
> would restore. It now saves only when the app reports `online`. `recover.sh`
> ran `pm2 kill` under `set -e` and aborted before starting anything; it now
> resurrects the other apps and fails loudly if health is not 200. Both check
> that `dist/server.js` exists before stopping anything, since `dist/` is
> gitignored and built on the host.

`restart.sh` covers the wedged case (orphan process, port held). To do it by hand:

```sh
cd /home/asir/festival-planner
npm run build                      # dist/ is gitignored; never skip this
pm2 delete festie                  # delete, not restart - see the note in §2
pm2 start ecosystem.config.cjs
pm2 save                           # so a reboot resurrects this definition
curl -sf http://127.0.0.1:4000/api/ready && echo ok
```

If port 4000 is still held after the delete, find the holder with
`fuser -v 4000/tcp`. Kill it by PID before you start.

Then confirm what is running, with §1.1's three checks. `/api/ready` returning 200
does not tell you the process is on the right script or the right bundle.

### If a production operation is refused

Some tooling on this host blocks state-changing operations against `festie` —
process-manager commands, edits to the process definition, and the deploy
scripts — so they cannot happen by accident or from a background agent.
Read-only inspection is always allowed, and `festie-staging` is never blocked.

That tooling is machine-local and is not part of this repository, so it is
documented where it lives rather than here. If an operation is refused, the
refusal message names the command that lifts the block. A human at a plain shell
is not affected by any of it.

---

## 6. Android `VERSION_CODE_OFFSET` lookup (P18)

The `android-release.yml` workflow derives the Android `versionCode` as
`VERSION_CODE_OFFSET + github.run_number`. Android requires every uploaded AAB
to have a **strictly increasing** integer `versionCode`. The offset must be set
so our codes stay above the last EAS-published code.

Checklist when (re)setting `VERSION_CODE_OFFSET` in `android-release.yml`:

1. Open **Google Play Console** → Festie app.
2. Go to **Release → Production** (or **Internal testing**) →
   **App bundle explorer**.
3. Read the **highest published `versionCode`** (call it `N`).
4. Set `VERSION_CODE_OFFSET` to **`N + 100`** in `.github/workflows/android-release.yml`.
   - Rationale: `github.run_number` is small and unrelated to `N`; the `+100`
     headroom guarantees the very first GH-Actions build exceeds `N` and every
     subsequent run increments monotonically.
   - Example: last published `versionCode` is `42` → set `VERSION_CODE_OFFSET: '142'`.
5. After the build, confirm in the workflow log (`Set versionCode` step) that the
   computed code is strictly greater than `N`.

> If a build is ever rejected by Play for a duplicate/too-low `versionCode`,
> re-run this lookup — the offset has fallen behind the published max.
