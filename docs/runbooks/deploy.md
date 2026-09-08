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
   migrations itself (see §3).
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
`ecosystem.config.cjs` has no `interpreter` line any more.

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
  *previous* `dist/` on disk and PM2 would happily boot stale code. That is why
  the build step in `deploy.py` runs its command **without** a `| tail` pipe: a
  pipeline exits with `tail`'s status, which would make the `if code != 0` gate
  dead. It is also placed *before* the web build and long before the PM2
  restart, so an abort leaves production wholly on the previous release rather
  than serving new SPA assets from an old backend.

### Why this is worth doing

`routes/export.ts` skips building its worker-thread export pool when the entry
path ends in `.ts`, because worker threads cannot load TypeScript, and falls
back to inline export. Booting from `dist/` builds the real pool, so exports
stop running on the request thread.

Be precise about the history: Sentry recorded **286 errors between 2026-05-29
and 2026-08-19** from the doomed spawn, but that was BEFORE the skip guard was
added. The guard is on `main` today and already stopped them. This change gains
the worker pool; it does not fix an error that is still firing.

### One-time cutover (do this once, by hand, when the change first ships)

`pm2 restart` re-launches the definition stored in the PM2 daemon and never
re-reads `ecosystem.config.cjs` (see the note in §2). So the *first* deploy after
this change lands will build `dist/` and then keep running `server.ts` under tsx,
and it will report success. The switch needs one manual step on the box:

```sh
ssh asir@<host>
cd /home/asir/festival-planner
npm run build                 # only if the deploy has not already built it
pm2 delete festie
pm2 start ecosystem.config.cjs
pm2 save                      # so a reboot resurrects the NEW definition
```

Then run the three confirmations below. After this one-time step, ordinary
deploys work normally: `pm2 restart` re-execs the same `dist/server.js` that
step 3 just rebuilt.

**Staging first.** `scripts/deploy/verify_staging.py` now builds the bundle too,
but the `festie-staging` PM2 app is defined **outside this repo** (this
`ecosystem.config.cjs` declares only `festie`). Point the staging definition at
`dist/server.js` by hand — with the same `pm2 delete` / `pm2 start` dance — or
staging keeps booting tsx and the boot gate stops covering the production
runtime.

### Confirming the cutover actually took effect

Run all three. The deploy's own output does **not** prove it.

```sh
# 1. PM2 is executing the bundle, not the source.
ssh asir@<host> "pm2 jlist | python3 -c \"import json,sys; p=[a for a in json.load(sys.stdin) if a['name']=='festie'][0]; print(p['pm2_env']['pm_exec_path'], p['pm2_env'].get('exec_interpreter'))\""
# expect: /home/asir/festival-planner/dist/server.js node

# 2. The TS-source fallback line is GONE from the current boot.
ssh asir@<host> "grep -c 'running from TS source' /home/asir/festival-planner/logs/pm2-out.log"
# expect: 0 new occurrences since the restart (older lines from the tsx era stay
# in the log until rotation — compare against the timestamp of the restart)

# 3. A real export succeeds through the pool.
#    In the app: run a schedule/calendar export end to end and confirm the file
#    downloads. This is the one path that changes behaviour — exports used to
#    run inline in the request and now run in worker threads.
```

Also watch `pm2 logs festie` for `ERR_MODULE_NOT_FOUND` in the first minute: a
missing bundled worker would show up there.

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
- Rolling back to a tag that predates `scripts/build.mjs` deletes `dist/`
  instead of rebuilding it, because that tag's `ecosystem.config.cjs` (tracked,
  so the reset restores it) points at `server.ts` under tsx.

### Escape hatch: back to tsx

The normal rollback already does this. Rolling back to a tag from before the
cutover restores that tag's `ecosystem.config.cjs` (it is tracked), removes or
rebuilds `dist/`, and re-starts PM2 from the restored file:

```sh
ssh asir@<host> 'cd /home/asir/festival-planner && bash scripts/deploy/rollback.sh <pre-cutover-tag>'
```

If you want to keep the current source and only change the **runtime** — the
bundle misbehaves but the code is fine — restore just the one file instead:

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

If the app is wedged (orphan process, port held), the server has helper scripts
in `~`:

- `~/restart.sh` — stop/delete the `festie` PM2 process, free port 4000, start
  fresh from `ecosystem.config`, health check, `pm2 save`.
- `~/recover.sh` — harder reset (`pm2 kill`, kill orphans, free port, restart).

Both reference the PM2 process name **`festie`** (P17 fix — they previously said
`festival-planner`, which is only the *directory* name, so the `pm2 stop/show`
commands silently no-op'd).

> Since the backend runs from `dist/`, these helpers only work if `dist/` exists
> on disk. If it is missing or stale, run `npm run build` in the app dir before
> starting PM2.

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
