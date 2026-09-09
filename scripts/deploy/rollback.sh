#!/usr/bin/env bash
# Copyright (c) 2026 Asir Khan. All rights reserved.
# All Rights Reserved. See the LICENSE file.
#
# Festie rollback (P14). RUNS ON THE SERVER, inside the app dir.
#
# Resets the working tree to a previously-tagged deploy, rebuilds the backend
# bundle and the web bundle, and restarts the PM2 app. Each successful deploy
# pushes a `deploy-<UTC timestamp>` tag (see scripts/deploy/deploy.py), so rolling back
# is: pick the last known-good tag and run this.
#
# Usage (on the box):
#   cd /home/asir/festival-planner
#   bash scripts/deploy/rollback.sh deploy-20260611-180000
#
# List available tags:
#   git tag -l 'deploy-*' | sort
#
# NOTE: This does NOT roll back database migrations. Festie migrations are
# additive + idempotent by convention, so a rolled-back app runs fine against a
# forward schema. If a deploy shipped a destructive migration, restore from
# backup (see docs/runbooks/deploy.md) — do not rely on this script for that.

set -euo pipefail

# Everything runs inside main() on purpose. This script does `git reset --hard`
# on its own working tree, and bash reads a script by byte offset as it goes:
# if the file changes size mid-run, execution resumes at that offset in the new
# bytes and the remaining steps are silently skipped, exit code 0. Defining a
# function makes bash parse the entire body before running a line of it, so a
# rollback across any commit that touched this file still rebuilds and restarts.
main() {

  TAG="${1:-}"
  PM2_NAME="${FESTIE_PM2_NAME:-festie}"

  if [ -z "$TAG" ]; then
    echo "usage: bash scripts/deploy/rollback.sh <deploy-tag>" >&2
    echo "available tags:" >&2
    git tag -l 'deploy-*' | sort >&2
    exit 2
  fi

  echo "[rollback] fetching tags..."
  git fetch origin --tags

  if ! git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
    echo "[rollback] ERROR: tag '${TAG}' not found." >&2
    echo "available tags:" >&2
    git tag -l 'deploy-*' | sort >&2
    exit 2
  fi

  echo "[rollback] resetting working tree to ${TAG}..."
  git reset --hard "${TAG}"
  git log --oneline -1

  # No backend rebuild: PM2 runs server.ts under tsx, which the reset above
  # restores directly. When the dist cutover lands this must come back, because
  # dist/ is gitignored and a reset cannot revert it — a rollback would otherwise
  # restart the bundle built from the code you are rolling back FROM. Building
  # here today would only risk aborting the rollback under `set -e`.

  echo "[rollback] rebuilding web bundle..."
  ( cd packages && pnpm --filter @festie/web build )

  # Restart from the CONFIG FILE, not the name. `pm2 restart <name>` re-launches
  # the definition already stored in the daemon and never re-reads
  # ecosystem.config.cjs, so a rollback across the tsx->dist cutover would keep the
  # wrong `script` and `interpreter`. Passing the file routes through pm2's
  # _startJson, which re-reads it and restarts the already-running app in place —
  # unlike delete+start, which leaves nothing running if the start then fails.
  echo "[rollback] restarting pm2 app '${PM2_NAME}' from ecosystem.config.cjs..."
  pm2 restart ecosystem.config.cjs --only "${PM2_NAME}"
  pm2 save || true
  sleep 5
  pm2 ls | grep "${PM2_NAME}" || true

  echo "[rollback] checking /api/ready..."
  READY_URL="${FESTIE_READY_URL:-http://localhost:4000/api/ready}"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "${READY_URL}")"
  echo "[rollback] /api/ready -> ${CODE}"
  if [ "${CODE}" != "200" ]; then
    echo "[rollback] WARNING: /api/ready is ${CODE} after rollback — investigate immediately." >&2
    exit 1
  fi

  echo "[rollback] done — now on ${TAG}."
}

main "$@"
