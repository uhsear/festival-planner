#!/bin/bash
# PostgreSQL backup script for Festie (custom format)
# Run via cron: 0 */6 * * * /home/asir/festival-planner/scripts/backup-pg.sh

BACKUP_DIR="${BACKUP_DIR:-/home/asir/backups/festival-planner}"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_NAME="${DB_NAME:-festival_planner}"
DB_USER="${DB_USER:-festival}"
DB_HOST="${DB_HOST:-127.0.0.1}"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/fp_${TIMESTAMP}.dump"

# Source credentials from .env
if [ -f "$SCRIPT_DIR/.env" ]; then
  export PGPASSWORD=$(grep '^DATABASE_URL=' "$SCRIPT_DIR/.env" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
fi

if [ -z "$PGPASSWORD" ]; then
  echo "[$(date -Iseconds)] ERROR: Could not extract DB password from .env" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# Create compressed backup
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" --format=custom --compress=6 -f "$BACKUP_FILE" 2>&1

if [ $? -eq 0 ] && [ -s "$BACKUP_FILE" ]; then
    SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
    echo "[$(date -Iseconds)] Backup OK: $BACKUP_FILE ($SIZE)"

    # Clean up old backups
    find "$BACKUP_DIR" -name "fp_*.dump" -mtime +${RETENTION_DAYS} -delete
    REMAINING=$(ls -1 "$BACKUP_DIR"/fp_*.dump 2>/dev/null | wc -l)
    echo "[$(date -Iseconds)] Retention: kept $REMAINING backups (${RETENTION_DAYS}d policy)"
else
    echo "[$(date -Iseconds)] BACKUP FAILED" >&2
    rm -f "$BACKUP_FILE"
    exit 1
fi
