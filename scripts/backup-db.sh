#!/bin/bash
# Database backup script for Festie
# Runs via cron: 0 */6 * * * $APP_DIR/scripts/backup-db.sh

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/festival-planner}"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_NAME="${DB_NAME:-festival_planner}"
DB_USER="${DB_USER:-festival}"
DB_HOST="${DB_HOST:-127.0.0.1}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/fp_${TIMESTAMP}.sql.gz.enc"
LOG_FILE="${BACKUP_DIR}/backup.log"

# Retention: 7 daily, 4 weekly
DAILY_KEEP=7
WEEKLY_KEEP=4

# Source credentials from .env
if [ -f "$SCRIPT_DIR/.env" ]; then
  DB_PASS=$(grep '^DATABASE_URL=' "$SCRIPT_DIR/.env" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  BACKUP_KEY=$(grep '^BACKUP_ENCRYPTION_KEY=' "$SCRIPT_DIR/.env" | cut -d= -f2-)
fi

if [ -z "$DB_PASS" ]; then
  echo "[$(date -Iseconds)] ERROR: Could not extract DB password from .env" >> "$LOG_FILE"
  exit 1
fi

if [ -z "$BACKUP_KEY" ]; then
  echo "[$(date -Iseconds)] ERROR: BACKUP_ENCRYPTION_KEY not set in .env" >> "$LOG_FILE"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] Starting backup..." >> "$LOG_FILE"

# Dump, compress, and encrypt (AES-256-CBC)
# Decrypt: openssl enc -aes-256-cbc -d -pbkdf2 -in backup.sql.gz.enc -pass pass:$KEY | gunzip > dump.sql
if PGPASSWORD="$DB_PASS" pg_dump -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" \
  | gzip \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -pass "pass:${BACKUP_KEY}" > "$BACKUP_FILE"; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  # Verify backup isn't empty
  FSIZE=$(stat -c%s "$BACKUP_FILE")
  if [ "$FSIZE" -lt 100 ]; then
    echo "[$(date -Iseconds)] ERROR: Backup file suspiciously small ($SIZE / $FSIZE bytes) - likely empty dump" >> "$LOG_FILE"
    rm -f "$BACKUP_FILE"
    exit 1
  fi
  echo "[$(date -Iseconds)] Backup complete: $BACKUP_FILE ($SIZE)" >> "$LOG_FILE"
else
  echo "[$(date -Iseconds)] ERROR: Backup failed!" >> "$LOG_FILE"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Prune old daily backups (keep last 7 days)
find "$BACKUP_DIR" -name "fp_*.sql.gz.enc" -mtime +${DAILY_KEEP} -not -name "fp_*_weekly.sql.gz.enc" -delete 2>/dev/null

# Tag Sunday backups as weekly
DOW=$(date +%u)
if [ "$DOW" = "7" ]; then
  WEEKLY_FILE="${BACKUP_DIR}/fp_${TIMESTAMP}_weekly.sql.gz.enc"
  cp "$BACKUP_FILE" "$WEEKLY_FILE"
  echo "[$(date -Iseconds)] Weekly backup: $WEEKLY_FILE" >> "$LOG_FILE"
fi

# Prune old weekly backups (keep last 4)
ls -t "$BACKUP_DIR"/fp_*_weekly.sql.gz.enc 2>/dev/null | tail -n +$((WEEKLY_KEEP + 1)) | xargs rm -f 2>/dev/null

echo "[$(date -Iseconds)] Backup rotation complete" >> "$LOG_FILE"
