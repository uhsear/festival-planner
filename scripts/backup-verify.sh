#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# backup-verify.sh  — weekly pg_restore smoke test for Festie
#
# Runs pg_restore --list on the newest dump in BACKUP_DIR.
# Appends PASS/FAIL with timestamp to VERIFY_LOG.
#
# Cron (weekly, Sunday 04:00):
#   0 4 * * 0 /home/asir/festival-planner/scripts/backup-verify.sh
#
# Healthcheck heartbeat (optional):
#   Set HEALTHCHECK_URL=https://hc-ping.com/<uuid> in .env or environment
# ─────────────────────────────────────────────────────────────────────
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/festie}"
VERIFY_LOG="${VERIFY_LOG:-${BACKUP_DIR}/verify.log}"

log()  { printf '[%s] %s\n' "$(date -Iseconds)" "$*" | tee -a "$VERIFY_LOG"; }
fail() { log "FAIL: $*"; exit 1; }

# ── Resolve credentials ──────────────────────────────────────────────
if [ -z "${PGPASSWORD:-}" ]; then
  if [ -n "${DATABASE_URL:-}" ]; then
    PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  elif [ -f "$SCRIPT_DIR/.env" ]; then
    PGPASSWORD=$(grep '^DATABASE_URL=' "$SCRIPT_DIR/.env" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  fi
fi
export PGPASSWORD="${PGPASSWORD:?Could not resolve database password}"

# ── Find newest dump ─────────────────────────────────────────────────
NEWEST=$(find "$BACKUP_DIR" -maxdepth 1 -name 'fp_*.dump' \
  -printf '%T+ %p\n' 2>/dev/null | sort -r | head -1 | awk '{print $2}')

[ -n "$NEWEST" ] || fail "No dump files found in ${BACKUP_DIR}"
[ -f "$NEWEST" ] || fail "Dump file missing: ${NEWEST}"

FSIZE=$(stat -c%s "$NEWEST" 2>/dev/null || echo 0)
[ "$FSIZE" -gt 100 ] || fail "Dump suspiciously small (${FSIZE} bytes): ${NEWEST}"

log "Verifying: ${NEWEST} ($(du -h "$NEWEST" | cut -f1))"

# ── pg_restore --list (cheap structural check, no DB needed) ─────────
# Disable pipefail for this check: pg_restore --list can return non-zero
# for minor warnings; we only care that it can read the dump header.
PG_RC=0
( set +e; pg_restore --list "$NEWEST" > /dev/null 2>&1 ) || PG_RC=$?

if [ "$PG_RC" -eq 0 ]; then
  MSG="PASS: pg_restore --list OK — $(basename "$NEWEST") (${FSIZE} bytes)"
  log "$MSG"
else
  fail "pg_restore --list exited ${PG_RC} on ${NEWEST} — dump may be corrupt"
fi

# ── Optional healthcheck ping ────────────────────────────────────────
if [ -n "${HEALTHCHECK_URL:-}" ]; then
  curl -fsS --max-time 10 "${HEALTHCHECK_URL}" > /dev/null 2>&1 \
    && log "Healthcheck ping sent" \
    || log "WARNING: healthcheck ping failed (non-fatal)"
fi
