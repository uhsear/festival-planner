#!/usr/bin/env python3
"""Deploy a branch to STAGING and verify it actually BOOTS before production sees it.

Why this exists
---------------
On 2026-08-19 a Redis option change passed the full 3300-test local suite and a
fully green CI, then took production down for ~90s. The failing path was one the
test harness structurally cannot execute: @socket.io/redis-adapter calls
psubscribe inside its constructor at boot, and the app treats any unhandled
rejection as a shutdown signal. A green suite says nothing about boot.

So: every backend change goes to staging first, and staging is checked for BOOT
ERRORS, not just an HTTP 200. A crash-looping process can still answer 200 on a
later restart, and /api/ready alone would have missed the cache-bus regression
entirely (it logged an error and carried on).

Usage
-----
  python scripts/deploy/verify_staging.py [--ref origin/main] [--keep]

Exit code 0 only if staging boots clean. Anything else means do not ship.
"""
import argparse
import os
import re
import sys

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = os.environ.get("FESTIE_SSH_HOST", "192.168.0.150")
USER = os.environ.get("FESTIE_SSH_USER", "asir")
STAGE = os.environ.get("FESTIE_STAGE_DIR", "/home/asir/festie-staging")
STAGE_PORT = int(os.environ.get("FESTIE_STAGE_PORT", "4001"))
PROD_PORT = int(os.environ.get("FESTIE_PROD_PORT", "4000"))

# Boot-time failures that must FAIL the check. Each earned its place.
FATAL_PATTERNS = [
    (r"UNHANDLED_REJECTION", "unhandled rejection (this app shuts down on one)"),
    (r"Stream isn't writeable", "ioredis command issued before the socket was writeable"),
    (r"shutdown initiated", "process began shutting down during boot"),
    (r"subscribe failed", "a pub/sub subscribe failed — the subscriber is silently dead"),
    (r"migration runner aborted", "migrations did not apply"),
    (r"ERR_MODULE_NOT_FOUND", "a module failed to resolve at runtime"),
    (r"failed to start server", "listen failed"),
]
# Present-and-correct markers. Absence is as damning as an error line.
REQUIRED_PATTERNS = [
    (r"server started", "server never reached listening"),
    (r"postgresql connection verified", "Postgres never verified"),
]

shq = lambda s: "'" + s.replace("'", "'\\''") + "'"


def _current_boot_only(log_text: str) -> str:
    """Trim the log to the CURRENT process's boot.

    `pm2 restart` sends SIGINT to the outgoing process, which logs
    "shutdown initiated" / "closing server" AFTER we truncate the file. Scanning
    the whole file therefore reports a shutdown that belongs to the previous
    instance — a false positive on the single check this script exists for, which
    would quickly teach a reader to ignore it.

    Every boot begins by logging "startup config", so the current boot is
    everything from the LAST such line onward. If it is absent (the process never
    got that far) return the text unchanged, since that is itself a real failure
    and must not be trimmed away.
    """
    marker = "startup config"
    idx = log_text.rfind(marker)
    if idx == -1:
        return log_text
    line_start = log_text.rfind("\n", 0, idx) + 1
    return log_text[line_start:]


def run(c, cmd, timeout=1800, login=False):
    if login:
        cmd = f"bash -lc {shq(cmd)}"
    _, so, se = c.exec_command(cmd, timeout=timeout)
    out = so.read().decode("utf-8", "replace")
    err = se.read().decode("utf-8", "replace")
    return so.channel.recv_exit_status(), out, err


