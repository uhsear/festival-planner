#!/usr/bin/env bash
# Assert that all public/ assets reference a single, uniform ?v= version,
# and that sw.js cache names match. Exit 0 if clean, 1 if divergent.
# Safe to run standalone (pre-deploy check) or from fp-quality-gate.
set -euo pipefail

ROOT="${1:-/home/asir/festival-planner}"
PUB="${ROOT}/public"

if [ ! -d "$PUB" ]; then
  echo "[assert-cachebust] ERROR: $PUB does not exist"
  exit 2
fi

# 1. Collect distinct ?v= versions across all JS/HTML
DISTINCT=$(find "$PUB" -type f \( -name '*.html' -o -name '*.js' \) -print0 \
  | xargs -0 grep -hoE '\?v=[A-Za-z0-9_.\-]+' 2>/dev/null | sort -u)
COUNT=$(printf '%s\n' "$DISTINCT" | grep -c . || true)

if [ "${COUNT:-0}" -gt 1 ]; then
  echo "[assert-cachebust] FAIL: ${COUNT} distinct ?v= versions in public/:"
  printf '%s\n' "$DISTINCT"
  echo "[assert-cachebust] This causes duplicate ES module instances and"
  echo "[assert-cachebust] post-login state divergence (guest badge stuck)."
  exit 1
fi

if [ "${COUNT:-0}" -eq 0 ]; then
  echo "[assert-cachebust] WARN: no ?v= references found in public/"
  exit 0
fi

CURRENT=$(printf '%s' "$DISTINCT" | sed 's/^?v=//')
echo "[assert-cachebust] single version: $CURRENT"

# 2. Cross-check SW cache names match (if sw.js exists)
SW="${PUB}/sw.js"
if [ -f "$SW" ]; then
  SHELL=$(grep -oE 'SHELL_CACHE\s*=\s*"[^"]+"' "$SW" | head -1 || true)
  DATA=$(grep -oE 'DATA_CACHE\s*=\s*"[^"]+"' "$SW" | head -1 || true)
  if ! echo "$SHELL" | grep -q "$CURRENT"; then
    echo "[assert-cachebust] WARN: sw.js SHELL_CACHE does not reference $CURRENT"
    echo "  $SHELL"
  fi
  if ! echo "$DATA" | grep -q "$CURRENT"; then
    echo "[assert-cachebust] WARN: sw.js DATA_CACHE does not reference $CURRENT"
    echo "  $DATA"
  fi
fi

# 3. index.html must reference the version
IDX="${PUB}/index.html"
if [ -f "$IDX" ] && ! grep -q "?v=$CURRENT" "$IDX"; then
  echo "[assert-cachebust] FAIL: index.html does not reference ?v=$CURRENT"
  grep -oE '\?v=[A-Za-z0-9_.\-]+' "$IDX" | sort -u
  exit 1
fi

echo "[assert-cachebust] OK"
exit 0
