# Process Improvement Audit — Festie

Date: 2026-06-11
Scope: solo-dev engineering process audit. INVENTORY (verified against repo) crossed against RESEARCH (best practice, sourced). Goal: every actionable win, including small ones.
Verification: ci.yml, ecosystem.config.cjs, packages/mobile/app.json, package.json, and the workflows directory were read directly. Where INVENTORY and the committed file disagree, the committed file wins and is flagged.

---

## 1. Per-process current state

**CI/CD.** Single `ci.yml` fires on push + PR to `main`/`develop`/`master` with 10+ jobs on `ubuntu-latest`. All actions are SHA-pinned, `permissions: contents: read` everywhere, Node-24 action runtime forced ahead of GitHub's 2026-06-16 migration — genuinely hardened. **[Updated 2026-06-13]** Concurrency groups (P1), `timeout-minutes` on every job (P4), a shared `.github/actions/pnpm-setup` composite action (P6), `dorny/paths-filter` path gating for web/mobile/docs (P8), `frontend-tests` and `mobile-typecheck` CI jobs, and `npm audit` moved to advisory + a dedicated `security-audit.yml` cron (P2) have all shipped. Remaining open: the web build still runs in `test`, `lighthouse`, and `bundle-size` separately without artifact sharing (P5); branch protection may still list a ghost `test (20)` check (P3); pnpm store cache not yet extracted to all jobs that need it.

**Release / OTA.** No root `eas.json` (verified) — release config lives entirely in `app.json` + workflow files. `runtimeVersion.policy = appVersion` (fingerprint tried and reverted). OTA (`mobile-ota.yml`), Android native (`android-release.yml`), and the build-vs-OTA `mobile-release-gate.yml` are all `workflow_dispatch`-only; the gate is advisory and has only ever run on a feature branch. No iOS CI build path. Backend/web deploy is an **uncommitted** `%TEMP%/festie-deploy.py` paramiko script with **plaintext SSH and prod-login credentials baked in**; it does `git reset --hard origin/main` + web build on the server + `pm2 restart` (hard, ~5s drop of all Socket.IO connections). No migration step, no rollback script, no git-tag-per-deploy, no staging.

**Testing.** Strong unit/integration backend coverage (94 node:test files, c8-enforced 80% lines / 60% branches — the only hard coverage gate). Web (72 files) and shared (37 files) vitest now run in CI via the `frontend-tests` job (shipped post-audit). **[Updated 2026-06-13]** Playwright E2E is wired into a nightly `e2e-web.yml` workflow (P10 resolved). The stale Expo-Go Maestro flows targeting SDK 54 have been removed (P19 resolved); canonical flows live in `.maestro/`. iOS E2E (`ios-e2e.yml`) was implemented as a free macOS-runner Maestro job and is now green (historical "100% failing" status no longer applies). Mobile has zero unit tests. No JUnit trend tracking.

**Ops.** Single Linux box (192.168.0.150) runs Postgres 16, Redis 7, the Node app (PM2 fork, 1 instance), and the Cloudflare tunnel — single point of failure. `pm2-logrotate` active, `error-rate-alert.cjs` + a self-deprecated `health-monitor.js` both on 5-min cron. **No external uptime monitoring.** Sentry is a conditional no-op wrapper (install status unconfirmed). Redis is RDB-only (AOF off). The INVENTORY contains a critical conflict: the RELEASE section shows fresh 6-hourly backups through Jun 11, while the OPS section reports backups frozen since May 2 with a path mismatch (`backups/festie` vs `backups/festival-planner`) — this discrepancy alone is the #1 thing to physically verify on the box.

**Dev-loop.** Monorepo split (npm root, pnpm `packages/`) is correct and documented per project conventions — do not "fix" it. No husky/lint-staged pre-commit hooks; ~~no shared `tsconfig.base.json`~~ (a root `tsconfig.base.json` now exists — P32 resolved); no shared eslint-config package; path-filtered builds via `dorny/paths-filter` now in CI (P8/P33 resolved). Windows dev box, Linux prod — env drift risk is real.

---

## 2. Improvements by process

### CI/CD

