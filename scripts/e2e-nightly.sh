#!/usr/bin/env bash
# Nightly E2E test run against production.
#
# This was silently broken for an unknown period (MODULE_NOT_FOUND every night,
# logged to logs/e2e-nightly.log and read by nobody). TWO independent causes:
#
#   1. `npx playwright` — Playwright is a devDependency and production deploys run
#      `npm install --omit=dev`, so it is absent from the repo's node_modules. npx
#      therefore downloaded a detached copy into ~/.npm/_npx whose sandbox could
#      not resolve `@playwright/test` for playwright.config.cjs line 1.
#   2. The spec path said `festival-planner.spec.js`; the file is `.spec.ts`. Even
#      with Playwright present this would have matched no tests.
#
# Fix: keep a pinned Playwright toolchain OUTSIDE the repo (so `--omit=dev` never
# removes it) and put it on NODE_PATH so the repo's CJS config can resolve
# @playwright/test. Keep PW_VERSION in step with package.json's @playwright/test.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(pwd)"

PW_VERSION="1.59.1"
TOOLCHAIN="${HOME}/.festie-e2e"

if [ ! -x "${TOOLCHAIN}/node_modules/.bin/playwright" ]; then
  echo "[e2e-nightly] provisioning Playwright ${PW_VERSION} toolchain in ${TOOLCHAIN}"
  mkdir -p "${TOOLCHAIN}"
  (
    cd "${TOOLCHAIN}"
    [ -f package.json ] || npm init -y >/dev/null 2>&1
    npm install --no-audit --no-fund --loglevel=error "@playwright/test@${PW_VERSION}"
    # Browsers only; --with-deps would need sudo, which cron does not have.
    ./node_modules/.bin/playwright install chromium
  )
fi

# The repo's playwright.config.cjs does require('@playwright/test'); NODE_PATH lets
# that resolve out of the toolchain even though the repo has no dev dependencies.
export NODE_PATH="${TOOLCHAIN}/node_modules${NODE_PATH:+:${NODE_PATH}}"
export BASE_URL="http://127.0.0.1:4000"

echo "[e2e-nightly] $(date -Is) starting against ${BASE_URL}"
"${TOOLCHAIN}/node_modules/.bin/playwright" test tests/e2e/festival-planner.spec.ts \
  --config="${REPO}/playwright.config.cjs" \
  --reporter=line
status=$?
echo "[e2e-nightly] $(date -Is) finished with exit=${status}"
exit "${status}"
