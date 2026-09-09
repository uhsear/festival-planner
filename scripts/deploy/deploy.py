#!/usr/bin/env python3
# Copyright (c) 2026 Asir Khan. All rights reserved.
# All Rights Reserved. See the LICENSE file.
#
# Festie production deploy (P12 / P14 / P16).
#
# Sanitized, env-driven replacement for the old uncommitted %TEMP% script that
# carried plaintext SSH + login credentials. This script:
#
#   1. SSHes to the prod box (KEY AUTH ONLY — no password support).
#   2. git fetch + reset --hard origin/main.
#   3. Migrations are app-managed (applied on backend boot); no deploy step.
#   4. Builds the web bundle. (The backend runs from server.ts under tsx; the
#      dist/ bundle is built by `npm run build` but is NOT on the boot path yet.)
#   6. Restarts the PM2 app ("festie").
#   7. Tags the deploy `deploy-<UTC timestamp>` and pushes the tag (P14).
#   8. Health-gates on /api/ready; if it is non-200, ABORTS and prints the
#      rollback command (P16).
#   9. Smoke-tests a real login (200) if test creds are provided.
#
# Configuration (all via environment — nothing secret is committed):
#   FESTIE_SSH_HOST       prod host/IP                 (default 192.168.0.150)
#   FESTIE_SSH_USER       prod SSH user                (default asir)
#   FESTIE_SSH_KEY        path to a private key file   (optional; falls back to
#                                                        the agent / ~/.ssh keys)
#   FESTIE_APP_DIR        app dir on the server        (default /home/asir/festival-planner)
#   FESTIE_PM2_NAME       PM2 process name             (default festie)
#   FESTIE_READY_URL      readiness URL on the server  (default http://localhost:4000/api/ready)
#   FESTIE_LOGIN_URL      login URL on the server      (default http://localhost:4000/api/v1/auth/login)
#   FESTIE_TEST_USER      smoke-login username         (optional — skips login check if unset)
#   FESTIE_TEST_PASSWORD  smoke-login password         (optional)
#
# There is NO password-auth path by design. If key auth fails, fix the key —
# do not add a password.

import json
import os
import sys
import time

try:
    import paramiko
except ImportError:
    sys.exit("paramiko is required: pip install paramiko")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = os.environ.get("FESTIE_SSH_HOST", "192.168.0.150")
USER = os.environ.get("FESTIE_SSH_USER", "asir")
KEY = os.environ.get("FESTIE_SSH_KEY")  # optional explicit key file
APP = os.environ.get("FESTIE_APP_DIR", "/home/asir/festival-planner")
PM2_NAME = os.environ.get("FESTIE_PM2_NAME", "festie")
READY_URL = os.environ.get("FESTIE_READY_URL", "http://localhost:4000/api/ready")
LOGIN_URL = os.environ.get("FESTIE_LOGIN_URL", "http://localhost:4000/api/v1/auth/login")
TEST_USER = os.environ.get("FESTIE_TEST_USER")
TEST_PASSWORD = os.environ.get("FESTIE_TEST_PASSWORD")


def run(client, cmd, timeout=300):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    # Key auth ONLY. With key_filename set we point at the explicit key; without
    # it paramiko uses the SSH agent and the default ~/.ssh identities. We never
    # pass a password and disable interactive password fallback.
    connect_kwargs = dict(
        hostname=HOST,
        username=USER,
        timeout=20,
        allow_agent=True,
        look_for_keys=True,
    )
    if KEY:
        connect_kwargs["key_filename"] = KEY
    client.connect(**connect_kwargs)
    return client


def rollback_hint(tag=None):
    target = tag or "deploy-<previous-timestamp>"
    print("")
    print("=" * 60)
    print("DEPLOY ABORTED — server may be in a bad state.")
    print("Roll back with the last known-good deploy tag:")
    print(f"  ssh {USER}@{HOST} 'cd {APP} && bash scripts/deploy/rollback.sh {target}'")
    print("(List tags:  git tag -l 'deploy-*' | sort)")
    print("=" * 60)


