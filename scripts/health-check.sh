#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Health check alerting for Festie
#
# Curls /api/health, validates a 200 with valid JSON, tracks consecutive
# failures, sends a webhook notification (or logs) on threshold breach,
# and optionally auto-restarts PM2 after MAX_FAILS.
#
# Run via cron (every 5 minutes):
#   */5 * * * * cd /opt/festie && bash scripts/health-check.sh \
#       >> logs/health-check.log 2>&1
#
# Environment variables:
#   HEALTH_URL          Override the check URL (default: http://127.0.0.1:4000/api/health)
#   ALERT_WEBHOOK_URL   POST webhook for failure notifications (Slack, Discord, ntfy, etc.)
#   MAX_FAILS           Consecutive failures before alerting + restart (default: 3)
#   AUTO_RESTART        Set to "1" to auto-restart PM2 on threshold (default: 1)
# ──────────────────────────────────────────────────────────────────────────────

# ── Configuration ────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/api/health}"
FAIL_FILE="${FAIL_FILE:-/tmp/festie_health_fails}"
MAX_FAILS="${MAX_FAILS:-3}"
AUTO_RESTART="${AUTO_RESTART:-1}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
LOG_DIR="${SCRIPT_DIR}/logs"

mkdir -p "$LOG_DIR"

# ── Helpers ──────────────────────────────────────────────────────────────────

log()  { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }
warn() { log "WARN: $*"; }
fail() { log "FAIL: $*"; }

get_fail_count() {
  if [ -f "$FAIL_FILE" ]; then
    cat "$FAIL_FILE" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

set_fail_count() {
  echo "$1" > "$FAIL_FILE"
}

clear_fail_count() {
  rm -f "$FAIL_FILE"
}

send_alert() {
  local message="$1"
  log "ALERT: $message"

  # Always append to a dedicated alert log
  printf '[%s] %s\n' "$(date -Iseconds)" "$message" >> "${LOG_DIR}/health-alerts.log"

  # Send webhook if configured
  if [ -n "$ALERT_WEBHOOK_URL" ]; then
    local payload
    payload=$(printf '{"text":"Festie Health Alert\\n%s"}' "$message")
    if curl -sf -X POST -H "Content-Type: application/json" \
         -d "$payload" "$ALERT_WEBHOOK_URL" \
         --max-time 10 >/dev/null 2>&1; then
      log "Webhook notification sent"
    else
      warn "Webhook delivery failed (URL: ${ALERT_WEBHOOK_URL})"
    fi
  fi
}

# ── Health check ─────────────────────────────────────────────────────────────

RESPONSE_FILE=$(mktemp)
trap 'rm -f "$RESPONSE_FILE"' EXIT

HTTP_CODE=$(curl -sf -w "%{http_code}" -o "$RESPONSE_FILE" \
  "$HEALTH_URL" --max-time 10 2>/dev/null || echo "000")

HEALTHY=false

if [ "$HTTP_CODE" = "200" ]; then
  # Validate response is parseable JSON with an "ok" or "status" field
  if command -v python3 >/dev/null 2>&1; then
    if python3 -c "
import json, sys
data = json.load(open(sys.argv[1]))
ok = data.get('ok', False) or data.get('status') == 'ok' or (data.get('data', {}) or {}).get('status') == 'ok'
sys.exit(0 if ok else 1)
" "$RESPONSE_FILE" 2>/dev/null; then
      HEALTHY=true
    fi
  elif command -v jq >/dev/null 2>&1; then
    # Fallback: use jq if python3 is unavailable
    if jq -e '(.ok == true) or (.status == "ok") or (.data.status == "ok")' \
         "$RESPONSE_FILE" >/dev/null 2>&1; then
      HEALTHY=true
    fi
  else
    # Last resort: just check it contains valid-looking JSON with "ok" or "status"
    if grep -qE '"(ok|status)"' "$RESPONSE_FILE" 2>/dev/null; then
      HEALTHY=true
    fi
  fi
fi

# ── Evaluate result ──────────────────────────────────────────────────────────

if [ "$HEALTHY" = "true" ]; then
  PREV_FAILS=$(get_fail_count)
  clear_fail_count

  if [ "$PREV_FAILS" -gt 0 ]; then
    log "RECOVERED after ${PREV_FAILS} consecutive failure(s)"
  else
    log "OK (status=${HTTP_CODE})"
  fi
  exit 0
fi

# Failure path
FAILS=$(get_fail_count)
FAILS=$((FAILS + 1))
set_fail_count "$FAILS"

BODY_PREVIEW=$(head -c 200 "$RESPONSE_FILE" 2>/dev/null || echo "(empty)")
fail "status=${HTTP_CODE}, failures=${FAILS}/${MAX_FAILS}, body=${BODY_PREVIEW}"

if [ "$FAILS" -ge "$MAX_FAILS" ]; then
  send_alert "Health check failed ${FAILS} consecutive times (status=${HTTP_CODE}). Host: $(hostname)"

  if [ "$AUTO_RESTART" = "1" ]; then
    log "Auto-restarting PM2 cluster..."
    if cd "$SCRIPT_DIR" && pm2 restart festie 2>&1; then
      log "PM2 restart completed"
    else
      warn "PM2 restart failed -- manual intervention required"
    fi
    clear_fail_count
  fi
fi

exit 1