def step(c, title, cmd, login=False, fatal=True):
    print("\n" + "-" * 72 + f"\n>> {title}\n" + "-" * 72)
    code, out, err = run(c, cmd, login=login)
    body = (out + err).strip()
    print(body[-2500:] or "(no output)")
    print(f"[exit={code}]")
    if code != 0 and fatal:
        print(f"\nSTAGING VERIFY FAILED at: {title}")
        sys.exit(2)
    return body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default="origin/main", help="git ref to deploy to staging")
    ap.add_argument("--keep", action="store_true", help="leave staging running afterwards")
    args = ap.parse_args()

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(hostname=HOST, username=USER, timeout=20, allow_agent=True, look_for_keys=True)
    try:
        step(c, f"Sync staging to {args.ref}",
             f"cd {STAGE} && git fetch origin --prune && git reset --hard {args.ref} && git log --oneline -1")
        step(c, "Root deps (prod-only, same as production)",
             f"cd {STAGE} && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3", login=True)
        step(c, "Workspace deps", f"cd {STAGE}/packages && pnpm install --frozen-lockfile 2>&1 | tail -3", login=True)
        step(c, "Build web", f"cd {STAGE}/packages && pnpm --filter @festie/web build 2>&1 | tail -4", login=True)

        # Truncate the log so we only read THIS boot, not a previous one.
        step(c, "Restart staging with a clean log",
             f"cd {STAGE} && : > logs/pm2-out.log && : > logs/pm2-error.log && "
             f"pm2 restart festie-staging --update-env >/dev/null 2>&1 && sleep 25 && "
             f"pm2 list --no-color | grep festie", login=True)

        boot_raw = step(c, "BOOT LOG (this is the actual check)",
                        f"cat {STAGE}/logs/pm2-out.log; echo '--- stderr ---'; cat {STAGE}/logs/pm2-error.log",
                        fatal=False)
        boot = _current_boot_only(boot_raw)

        step(c, f"Health / readiness on :{STAGE_PORT}",
             f"curl -s -o /dev/null -w 'health=%{{http_code}}\\n' http://127.0.0.1:{STAGE_PORT}/api/health; "
             f"curl -s -o /dev/null -w 'ready=%{{http_code}}\\n' http://127.0.0.1:{STAGE_PORT}/api/ready; "
             f"curl -s http://127.0.0.1:{STAGE_PORT}/api/ready | head -c 300", fatal=False)

        restarts = step(c, "Restart count (a crash-loop can still answer 200 between restarts)",
                        "pm2 jlist | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
                        "const j=JSON.parse(d);for(const p of j){if(p.name==='festie-staging')"
                        "console.log('restarts='+p.pm2_env.restart_time+' status='+p.pm2_env.status"
                        "+' uptime_ms='+(Date.now()-p.pm2_env.pm_uptime))}})\"", login=True, fatal=False)

        print("\n" + "=" * 72)
        print("BOOT ANALYSIS")
        print("=" * 72)
        problems = []
        for pattern, why in FATAL_PATTERNS:
            hits = len(re.findall(pattern, boot, re.IGNORECASE))
            print(f"  {'FAIL' if hits else 'ok  '}  {pattern:<32} {hits} hit(s)  — {why}")
            if hits:
                problems.append(f"{pattern} x{hits}: {why}")
        for pattern, why in REQUIRED_PATTERNS:
            hits = len(re.findall(pattern, boot, re.IGNORECASE))
            print(f"  {'ok  ' if hits else 'FAIL'}  {pattern:<32} {hits} hit(s)  — required")
            if not hits:
                problems.append(f"MISSING {pattern}: {why}")

        m = re.search(r"restarts=(\d+)", restarts or "")
        if m and int(m.group(1)) > 0:
            print(f"  NOTE  staging has restarted {m.group(1)} time(s) — check whether that predates this run")

        step(c, "Production untouched?",
             f"curl -s -o /dev/null -w 'prod_ready=%{{http_code}}\\n' http://127.0.0.1:{PROD_PORT}/api/ready",
             fatal=False)

        if not args.keep:
            print("\n(leaving staging running; pass --keep explicitly to silence this note)")

        print("\n" + "=" * 72)
        if problems:
            print("RESULT: STAGING BOOT IS NOT CLEAN — DO NOT DEPLOY TO PRODUCTION")
            for p in problems:
                print("  - " + p)
            print("=" * 72)
            sys.exit(1)
        print("RESULT: staging booted clean — safe to promote to production")
        print("=" * 72)
    finally:
        c.close()


if __name__ == "__main__":
    main()
