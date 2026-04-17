#!/usr/bin/env bash
set -e
cd /home/asir/festival-planner
TS=$(date +%Y%m%d-%H%M%S)
LOG=logs/lhci/${TS}.log
LOCK=/tmp/lhci-nightly.lock

# Skip if already running
if [ -f "$LOCK" ] && kill -0 "$(cat $LOCK)" 2>/dev/null; then
  echo "lhci-nightly: already running (pid $(cat $LOCK)), skipping" >&2
  exit 0
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

{
  echo "=== lhci-nightly $TS ==="
  npm run lhci:localhost 2>&1 || echo "lhci exited non-zero"
  echo "=== done $(date -Iseconds) ==="
} >> "$LOG" 2>&1

# Retain only last 14 logs
ls -t logs/lhci/*.log 2>/dev/null | tail -n +15 | xargs -r rm -f
