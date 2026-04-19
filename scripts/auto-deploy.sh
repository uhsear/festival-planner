#!/bin/bash
# Auto-deploy: polls GitHub for new commits and deploys if main has changed.
# Runs via cron every 2 minutes. Only deploys when there are actual changes.

set -e
cd "$(dirname "$0")/.."

# Fetch latest from origin (quiet)
git fetch origin main --quiet 2>/dev/null

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "[$(date -Iseconds)] Deploying: $LOCAL -> $REMOTE"
git pull origin main --quiet

# --- PRE-DEPLOY VALIDATION ---
if ! npm test --silent 2>&1 | tail -5; then
  echo "[$(date -Iseconds)] ABORT: Test suite failed. Not deploying."
  git checkout "$LOCAL" -- .
  exit 1
fi

if ! node scripts/validate-imports.js; then
  echo "[$(date -Iseconds)] ABORT: Import validation failed. Rolling back."
  git checkout "$LOCAL" -- public/
  exit 1
fi

# --- CACHE BUSTING ---
# Use a purely numeric version. Any alphanumeric suffix left by a manual/
# interrupted run is *stripped first* so we don't concatenate stale tokens.
TIMESTAMP=$(date +%s%3N)

# Regex: match ?v= followed by any run of [A-Za-z0-9_.-] (not just digits).
# Using perl because it's consistent across GNU/BSD and handles the char class
# without sed's escaping pitfalls.
find public -type f \( -name '*.html' -o -name '*.js' \) -print0 \
  | xargs -0 perl -pi -e "s/\?v=[A-Za-z0-9_.\-]+/?v=${TIMESTAMP}/g"

# Bump SW cache names — handle ALL existing suffix formats, not just shell-v\d+
perl -pi -e "s/(SHELL_CACHE\s*=\s*['\"])[^'\"]+(['\"])/\${1}shell-${TIMESTAMP}\${2}/g" public/sw.js
perl -pi -e "s/(DATA_CACHE\s*=\s*['\"])[^'\"]+(['\"])/\${1}data-${TIMESTAMP}\${2}/g" public/sw.js
perl -pi -e "s/(SW_VERSION\s*=\s*['\"])[^'\"]+(['\"])/\${1}${TIMESTAMP}\${2}/g" public/sw.js

# --- POST-CACHE-BUST ASSERTIONS ---
# Guardrail 1: exactly ONE distinct ?v= version across all public JS/HTML.
# If multiple, we produced a frankenstate and MUST abort before restarting PM2,
# because duplicate ES module instances cause the "logged-in shows as guest" bug.
DISTINCT=$(find public -type f \( -name '*.html' -o -name '*.js' \) -print0 \
  | xargs -0 grep -rhoE '\?v=[A-Za-z0-9_.\-]+' 2>/dev/null | sort -u)
COUNT=$(echo "$DISTINCT" | grep -c .)
if [ "$COUNT" -gt 1 ]; then
  echo "[$(date -Iseconds)] ABORT: cache-bust produced ${COUNT} distinct ?v= values:"
  echo "$DISTINCT"
  echo "Rolling back public/ and aborting deploy."
  git checkout "$LOCAL" -- public/
  exit 1
fi

# Guardrail 2: SW cache names must reference current TIMESTAMP.
if ! grep -q "shell-${TIMESTAMP}" public/sw.js || ! grep -q "data-${TIMESTAMP}" public/sw.js; then
  echo "[$(date -Iseconds)] ABORT: sw.js cache names did not update to ${TIMESTAMP}"
  grep -E 'SHELL_CACHE|DATA_CACHE|SW_VERSION' public/sw.js
  git checkout "$LOCAL" -- public/
  exit 1
fi

# Guardrail 3: index.html references must match the new ?v=.
if [ "$COUNT" -eq 1 ] && ! grep -q "?v=${TIMESTAMP}" public/index.html; then
  echo "[$(date -Iseconds)] ABORT: index.html ?v= is not ${TIMESTAMP}"
  grep -oE '\?v=[A-Za-z0-9_.\-]+' public/index.html | sort -u
  git checkout "$LOCAL" -- public/
  exit 1
fi

# --- MIGRATIONS ---
# Each migration runs inside its own transaction (--single-transaction) so a
# partial failure rolls back cleanly; we do NOT proceed to PM2 restart on abort.
set -a; . .env; set +a
for f in migrations/*.sql; do
  if ! psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -q -f "$f" >> logs/migrate.log 2>&1; then
    echo "[$(date -Iseconds)] ABORT: migration $f failed; DB rolled back for this file. Not restarting PM2."
    git checkout "$LOCAL" -- public/
    exit 1
  fi
done

# Restart PM2
pm2 restart festie
sleep 5

# Verify health
if curl -sf http://127.0.0.1:4000/api/health | grep -q '"status":"ok"'; then
  echo "[$(date -Iseconds)] Deploy successful: $(git log --oneline -1) [v=${TIMESTAMP}]"
else
  echo "[$(date -Iseconds)] WARNING: Health check failed after deploy"
fi
