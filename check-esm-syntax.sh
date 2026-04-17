#!/bin/bash
# check-esm-syntax.sh — Validates all public JS files as ES modules
# node --check runs in CommonJS mode and misses module-only syntax errors.
# This script pipes each file through node --input-type=module to catch them.

ERRORS=0
DIR="$(dirname "$0")/public"

for f in $(find "$DIR" -name "*.js" -not -path "*/node_modules/*"); do
  if ! node --input-type=module --check < "$f" 2>/dev/null; then
    echo "ESM SYNTAX ERROR: $f"
    node --input-type=module --check < "$f" 2>&1
    ERRORS=$((ERRORS + 1))
  fi
done

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "FAILED: $ERRORS file(s) with ES module syntax errors"
  exit 1
else
  echo "ESM syntax check passed: all public JS files are valid"
  exit 0
fi
