#!/bin/bash
# Health monitor for Festie
# Run via cron: */5 * * * * /path/to/scripts/health-check.sh

HEALTH_URL="http://127.0.0.1:4000/api/health"
FAIL_FILE="/tmp/fp_health_fails"
MAX_FAILS=3

STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$HEALTH_URL" --max-time 5 2>/dev/null)

if [ "$STATUS" = "200" ]; then
    rm -f "$FAIL_FILE"
else
    FAILS=$(cat "$FAIL_FILE" 2>/dev/null || echo 0)
    FAILS=$((FAILS + 1))
    echo "$FAILS" > "$FAIL_FILE"
    echo "[$(date -Iseconds)] Health check FAILED (status=$STATUS) - failure $FAILS/$MAX_FAILS"

    if [ "$FAILS" -ge "$MAX_FAILS" ]; then
        echo "[$(date -Iseconds)] Auto-restarting PM2 after $MAX_FAILS consecutive failures..."
        cd "$(dirname "$0")/.." && pm2 restart all
        rm -f "$FAIL_FILE"
    fi
fi