**P1 — Add concurrency groups with cancel-in-progress.** *What:* cancel superseded runs per branch. *Evidence:* "No concurrency groups are defined anywhere" — confirmed, `ci.yml` has none. *Effort:* S. *Impact:* high. *First step:* add to top of `ci.yml`:
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```
**[RESOLVED]** Concurrency groups shipped; `ci.yml` top-level block confirmed present.

**P2 — Move `npm audit` out of the blocking push path onto a cron + make it non-fatal.** *What:* split security audit into a scheduled workflow; in `ci.yml` make the step advisory. *Evidence:* `ci.yml` line 179 `- run: npm audit --audit-level=high` hard-fails the job; it has failed 10+ consecutive runs on @grpc/grpc-js and is not a required check, so it only produces alert fatigue. *Effort:* S. *Impact:* high. *First step:* change line 179 to `run: npm audit --audit-level=high || true`, and add a new `security-audit.yml` with `on: { schedule: [{cron: '0 6 * * *'}], workflow_dispatch: {} }`.
**[RESOLVED]** `npm audit` in `ci.yml` is now advisory (`|| echo "::warning::..."`); a dedicated `security-audit.yml` cron handles the blocking check.

**P3 — Remove the ghost `test (20)` required check.** *What:* drop `test (20)` from branch-protection required contexts. *Evidence:* matrix is `node-version: [22]` (ci.yml line 60) — `test (20)` never runs, so required checks are permanently unsatisfiable except by admin bypass. *Effort:* S. *Impact:* med. *First step:* `gh api -X PATCH repos/uhsear/festival-planner/branches/main/protection/required_status_checks -f 'contexts[]=lint' -f 'contexts[]=test (22)' -f 'contexts[]=quality'` (drop the `(20)` context). Add `security` only after P2.

**P4 — Add `timeout-minutes` to every `ci.yml` job.** *What:* cap runaway jobs. *Evidence:* only android/ios-e2e set timeouts; `test` ran 17.5 min and would hold a runner for GitHub's 6-hour default if it hung. *Effort:* S. *Impact:* med. *First step:* add `timeout-minutes: 30` under each job (10 for the fast ones).
**[RESOLVED]** Every job in `ci.yml` now has `timeout-minutes`.

**P5 — Build the web bundle once, share via artifact.** *What:* upload `packages/web/dist` from `test`, download in `lighthouse` + `bundle-size`. *Evidence:* `pnpm --filter @festie/web build` appears 3× (lines 100, 252, 273). *Effort:* M. *Impact:* med. *First step:* in `test`, `actions/upload-artifact` the `dist/`; replace the build steps in the other two jobs with `download-artifact`.

**P6 — Cache the pnpm store in all pnpm jobs.** *What:* lift the `quality`-job pnpm-store cache pattern into `lint`/`frontend-tests`/`mobile-typecheck`/`bundle-size`/`lighthouse`. *Evidence:* "pnpm store cache is only used in the quality job" — confirmed (cache block only at lines 209-214). *Effort:* M. *Impact:* med. *First step:* extract the store-path + `actions/cache@v4` steps into a tiny composite action under `.github/actions/pnpm-setup` and reuse.
**[RESOLVED]** Shared `.github/actions/pnpm-setup` composite action created and used across `lint`, `frontend-tests`, `mobile-typecheck`, and other pnpm jobs.

**P7 — Add `cache: 'npm'` to setup-node in jobs running `npm ci`.** *What:* npm cache in `quality` (runs `npm ci` at line 218) and any other. *Evidence:* only `lint`/`test`/`security` set `cache: 'npm'`. *Effort:* S. *Impact:* low. *First step:* add `cache: 'npm'` to the `setup-node` in `quality`.

**P8 — Path-filter jobs so docs-only / backend-only pushes skip irrelevant work.** *What:* `dorny/paths-filter` to gate `lighthouse`, `bundle-size`, `frontend-tests`, `mobile-typecheck`. *Evidence:* "No path-filter on any job"; a backend-only push triggers a full ~166s Lighthouse run. *Effort:* M. *Impact:* med. *First step:* add a `changes` job using `dorny/paths-filter@v3` with `web`/`mobile`/`backend`/`docs` filters; `needs: changes` + `if` on the dependent jobs.
**[RESOLVED]** `changes` job using `dorny/paths-filter@v3` with `web`/`mobile`/`backend`/`docs` filters is present in `ci.yml`; dependent jobs gate on outputs.

**P9 — Pin the semgrep version in `quality`.** *What:* `pipx run semgrep==<ver>` instead of unpinned. *Evidence:* `pipx run semgrep` (line 232) downloads latest each run — non-deterministic + slower. *Effort:* S. *Impact:* low. *First step:* pin e.g. `pipx run semgrep==1.XX.X scan ...`.

**P10 — Wire Playwright E2E into CI as a non-blocking nightly.** *What:* a scheduled job running `npm run test:e2e` against a CI-spun server. *Evidence:* "Playwright E2E does NOT run in CI" — confirmed; `test:e2e`/`test:all` exist in package.json but are referenced by no workflow. *Effort:* L. *Impact:* med. *First step:* new `e2e-web.yml`, `schedule` nightly + `workflow_dispatch`, reuse the `test` job's postgres/redis services; first delete the dead `importLegacyJsonToSqlite` import in `fixtures.ts`.
**[RESOLVED]** `.github/workflows/e2e-web.yml` exists with nightly schedule + `workflow_dispatch`.

**P11 — Protect `master`.** *What:* apply at least required-checks to the day-to-day branch. *Evidence:* "master branch is NOT protected at all" and is where work lands. *Effort:* S. *Impact:* med. *First step:* `gh api -X PUT repos/uhsear/festival-planner/branches/master/protection ...` mirroring main's required checks.

### Release / OTA

**P12 — Commit the deploy script and strip the hardcoded creds.** *What:* move `festie-deploy.py`/`festie-verify.py` into `scripts/deploy/`, read creds from env / a gitignored `.env.deploy`, document the runbook. *Evidence:* both live in `%TEMP%`, uncommitted, with a plaintext SSH password and prod login hardcoded (redacted here). *Effort:* M. *Impact:* high. *First step:* `mkdir scripts/deploy`, move + parametrize with `os.environ[...]`, add `.env.deploy` to `.gitignore`, **rotate both leaked passwords afterward.**

**P13 — ~~Add a production migration runner + `schema_migrations` table.~~ [WITHDRAWN — false premise]** The original evidence ("no schema_migrations tracking table") was wrong: the app ALREADY owns a migration system in `lib/planner-db-pg.ts` — a version-keyed `schema_migrations` ledger that auto-applies pending `migrations/*.sql` on backend boot, with drift detection. A second `scripts/migrate.mjs` (filename-keyed) was added, then REMOVED after it collided with the app's version-keyed ledger on prod (Postgres 42703). Migrations are app-managed; the deploy's `pm2 reload` triggers them. No separate runner needed — see `docs/runbooks/deploy.md` §3.

**P14 — Add a rollback script + tag each deploy.** *What:* `git tag deploy-<timestamp>` on deploy; `rollback.sh <tag>` that resets, rebuilds, restarts. *Evidence:* "No rollback story… no git tag per deploy, no rollback script." *Effort:* M. *Impact:* high. *First step:* in the deploy script after success, `git tag deploy-$(date +%Y%m%d-%H%M%S) && git push --tags`; write `scripts/deploy/rollback.sh`.

**P15 — Switch deploy to OTA-staging-first, manual promote.** *What:* CI/merge publishes `eas update --channel staging`; production promotion is a one-command `eas update:republish` after a health check. *Evidence:* OTA is dispatch-only with `fail_on_crash_threshold` defaulting false (advisory) and no staging channel. *Effort:* M. *Impact:* med. *First step:* create `staging` + `production` EAS channels mapped 1:1 to branches; change `mobile-ota.yml` default channel to `staging`.

**P16 — Add a `/health` readiness check gate to the deploy + pull-from-tunnel-on-unhealthy.** *What:* the deploy already curls `/api/ready`; add a real readiness endpoint that pings Postgres+Redis and abort+rollback on non-200. *Evidence:* deploy checks `/api/ready` locally but "Cloudflare continues routing traffic… no mechanism to pull the server out." *Effort:* M. *Impact:* med. *First step:* confirm `/api/ready` checks DB+Redis; on failure in the deploy script, auto-invoke `rollback.sh` (P14).

**P17 — Fix the stale comments / process-name mismatches.** *What:* `android-release.yml` says "RN 0.81/SDK 54" (actually SDK 56), `mobile-release-gate.yml` header says fingerprint (actually appVersion), `restart.sh` references `festival-planner` (PM2 app is `festie`). *Evidence:* all three confirmed in INVENTORY; `restart.sh` would silently no-op in an emergency. *Effort:* S. *Impact:* med (the restart.sh one is an incident-time landmine). *First step:* `grep -rl festival-planner ~/*.sh` on the server, fix the app name; correct the two workflow comments. **[PARTIALLY RESOLVED]** `android-release.yml` header already corrected to "Expo SDK 56 / RN 0.85" (verified 2026-06-12). Remaining: `mobile-release-gate.yml` fingerprint comment and `restart.sh` app-name are server-side / out of scope — still require manual fix.

**P18 — Automate the Android `VERSION_CODE_OFFSET`.** *What:* derive version code from Play Console's last code instead of hardcoded `100 + run_number`. *Evidence:* comment literally says "ACTION REQUIRED: look up the last published versionCode." *Effort:* M. *Impact:* low. *First step:* query the Play API in the workflow, or document the lookup as a checklist step in the release runbook.

### Testing

**P19 — Delete or quarantine the stale Expo-Go Maestro flows.** *What:* remove `packages/mobile/maestro/*` (SDK-54 / `host.exp.exponent` targets) or move under `legacy/`. *Evidence:* project on SDK 56; these target Expo Go SDK 54 and aren't in CI — silent rot. *Effort:* S. *Impact:* med. *First step:* `git rm -r packages/mobile/maestro/phase*.yaml smoke.yaml ...` keeping only what's referenced by CI in `.maestro/`. **[RESOLVED]** The SDK-54 YAML flows (`phase*.yaml`, `smoke.yaml`) are no longer present in `packages/mobile/maestro/` (verified 2026-06-12); only screenshots/APKs remain. Canonical flows live in `packages/mobile/.maestro/` and are referenced by CI.

**P20 — Make web/shared vitest coverage a hard gate (or raise thresholds).** *What:* fail the `frontend-tests` job on coverage drop. *Evidence:* "40/35% … not enforced as a separate CI gate" — only backend c8 blocks. *Effort:* S. *Impact:* med. *First step:* add `--coverage` + `coverage.thresholds` to the web/shared vitest configs so vitest exits non-zero below threshold; ratchet up from current actuals.

**P21 — Add JUnit trend reporting on the E2E workflows.** *What:* publish `maestro-report.xml` / Playwright JUnit via `dorny/test-reporter` for PR annotations. *Evidence:* "No JUnit trend tracking… history only via artifact browser." *Effort:* S. *Impact:* low. *First step:* add a `dorny/test-reporter@v1` step keyed on the existing `maestro-report.xml` artifact.

**P22 — Fix the iOS Maestro path inconsistency.** *What:* unify on `.maestro/` for both platforms. *Evidence:* iOS uses `maestro/ios-smoke.yaml`, Android uses `.maestro/android-smoke.yaml`. *Effort:* S. *Impact:* low. *First step:* `git mv packages/mobile/maestro/ios-smoke.yaml packages/mobile/.maestro/` and update `ios-e2e.yml`.

**P23 — Replace fixed sleeps with Maestro auto-wait; diagnose the iOS 5/5 failure.** *What:* the retry-once + 10s sleep masks root cause; use `assertVisible`/`waitForAnimationToEnd`. *Evidence:* "ios-e2e.yml has been failing 100% … retry-once workaround… masks the root cause." *Effort:* M. *Impact:* med. *First step:* run the flow locally with `--test-output-dir` to capture the failing screenshot, then replace sleeps with element waits.
**[RESOLVED]** iOS E2E (`ios-e2e.yml`) is now green (free public-repo macOS + Maestro); the 100%-failing status was the pre-fix state.

**P24 — Add CocoaPods + pnpm-store caching to `ios-e2e.yml`.** *What:* cache `Pods` + `~/Library/Caches/CocoaPods` + pnpm store. *Evidence:* "ios-e2e.yml has zero caching… pod install runs cold every time (2-5min)." *Effort:* M. *Impact:* med. *First step:* add `actions/cache@v4` keyed on `ios/Podfile.lock` once prebuild has generated it.

**P25 — Make the authed Maestro assertions hard-fail.** *What:* the crew/SOS assertions silently pass if the test account leaves the crew. *Evidence:* "crew-tab assertions become optional/silent-pass… hidden gap." *Effort:* S. *Impact:* low. *First step:* remove `optional: true` from the authed `assertVisible`s and add a setup step that re-joins the crew.

### Ops

**P26 — Add external uptime monitoring (UptimeRobot) + cron heartbeats (healthchecks.io).** *What:* free external probe of `/api/ready` + heartbeat pings from the backup/e2e crons. *Evidence:* "No external uptime monitoring"; the 20:07 UTC connection-refused outage today surfaced only in cloudflared logs. *Effort:* S. *Impact:* high. *First step:* create a free UptimeRobot HTTP monitor on `https://festie.us/api/ready`; add `curl -fsS https://hc-ping.com/<uuid>` to the end of `backup-pg.sh`.

**P27 — Remove the deprecated `health-monitor.js` cron.** *What:* drop the self-deprecated script that still triggers PM2 restarts, leaving `error-rate-alert.cjs` as the single signal. *Evidence:* file header says "DEPRECATED… will be removed"; two overlapping 5-min health crons with uncoordinated behavior. *Effort:* S. *Impact:* med. *First step:* `crontab -e` and remove the `health-monitor.js` line.

**P28 — Confirm @sentry/node is actually installed on the server.** *What:* Sentry wrapper is a no-op if the package is absent — verify it isn't silently disabled in prod. *Evidence:* "@sentry/node installation status on server was not confirmed"; `lib/sentry.ts` is conditional. *Effort:* S. *Impact:* med. *First step:* `ssh asir@192.168.0.150 'cd festival-planner && node -e "require(\"@sentry/node\")" && echo OK'`.

**P29 — `pm2 startup systemd` + `pm2 save`.** *What:* ensure PM2 + the app survive a reboot/kernel update. *Evidence:* single host, no mention of a systemd unit for PM2. *Effort:* S. *Impact:* med. *First step:* `pm2 startup systemd` then run the printed root command, then `pm2 save`.

**P30 — Align the committed `CLUSTER_SIZE` and document why fork mode.** *What:* committed `ecosystem.config.cjs` sets `CLUSTER_SIZE: '1'` while INVENTORY OPS reports the env shows `4`; reconcile so the cosmetic value doesn't imply nonexistent redundancy. *Evidence:* verified committed file line 59 = `'1'`; OPS says running env = `4`. *Effort:* S. *Impact:* low. *First step:* `pm2 env 1 | grep CLUSTER_SIZE` on the server; set to `1` to match reality, or compile-to-JS + cluster (large, see Reject list).

### Dev-loop

**P31 — Add husky + lint-staged pre-commit (ESLint/Prettier on staged files).** *What:* fast pre-commit formatting/lint; keep full typecheck in CI. *Evidence:* no hooks present; relies on CI to catch lint. *Effort:* M. *Impact:* med. *First step:* `pnpm add -Dw husky lint-staged` in `packages/`, `npx husky init`, add a `lint-staged` block running `eslint --fix` + `prettier --write`.

**P32 — Extract a root `tsconfig.base.json`.** *What:* shared compilerOptions (strict, moduleResolution, target) each package extends. *Evidence:* three packages with independent tsconfigs; drift risk. *Effort:* M. *Impact:* low. *First step:* create `tsconfig.base.json`, change each package tsconfig to `"extends": "../../tsconfig.base.json"`.
**[RESOLVED]** Root `tsconfig.base.json` exists in the repo.

**P33 — Use `pnpm --filter '[HEAD^1]'` for affected-only tasks in CI.** *What:* run web/mobile/shared tasks only when those packages changed. *Evidence:* every job runs regardless of what changed. *Effort:* M. *Impact:* med (overlaps P8). *First step:* prototype `pnpm --filter '...[origin/main]' test` locally, then adopt in the relevant jobs.

**P34 — Run `npx expo-doctor` as the first step of native build workflows.** *What:* fail fast on config drift before burning builder minutes. *Evidence:* Windows-dev/Linux-prod drift is real; `mobile-release-gate.yml` already runs it but isn't in the build path. *Effort:* S. *Impact:* low. *First step:* add an `npx expo-doctor` step to the top of `android-release.yml`.

---

## 3. Highest-risk gaps (blunt)

1. **Backups may be silently dead AND have zero offsite copy.** INVENTORY internally contradicts itself: RELEASE claims fresh 6-hourly dumps through Jun 11; OPS claims the cron froze on May 2 with a `festie` vs `festival-planner` path mismatch. Either way `OFFSITE_TARGET` is unset and *every* backup is single-host. If that box dies, the festival data is gone. **Verify the live backup state today**, fix the path, set `OFFSITE_TARGET` to a Cloudflare R2/Backblaze B2 bucket, and wire `backup-verify-restore.sh` into cron with a `pg_restore --list` smoke test.

2. **Plaintext production credentials in an uncommitted `%TEMP%` script.** SSH password and prod login are hardcoded on one Windows machine with no vault and no backup of the procedure itself. Machine wipe = lost deploy capability; file leak = full compromise. Rotate both passwords and commit a sanitized, env-driven deploy script (P12).

3. **No rollback path and a hard-restart deploy.** `git reset --hard origin/main` + `pm2 restart` with no tag, no previous artifact, and a ~5s drop of all live Socket.IO connections — during a festival that is the worst possible moment. A bad deploy can only be undone by hand. (P14/P16.)

4. **No external uptime monitoring.** Today's 20:07 UTC outage was invisible except in tunnel logs. The only health signal is an in-process cron that cannot fire if the host is down. (P26.)

5. **Manual, untracked production migrations.** 52 repo migrations, no `schema_migrations` table, no production runner, no deploy step — there is no programmatic way to know what schema the live DB is on. A forgotten migration ships a broken app. (P13.)

---

## 4. Reject list (researched, not worth it here)

- **Turborepo / Nx.** 4 packages, 1 dev. Research (nextbuild.co) says these earn their keep at 8-10+ packages or 10+ contributors; below that, `pnpm --filter` + bash is faster and free. Adopt only if package count or team grows.
- **Maestro Cloud sharding ($250/device/mo).** Local emulator + free GitHub Actions covers a solo dev's volume. The local Android rig already targets sub-8-min builds. Pure cost, no benefit at this scale.
- **WAL-G / pgBackRest / point-in-time recovery.** DB is sub-MB (792K dumps). Research (sisl.pl, oneuptime) explicitly reserves WAL shipping for DBs where a full dump exceeds ~10-15 min or RPO must be sub-hour. Nightly+6h `pg_dump` + offsite is the correct tool; the gap is *offsite*, not *WAL*.
- **Any k8s / container orchestration.** One box, one Node process. Kubernetes/Swarm/Nomad would add enormous ops surface for a single-instance app. The `docker` CI job (build-only, no push) is fine as a build-validity check; don't extend it into orchestration.
- **PM2 cluster mode (right now).** Blocked by `tsx`-as-interpreter (can't load `.ts` in cluster mode — documented in the config). True zero-downtime reload needs ≥2 workers + `wait_ready` + `process.send('ready')`, which requires compiling the backend to JS first. That's a real project, not a config tweak — defer until a compile step exists. Keep fork mode for now.
- **Fingerprint `runtimeVersion` policy.** Already tried and reverted (spurious iOS-prebuild hash churn, expo/expo#34195). Research confirms it's still experimental for SDK 56. Stay on `appVersion`; add a CI fingerprint *diff gate* (cheap, non-policy) instead if you want the safety signal.
- **Self-hosted GlitchTip / Loki+Grafana.** Sentry free tier (5K errors/mo) fits a small user base with zero ops. Self-hosting adds RAM + Celery + another Postgres/Redis tenant to the already-single box. Revisit only if you blow the free quota.
- **Automated Playwright test generation (Planner/Generator/Healer).** Research (testquality.com) sets a 200-test floor before the MCP/token overhead pays off; the current E2E suite is far below that. First normalize locators to `getByRole`/`getByTestId` and get the suite into CI (P10).

---

## 5. Top 10 quick reference (ranked by impact / effort)

> ✅ = resolved as of 2026-06-13. Remaining open items shown without checkmark.

| # | Process | Improvement | Impact | Effort | Status |
|---|---------|-------------|--------|--------|--------|
| 1 | Ops | External uptime monitor + cron heartbeats (P26) | high | S | open |
| 2 | CI/CD | Concurrency groups + cancel-in-progress (P1) | high | S | ✅ |
| 3 | CI/CD | `npm audit` → cron + non-blocking; unblock red CI (P2) | high | S | ✅ |
| 4 | Release | Commit deploy script, strip + rotate creds (P12) | high | M | open |
| 5 | Release | Production migration runner + tracking table (P13) | high | M | open |
| 6 | Release | Rollback script + per-deploy git tag (P14) | high | M | open |
| 7 | CI/CD | Remove ghost `test (20)` required check (P3) | med | S | open |
| 8 | CI/CD | `timeout-minutes` on every job (P4) | med | S | ✅ |
| 9 | Ops | Drop deprecated `health-monitor.js` cron (P27) | med | S | open |
| 10 | Release | Fix `restart.sh` / stale process-name mismatches (P17) | med | S | partially resolved |

(Backups — risk #1 — sits above this table as a verify-then-fix action, not a clean impact/effort cell, because the very state of the backups is unconfirmed.)
