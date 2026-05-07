#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# PostgreSQL backup script for Festie
#
# Creates pg_dump custom-format backups with gzip compression, rotates old
# backups on a daily (30) + weekly (12) retention policy, and optionally
# verifies the dump is restorable.
#
# Run manually:    bash scripts/backup-pg.sh
# Run via cron:    0 2 * * * cd /opt/festie && bash scripts/backup-pg.sh \
#                      >> logs/backup.log 2>&1
# npm alias:       npm run db:backup
# ──────────────────────────────────────────────────────────────────────────────

# ── Configuration (override with env vars) ───────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/festie}"
LOG_FILE="${BACKUP_LOG:-${BACKUP_DIR}/backup.log}"
DB_NAME="${DB_NAME:-festival_planner}"
DB_USER="${DB_USER:-festival}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DAILY_KEEP="${DAILY_KEEP:-30}"      # days to keep daily backups
WEEKLY_KEEP="${WEEKLY_KEEP:-12}"    # weekly snapshots to retain
VERIFY="${BACKUP_VERIFY:-0}"        # set to 1 to pg_restore --list after dump

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/fp_${TIMESTAMP}.dump"

# ── Helpers ──────────────────────────────────────────────────────────────────

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# ── Resolve credentials ─────────────────────────────────────────────────────
# Prefer DATABASE_URL (standard in .env), fall back to individual PG* vars.

if [ -z "${PGPASSWORD:-}" ]; then
  if [ -n "${DATABASE_URL:-}" ]; then
    PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  elif [ -f "$SCRIPT_DIR/.env" ]; then
    PGPASSWORD=$(grep '^DATABASE_URL=' "$SCRIPT_DIR/.env" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  fi
fi
export PGPASSWORD="${PGPASSWORD:?Could not resolve database password from DATABASE_URL, PGPASSWORD, or .env}"

# ── Pre-flight checks ───────────────────────────────────────────────────────

command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found in PATH"
mkdir -p "$BACKUP_DIR"

log "Starting backup: db=${DB_NAME} host=${DB_HOST}:${DB_PORT} dest=${BACKUP_DIR}"

# ── Dump ─────────────────────────────────────────────────────────────────────

if pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
     --format=custom --compress=6 -f "$BACKUP_FILE" 2>&1; then
  # Verify file is non-trivially sized (custom format header alone is ~20 bytes)
  FSIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null || echo 0)
  if [ "$FSIZE" -lt 100 ]; then
    rm -f "$BACKUP_FILE"
    die "Backup file suspiciously small (${FSIZE} bytes) -- likely an empty database or auth failure"
  fi
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  log "Backup OK: $BACKUP_FILE ($SIZE)"
else
  rm -f "$BACKUP_FILE"
  die "pg_dump exited with a non-zero status"
fi

# ── Optional verification ────────────────────────────────────────────────────

if [ "${VERIFY}" = "1" ]; then
  if pg_restore --list "$BACKUP_FILE" >/dev/null 2>&1; then
    log "Verification OK: pg_restore --list succeeded"
  else
    log "WARNING: pg_restore --list failed -- dump may be corrupt"
  fi
fi

# ── Weekly snapshot ──────────────────────────────────────────────────────────
# Tag Sunday dumps as weekly so they survive daily pruning.

DOW=$(date +%u)  # 7 = Sunday
if [ "$DOW" = "7" ]; then
  WEEKLY_FILE="${BACKUP_DIR}/fp_${TIMESTAMP}_weekly.dump"
  cp "$BACKUP_FILE" "$WEEKLY_FILE"
  log "Weekly snapshot: $WEEKLY_FILE"
fi

# ── Rotation: daily ─────────────────────────────────────────────────────────
# Delete daily dumps (not tagged _weekly) older than DAILY_KEEP days.

DAILY_PRUNED=$(find "$BACKUP_DIR" -maxdepth 1 -name "fp_*.dump" \
  -not -name "*_weekly.dump" -mtime +"${DAILY_KEEP}" -print -delete | wc -l)
log "Daily rotation: pruned ${DAILY_PRUNED} backups older than ${DAILY_KEEP}d"

# ── Rotation: weekly ────────────────────────────────────────────────────────
# Keep only the most recent WEEKLY_KEEP weekly snapshots.

WEEKLY_PRUNED=0
WEEKLY_FILES=$(ls -1t "$BACKUP_DIR"/fp_*_weekly.dump 2>/dev/null || true)
WEEKLY_INDEX=0
for WF in $WEEKLY_FILES; do
  WEEKLY_INDEX=$((WEEKLY_INDEX + 1))
  if [ "$WEEKLY_INDEX" -gt "$WEEKLY_KEEP" ]; then
    rm -f "$WF"
    WEEKLY_PRUNED=$((WEEKLY_PRUNED + 1))
  fi
done
log "Weekly rotation: pruned ${WEEKLY_PRUNED} snapshots, keeping ${WEEKLY_KEEP}"

# ── Summary ──────────────────────────────────────────────────────────────────

REMAINING_DAILY=$(find "$BACKUP_DIR" -maxdepth 1 -name "fp_*.dump" -not -name "*_weekly.dump" | wc -l)
REMAINING_WEEKLY=$(ls -1 "$BACKUP_DIR"/fp_*_weekly.dump 2>/dev/null | wc -l || echo 0)
log "Retention summary: ${REMAINING_DAILY} daily + ${REMAINING_WEEKLY} weekly backups on disk"
log "Backup complete"
