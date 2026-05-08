#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Backup restore verification for Festie
#
# Creates a temporary database, restores the most recent (or specified) backup,
# verifies table count, then drops the temp database.
#
# Usage:
#   bash scripts/backup-verify-restore.sh                    # latest backup
#   bash scripts/backup-verify-restore.sh /path/to/dump.dump # specific file
#
# Environment variables:
#   BACKUP_DIR          Override backup directory (default: $HOME/backups/festie)
#   DB_USER             PostgreSQL user (default: festival)
#   DB_HOST             PostgreSQL host (default: 127.0.0.1)
#   DB_PORT             PostgreSQL port (default: 5432)
#   DB_NAME             Source database name for table-count comparison (default: festival_planner)
#   EXPECTED_TABLES     Override expected table count (default: auto-detect from source DB)
#   ALERT_WEBHOOK_URL   POST webhook for failure notifications (Slack, Discord, ntfy, etc.)
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/festie}"
DB_USER="${DB_USER:-festival}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-festival_planner}"
TEMP_DB="festie_restore_test_$(date +%s)"

# ── Helpers ──────────────────────────────────────────────────────────────────

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }
die() { log "ERROR: $*" >&2; send_alert "Backup restore verification FAILED: $*"; exit 1; }

send_alert() {
  local message="$1"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    local payload
    payload=$(printf '{"text":"Festie Backup Alert\\n%s\\nHost: %s"}' "$message" "$(hostname)")
    curl -sf -X POST -H "Content-Type: application/json" \
      -d "$payload" "$ALERT_WEBHOOK_URL" \
      --max-time 10 >/dev/null 2>&1 || log "WARNING: Webhook delivery failed"
  fi
}

cleanup() {
  log "Dropping temporary database ${TEMP_DB}..."
  dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$TEMP_DB" 2>/dev/null || true
}
trap cleanup EXIT

# ── Resolve credentials ─────────────────────────────────────────────────────

if [ -z "${PGPASSWORD:-}" ]; then
  if [ -n "${DATABASE_URL:-}" ]; then
    PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  elif [ -f "$SCRIPT_DIR/.env" ]; then
    PGPASSWORD=$(grep '^DATABASE_URL=' "$SCRIPT_DIR/.env" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  fi
fi
export PGPASSWORD="${PGPASSWORD:?Could not resolve database password from DATABASE_URL, PGPASSWORD, or .env}"

# ── Determine backup file ───────────────────────────────────────────────────

if [ -n "${1:-}" ]; then
  BACKUP_FILE="$1"
else
  # Find the most recent .dump file in BACKUP_DIR
  BACKUP_FILE=$(find "$BACKUP_DIR" -maxdepth 1 -name "fp_*.dump" -not -name "*_weekly.dump" \
    -printf '%T+ %p\n' 2>/dev/null | sort -r | head -1 | awk '{print $2}')
  if [ -z "$BACKUP_FILE" ]; then
    # Try weekly backups as fallback
    BACKUP_FILE=$(find "$BACKUP_DIR" -maxdepth 1 -name "fp_*_weekly.dump" \
      -printf '%T+ %p\n' 2>/dev/null | sort -r | head -1 | awk '{print $2}')
  fi
fi

[ -n "$BACKUP_FILE" ] || die "No backup file found in ${BACKUP_DIR}"
[ -f "$BACKUP_FILE" ] || die "Backup file not found: ${BACKUP_FILE}"

FSIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null || echo 0)
[ "$FSIZE" -gt 100 ] || die "Backup file suspiciously small (${FSIZE} bytes): ${BACKUP_FILE}"

log "Verifying backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))"

# ── Pre-flight checks ───────────────────────────────────────────────────────

command -v pg_restore >/dev/null 2>&1 || die "pg_restore not found in PATH"
command -v createdb >/dev/null 2>&1 || die "createdb not found in PATH"
command -v dropdb >/dev/null 2>&1 || die "dropdb not found in PATH"
command -v psql >/dev/null 2>&1 || die "psql not found in PATH"

# ── Determine expected table count ──────────────────────────────────────────

if [ -n "${EXPECTED_TABLES:-}" ]; then
  SOURCE_TABLE_COUNT="$EXPECTED_TABLES"
else
  SOURCE_TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A \
    -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" 2>/dev/null) || true
  if [ -z "$SOURCE_TABLE_COUNT" ] || [ "$SOURCE_TABLE_COUNT" -eq 0 ]; then
    log "WARNING: Could not auto-detect source table count, skipping table-count comparison"
    SOURCE_TABLE_COUNT=""
  else
    log "Source database has ${SOURCE_TABLE_COUNT} tables"
  fi
fi

# ── Create temporary database ───────────────────────────────────────────────

log "Creating temporary database: ${TEMP_DB}"
createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$TEMP_DB" || die "Failed to create temp database ${TEMP_DB}"

# ── Restore ─────────────────────────────────────────────────────────────────

log "Running pg_restore into ${TEMP_DB}..."
if pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TEMP_DB" \
  --no-owner --no-privileges "$BACKUP_FILE" 2>&1; then
  log "pg_restore completed successfully"
else
  # pg_restore returns non-zero for warnings (e.g., missing roles); check if tables exist
  log "WARNING: pg_restore exited with warnings (this may be normal for --no-owner restores)"
fi

# ── Verify table count ──────────────────────────────────────────────────────

RESTORED_TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TEMP_DB" -t -A \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" 2>/dev/null)

if [ -z "$RESTORED_TABLE_COUNT" ] || [ "$RESTORED_TABLE_COUNT" -eq 0 ]; then
  die "Restored database has 0 tables — restore failed"
fi

log "Restored database has ${RESTORED_TABLE_COUNT} tables"

if [ -n "$SOURCE_TABLE_COUNT" ]; then
  if [ "$RESTORED_TABLE_COUNT" -ne "$SOURCE_TABLE_COUNT" ]; then
    die "Table count mismatch: source=${SOURCE_TABLE_COUNT} restored=${RESTORED_TABLE_COUNT}"
  fi
  log "Table count matches source database (${SOURCE_TABLE_COUNT})"
fi

# ── Quick data sanity check ─────────────────────────────────────────────────

USER_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TEMP_DB" -t -A \
  -c "SELECT count(*) FROM users;" 2>/dev/null || echo "0")
log "Restored user count: ${USER_COUNT}"

# ── Success ─────────────────────────────────────────────────────────────────
# cleanup trap will drop the temp database

log "Backup restore verification PASSED: ${BACKUP_FILE}"
log "  Tables: ${RESTORED_TABLE_COUNT}, Users: ${USER_COUNT}"
