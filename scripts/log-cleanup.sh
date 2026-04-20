#!/usr/bin/env bash
# Rotate festival-planner application logs (not PM2 logs — pm2-logrotate handles those).
# Keeps last 7 days of deploy.log and migrate.log; truncates if > 10MB.
set -euo pipefail

LOG_DIR="${LOG_DIR:-$(cd "$(dirname "$0")/.." && pwd)/logs}"
MAX_SIZE=$((10 * 1024 * 1024))  # 10MB

for LOG_FILE in deploy.log migrate.log; do
  FULL="$LOG_DIR/$LOG_FILE"
  [ -f "$FULL" ] || continue

  SIZE=$(stat -c%s "$FULL" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt "$MAX_SIZE" ]; then
    # Keep last 1000 lines, archive the rest
    ARCHIVE="$LOG_DIR/${LOG_FILE%.log}_$(date +%Y%m%d_%H%M%S).log"
    cp "$FULL" "$ARCHIVE"
    tail -1000 "$FULL" > "$FULL.tmp" && mv "$FULL.tmp" "$FULL"
    gzip "$ARCHIVE"
    echo "[$(date -Iseconds)] Rotated $LOG_FILE (was ${SIZE} bytes)"
  fi
done

# Purge archived logs older than 7 days
find "$LOG_DIR" -name 'deploy_*.log.gz' -mtime +7 -delete 2>/dev/null || true
find "$LOG_DIR" -name 'migrate_*.log.gz' -mtime +7 -delete 2>/dev/null || true
