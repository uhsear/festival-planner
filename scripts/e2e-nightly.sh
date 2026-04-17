#!/usr/bin/env bash
# Nightly E2E test run against production
set -euo pipefail
cd /home/asir/festival-planner

export BASE_URL="http://127.0.0.1:4000"
npx playwright test tests/e2e/festival-planner.spec.js --reporter=line 2>&1
