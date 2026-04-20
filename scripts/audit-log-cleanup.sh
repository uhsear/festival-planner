#!/usr/bin/env bash
# audit-log-cleanup.sh
# Monthly cron: prune audit_log rows older than RETENTION_DAYS.
# Simpler alternative to partitioning (028_audit_log_partitioning_plan.sql).
# Date: 2026-04-14
#
# Install (on the application host):
#   chmod +x "$APP_DIR/scripts/audit-log-cleanup.sh"
#   crontab -e
#   # Run at 04:17 on the 1st of every month (off-peak):
#   17 4 1 * * $APP_DIR/scripts/audit-log-cleanup.sh \
#       >> $HOME/logs/audit-log-cleanup.log 2>&1
#
# Env (set in cron or $HOME/.env):
#   PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD  (standard libpq vars)
#   RETENTION_DAYS    default 90
#   BATCH_SIZE        default 5000  (rows per DELETE chunk)
#   MAX_BATCHES       default 200   (safety cap: 200 * 5000 = 1M rows/run)
#   DRY_RUN           "1" to print the SQL without executing

set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-90}"
BATCH_SIZE="${BATCH_SIZE:-5000}"
MAX_BATCHES="${MAX_BATCHES:-200}"
DRY_RUN="${DRY_RUN:-0}"
PGDATABASE="${PGDATABASE:-festival_planner}"

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }

log "audit-log-cleanup start retention=${RETENTION_DAYS}d batch=${BATCH_SIZE} max_batches=${MAX_BATCHES} dry_run=${DRY_RUN}"

# Pre-flight: row count and oldest row
PRE_STATS=$(psql -X -A -t -F'|' -c "
  SELECT COUNT(*), COALESCE(MIN(created_at)::text, 'n/a')
    FROM audit_log
   WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days';
")
PRE_COUNT="${PRE_STATS%%|*}"
PRE_OLDEST="${PRE_STATS##*|}"
log "candidates: ${PRE_COUNT} rows older than ${RETENTION_DAYS}d (oldest=${PRE_OLDEST})"

if [[ "${PRE_COUNT}" -eq 0 ]]; then
  log "nothing to prune; exiting."
  exit 0
fi

if [[ "${DRY_RUN}" == "1" ]]; then
  log "DRY_RUN=1 — not executing DELETE. Would run batched:"
  log "  DELETE FROM audit_log WHERE ctid IN ("
  log "    SELECT ctid FROM audit_log"
  log "     WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'"
  log "     LIMIT ${BATCH_SIZE}"
  log "  );"
  exit 0
fi

# Batched delete: bounded work per transaction, keeps bloat & lock time sane.
TOTAL_DELETED=0
for ((i = 1; i <= MAX_BATCHES; i++)); do
  DEL=$(psql -X -A -t -c "
    WITH victims AS (
      SELECT ctid
        FROM audit_log
       WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'
       LIMIT ${BATCH_SIZE}
    )
    DELETE FROM audit_log
     WHERE ctid IN (SELECT ctid FROM victims)
    RETURNING 1;
  " | wc -l | tr -d '[:space:]')

  TOTAL_DELETED=$((TOTAL_DELETED + DEL))

  if [[ "${DEL}" -eq 0 ]]; then
    log "batch ${i}: 0 rows, done."
    break
  fi
  log "batch ${i}: deleted ${DEL} rows (running total ${TOTAL_DELETED})"

  # tiny pause lets replicas & autovacuum breathe
  sleep 1
done

# Post stats
POST_COUNT=$(psql -X -A -t -c "SELECT COUNT(*) FROM audit_log;")
log "done: deleted ${TOTAL_DELETED} rows total; table now ${POST_COUNT} rows."

# Reclaim bloat opportunistically (non-blocking in PG 12+).
# VACUUM (not FULL) — keeps the table online.
psql -X -c "VACUUM (VERBOSE, ANALYZE) audit_log;" || log "WARN: VACUUM failed (non-fatal)"

log "audit-log-cleanup complete."
