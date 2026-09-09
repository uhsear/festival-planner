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

  # Rebuild the backend bundle. `dist/` is gitignored, so the reset above restores
  # SOURCE only and leaves whatever bundle was on disk — the one built from the
  # code you are rolling back FROM. Without this step a rollback restarts the very
  # release you are trying to escape, and it does so silently: /api/ready returns
  # 200 because that new code runs fine.
  #
  # Both builds run BEFORE anything touches PM2, on purpose. Under `set -e` a
  # build failure aborts here with the app still serving the current release,
  # which is strictly better than stopping it and then discovering it cannot start.
  echo "[rollback] rebuilding backend bundle..."
  npm run build

  echo "[rollback] rebuilding web bundle..."
  ( cd packages && pnpm --filter @festie/web build )

  # Delete then start, NOT `pm2 restart`. Measured on 2026-09-09 against
  # festie-staging: with the config file changed from dist/server.js + node back
  # to server.ts + tsx, `pm2 restart <config file> --only <name>` updated the
  # INTERPRETER but left the SCRIPT at its stored value, leaving tsx interpreting
  # the esbuild bundle — a state matching neither the config nor the previous
  # release, with /api/ready still 200. An earlier comment here claimed that
  # command re-reads the file; it does not. deploy.py:173 has it right: restarting
  # by name or by file re-reads the ENV only, and only delete + start applies a
  # changed `script` or `interpreter`.
  #
  # This does leave nothing running if the start fails, which is why the builds
  # above come first and why the readiness check below is a hard failure.
  echo "[rollback] restarting pm2 app '${PM2_NAME}' from ecosystem.config.cjs..."
  pm2 delete "${PM2_NAME}" || true
  pm2 start ecosystem.config.cjs --only "${PM2_NAME}"
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
