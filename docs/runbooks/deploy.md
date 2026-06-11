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
2. **Run DB migrations** — `npm run db:migrate` (see §3; idempotent).
3. Build the web bundle (`pnpm --filter @festie/web build`).
4. `pm2 restart festie`.
5. **Readiness gate** — hit `/api/ready` (which checks Postgres + Redis). If it
   is **not 200**, the deploy ABORTS and prints the exact rollback command
   (P16). Cloudflare keeps routing, so a failed deploy must be rolled back fast.
6. Login smoke test (only if `FESTIE_TEST_USER`/`FESTIE_TEST_PASSWORD` are set).
7. Tag the deploy `deploy-<UTC timestamp>` and `git push` the tag (enables
   rollback — see §2).

> Note: `pm2 restart` is a hard restart and drops live Socket.IO connections for
> ~5s. Avoid deploying mid-festival when possible.

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

---

## 3. Database migrations

Migrations live in `migrations/*.sql` and are **additive + idempotent** by
convention. The runner (`scripts/migrate.mjs`, invoked via `npm run db:migrate`)
tracks applied files in a `schema_migrations(filename, applied_at)` table and
applies only un-recorded files, each in its own transaction.

It reads `DATABASE_URL` from the environment (same var the app uses).

```sh
node scripts/migrate.mjs --dry-run   # print the plan, change nothing
node scripts/migrate.mjs             # apply unapplied migrations
node scripts/migrate.mjs --baseline  # record ALL current files WITHOUT running
```

### ⚠️ First production run MUST be `--baseline`

The prod database already has all 52 migrations applied (they were run by hand
historically), but the new `schema_migrations` table starts empty — so the
runner would see every file as "pending." Although the migrations are
idempotent, the correct, auditable path is to **baseline first**:

```sh
# ON THE SERVER (or with DATABASE_URL pointed at prod), ONCE:
cd /home/asir/festival-planner
node scripts/migrate.mjs --baseline
```

This records every current file as applied **without executing any SQL**. After
baselining, only genuinely-new migrations run on subsequent deploys.

Do **not** run `--baseline` more than once, and never run a plain
`node scripts/migrate.mjs` against prod before it has been baselined.

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

`rollback.sh` resets the tree to the tag, rebuilds the web bundle, restarts
`festie`, and re-checks `/api/ready`.

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