def main():
    deploy_tag = "deploy-" + time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    client = connect()
    try:
        # 1. Sync to origin/main
        code, out, err = run(
            client,
            f"cd {APP} && git fetch origin --tags && git reset --hard origin/main && git log --oneline -1",
        )
        print(f"[git] exit={code}\n{out}{err}")
        if code != 0:
            rollback_hint()
            raise SystemExit("git sync failed")

        # 2. Install deps. The bundle is built with --packages=external, so every
        # RUNTIME dependency (e.g. bullmq) must still be present in the root
        # node_modules or the app crash-loops on boot with ERR_MODULE_NOT_FOUND.
        # esbuild itself lives in `dependencies`, not devDependencies, so it
        # survives the --omit=dev below and step 4 can run.
        # The root is an npm project; packages/ is a pnpm workspace. Install both
        # so a deploy that adds a backend or frontend dep doesn't take prod down.
        # (login shell so npm/pnpm are on PATH).
        code, out, err = run(
            client,
            f"bash -lc 'set -o pipefail; cd {APP} && npm install --omit=dev --no-audit --no-fund "
            f"&& cd {APP}/packages && pnpm install --frozen-lockfile 2>&1 | tail -10'",
            timeout=600,
        )
        print(f"[deps] exit={code}\n{out}{err}")
        if code != 0:
            rollback_hint()
            raise SystemExit("dependency install failed")

        # 3. Migrations are APP-MANAGED: lib/planner-db-pg.ts owns a version-keyed
        # `schema_migrations` ledger and applies any pending migrations/*.sql once
        # per Postgres URL on backend boot (the pm2 restart below triggers it). There
        # is no separate migration step in the deploy — adding one would double-run
        # and conflict with that ledger.

        # 4. Bundle the backend to dist/. PM2 execs dist/server.js (see
        # ecosystem.config.cjs) and dist/ is gitignored, so this step is the ONLY
        # thing that creates the artifact on the host.
        #
        # Placed here — after the dependency install, before the web build and
        # well before the pm2 restart — on purpose. Nothing user-visible has
        # changed yet at this point: the served web bundle is still the old one
        # and the running backend is still the old process, so aborting here
        # leaves prod entirely on the previous release instead of half-updated
        # (new SPA assets in front of an old backend). It is also the cheapest
        # step that can fail: seconds, against minutes for the web build.
        #
# The backend bundle build lived here. It is removed with the dist cutover:
        # ecosystem.config.cjs runs server.ts under tsx again, so nothing boots
        # dist/, and building it every deploy only cost time and left a stale
        # artifact. Restore this step together with the cutover — see
        # docs/runbooks/deploy.md for what still blocks it.

        # 5. Build the web bundle (login shell so pnpm is on PATH)
        code, out, err = run(
            client,
            f"bash -lc 'set -o pipefail; cd {APP}/packages && pnpm --filter @festie/web build 2>&1 | tail -8'",
            timeout=600,
        )
        print(f"[build] exit={code}\n{out}{err}")
        if code != 0:
            rollback_hint()
            raise SystemExit("web build failed")

        # NOTE: festie.us serves the Vite SPA (packages/web). The Expo
        # react-native-web export (`pnpm run build:web` in packages/mobile) is no
        # longer built here — it is kept dormant for a possible future
        # app.festie.us, but the desktop flagship is the bespoke web SPA.

        # 6. Restart the backend
        code, out, err = run(
            client,
            # By NAME on purpose. `pm2 restart <config file>` re-reads the ENV only —
            # it does NOT pick up a changed `script` or `interpreter`, so it cannot
            # apply a runtime change. Only `pm2 delete` + `pm2 start <config>` does
            # that, and that is a deliberate step for the cutover, not something a
            # routine deploy should do.
            f"pm2 restart {PM2_NAME} && sleep 5 && pm2 ls | grep {PM2_NAME}",
        )
        print(f"[pm2] exit={code}\n{out}{err}")

        # 7. Readiness gate (db + redis) — abort + rollback hint on non-200 (P16)
        code, out, err = run(
            client,
            f"curl -s -o /dev/null -w '%{{http_code}}' {READY_URL}",
        )
        ready_code = out.strip()
        print(f"[ready] http={ready_code}")
        if ready_code != "200":
            rollback_hint()
            raise SystemExit(f"/api/ready returned {ready_code} — deploy is NOT healthy")

        # 8. Real login smoke test (only if creds provided). Write the payload to
        # a temp file on the server and curl it with -d @file so the password
        # never appears in the server process list or shell history.
        if TEST_USER and TEST_PASSWORD:
            payload = json.dumps({"username": TEST_USER, "password": TEST_PASSWORD})
            tmp = "/tmp/festie-login.$$.json"
            run(client, f"umask 077 && cat > {tmp} <<'EOF'\n{payload}\nEOF")
            code, out, err = run(
                client,
                f"curl -s -o /dev/null -w '%{{http_code}}' -X POST {LOGIN_URL} "
                "-H 'Content-Type: application/json' -H 'X-Festie-Request: 1' "
                f"-d @{tmp}; rm -f {tmp}",
                timeout=60,
            )
            login_code = out.strip()
            print(f"[login] http={login_code}")
            if login_code != "200":
                rollback_hint()
                raise SystemExit(f"login smoke test returned {login_code}")
        else:
            print("[login] skipped (FESTIE_TEST_USER / FESTIE_TEST_PASSWORD not set)")

        # 9. Tag the deploy and push the tag (P14)
        code, out, err = run(
            client,
            f"cd {APP} && git tag {deploy_tag} && git push origin {deploy_tag}",
        )
        print(f"[tag] exit={code} tag={deploy_tag}\n{out}{err}")
        if code != 0:
            print("WARNING: deploy succeeded but tag push failed — tag manually for rollback safety.")

        print(f"\nDeploy OK — tagged {deploy_tag}")
    finally:
        client.close()


if __name__ == "__main__":
    main()
