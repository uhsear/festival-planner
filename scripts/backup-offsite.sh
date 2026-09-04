#!/usr/bin/env bash
set -euo pipefail
# Off-site backup: rsync PostgreSQL dumps to a secondary location
# Configure OFFSITE_TARGET in .env or edit below
# Examples:
#   OFFSITE_TARGET=/mnt/nas/backups/festie
#   OFFSITE_TARGET=user@remote:/backups/festie
#   OFFSITE_TARGET=rclone:s3-bucket/backups/festie

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../.env" 2>/dev/null || true

BACKUP_SRC="${BACKUP_DIR:-$HOME/backups/festie}/"
OFFSITE_TARGET="${OFFSITE_TARGET:-}"
LOG_FILE="${BACKUP_DIR:-$HOME/backups/festie}/offsite.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

if [ -z "$OFFSITE_TARGET" ]; then
  log "WARNING: No off-site backup target configured (OFFSITE_TARGET). Data is at risk from single-host failures."
  log "SKIP: OFFSITE_TARGET not configured in .env"
  exit 0
fi

log "Starting off-site sync to $OFFSITE_TARGET"

if [[ "$OFFSITE_TARGET" == rclone:* ]]; then
  if ! command -v rclone >/dev/null 2>&1; then
    log "ERROR: OFFSITE_TARGET uses rclone: but rclone is not installed. Install it or use an rsync target."
    exit 1
  fi
  rclone sync "$BACKUP_SRC" "$OFFSITE_TARGET" --log-file="$LOG_FILE" --log-level INFO
else
  rsync -az --delete "$BACKUP_SRC" "$OFFSITE_TARGET/" >> "$LOG_FILE" 2>&1
fi

log "Off-site sync completed"
