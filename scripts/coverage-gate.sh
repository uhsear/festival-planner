#!/usr/bin/env bash
# Coverage gate — fails if statement coverage drops below threshold.
# Run: bash scripts/coverage-gate.sh
# Requires c8: npm install -D c8
set -euo pipefail

THRESHOLD=${1:-40}

echo "Running c8 coverage (threshold: ${THRESHOLD}% statements)..."
npx c8 --reporter=text-summary --check-coverage --lines "$THRESHOLD" --functions 30 \
  node --test --test-force-exit --test-concurrency=1 tests/unit.test.js 2>&1

EXIT=$?
if [ $EXIT -ne 0 ]; then
  echo "COVERAGE GATE FAILED: below ${THRESHOLD}% threshold"
  exit 1
fi
echo "COVERAGE GATE PASSED"
