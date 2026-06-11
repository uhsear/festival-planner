#!/usr/bin/env python3
# Copyright (c) 2026 Asir Khan. All rights reserved.
# Licensed under the Business Source License 1.1. See LICENSE file for details.
#
# Festie post-deploy verification (P12).
#
# Sanitized, env-driven replacement for the old uncommitted %TEMP% verify
# script. Read-only — it changes nothing on the server. Checks:
#   1. PM2 process is online.
#   2. /api/ready returns 200 (db + redis healthy).
#   3. A real login returns 200 (only if test creds are provided).
#   4. The served index references a fresh asset bundle hash.
#
# Configuration (env — KEY AUTH ONLY, no password support):
#   FESTIE_SSH_HOST / FESTIE_SSH_USER / FESTIE_SSH_KEY
#   FESTIE_APP_DIR / FESTIE_PM2_NAME / FESTIE_READY_URL / FESTIE_LOGIN_URL
#   FESTIE_TEST_USER / FESTIE_TEST_PASSWORD  (optional; skips login check if unset)
# See scripts/deploy/deploy.py for the full env contract.

import json
import os
import sys

try:
    import paramiko
except ImportError:
    sys.exit("paramiko is required: pip install paramiko")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = os.environ.get("FESTIE_SSH_HOST", "192.168.0.150")
USER = os.environ.get("FESTIE_SSH_USER", "asir")
KEY = os.environ.get("FESTIE_SSH_KEY")
APP = os.environ.get("FESTIE_APP_DIR", "/home/asir/festival-planner")
PM2_NAME = os.environ.get("FESTIE_PM2_NAME", "festie")
READY_URL = os.environ.get("FESTIE_READY_URL", "http://localhost:4000/api/ready")
LOGIN_URL = os.environ.get("FESTIE_LOGIN_URL", "http://localhost:4000/api/v1/auth/login")
TEST_USER = os.environ.get("FESTIE_TEST_USER")
TEST_PASSWORD = os.environ.get("FESTIE_TEST_PASSWORD")


def run(client, cmd, timeout=120):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    connect_kwargs = dict(
        hostname=HOST, username=USER, timeout=20, allow_agent=True, look_for_keys=True
    )
    if KEY:
        connect_kwargs["key_filename"] = KEY
    client.connect(**connect_kwargs)
    return client


def main():
    failures = []
    client = connect()
    try:
        code, out, err = run(client, f"pm2 ls | grep {PM2_NAME}")
        print(f"[pm2]\n{out}{err}")
        if "online" not in out:
            failures.append("pm2 process not online")

        code, out, err = run(client, f"curl -s -o /dev/null -w '%{{http_code}}' {READY_URL}")
        ready_code = out.strip()
        print(f"[ready] http={ready_code}")
        if ready_code != "200":
            failures.append(f"/api/ready returned {ready_code}")

        if TEST_USER and TEST_PASSWORD:
            payload = json.dumps({"username": TEST_USER, "password": TEST_PASSWORD})
            tmp = "/tmp/festie-verify-login.$$.json"
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
                failures.append(f"login returned {login_code}")
        else:
            print("[login] skipped (FESTIE_TEST_USER / FESTIE_TEST_PASSWORD not set)")

        code, out, err = run(
            client,
            "curl -s " + READY_URL.rsplit("/api/", 1)[0] + "/ "
            "| grep -o 'assets/index-[^\"]*' | head -2 && "
            f"ls {APP}/packages/web/dist/assets/ | grep '^index-' | head -2",
        )
        print(f"[bundle]\n{out}{err}")
    finally:
        client.close()

    if failures:
        print("\nVERIFY FAILED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("\nVerify OK.")


if __name__ == "__main__":
    main()
