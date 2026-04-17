#!/usr/bin/env bash
# Phase 5 — On-demand Lighthouse CI run against festie.us.
# Uses Playwright's cached Chromium so we don't pull a second browser.
# Reports: ./lhci-reports/  (created by lhci autorun --upload.target=filesystem)
#
# Usage:
#   bash scripts/lhci-run.sh              # run against festie.us
#   bash scripts/lhci-run.sh localhost    # run against http://localhost:4000
#
# Exit codes propagated from lhci autorun (non-zero on budget/assert failure).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Locate Playwright's chromium and export CHROME_PATH for lhci
PW_CACHE="$HOME/.cache/ms-playwright"
CHROME_BIN="$(find "$PW_CACHE" -maxdepth 4 -type f -name 'headless_shell' 2>/dev/null | head -1)"
if [ -z "$CHROME_BIN" ]; then
  CHROME_BIN="$(find "$PW_CACHE" -maxdepth 4 -type f -name 'chrome' 2>/dev/null | head -1)"
fi

if [ -n "$CHROME_BIN" ]; then
  export CHROME_PATH="$CHROME_BIN"
  echo "[lhci] using chromium at $CHROME_PATH"
else
  echo "[lhci] WARN: no Playwright chromium found; lhci will try to download its own"
fi

CONFIG="${REPO_ROOT}/lighthouserc.json"
if [ "${1:-}" = "localhost" ]; then
  CONFIG="${REPO_ROOT}/lighthouserc.localhost.json"
fi

if ! [ -f "$CONFIG" ]; then
  echo "[lhci] FATAL: config not found at $CONFIG"
  exit 2
fi

npx --yes @lhci/cli@0.14.x autorun --config="$CONFIG"
