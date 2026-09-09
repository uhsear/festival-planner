#!/bin/bash
# Restart the festie app, freeing port 4000 if a previous process is stuck.
#
# Scope: this touches ONLY the app `festie`. It leaves the PM2 daemon and every
# other app (festie-staging, pm2-logrotate) alone. For the harder reset, see
# recover.sh -- and read its warning first.
#
# This script has broken twice in ways worth stating, because both are silent:
#   - It started `ecosystem.config.js`. Only `ecosystem.config.cjs` exists, so
#     step 6 failed while the script carried on to `pm2 save`, persisting a
#     process list with festie DELETED. That destroys the definition a
#     `pm2 resurrect` would restore, turning a restart into an outage that
#     survives a reboot. Nothing is saved now unless the app is actually online.
#   - `pkill -f "node server.js"` matched nothing. The real command line is
#     `node /home/asir/festival-planner/dist/server.js`, and the old pattern
#     required "node" and "server.js" to be adjacent.

set -uo pipefail

APP=festie
APP_DIR=/home/asir/festival-planner
CONFIG=ecosystem.config.cjs
PORT=4000

cd "$APP_DIR" || { echo "FATAL: $APP_DIR not found"; exit 1; }

# The backend is an esbuild bundle now, and dist/ is gitignored, so it exists
# only because someone built it on this host. Starting without it leaves PM2
# crash-looping on a missing file, which looks like an app fault rather than a
# missing artifact. Check before stopping anything.
if [ ! -f "$APP_DIR/dist/server.js" ]; then
    echo "FATAL: dist/server.js is missing. The app boots a built bundle."
    echo "Build it first, then re-run:  cd $APP_DIR && npm run build"
    exit 1
fi

echo "=== Step 1: Stop app (keep daemon) ==="
pm2 stop "$APP" 2>/dev/null || true
sleep 3

echo "=== Step 2: Delete process from PM2 ==="
pm2 delete "$APP" 2>/dev/null || true
sleep 2

echo "=== Step 3: Kill orphan backend process ==="
pkill -9 -f "$APP_DIR/dist/server.js" 2>/dev/null || true
sleep 3

echo "=== Step 4: Force free port $PORT ==="
fuser -k -9 "$PORT/tcp" 2>/dev/null || true
sleep 8

echo "=== Step 5: Verify port free ==="
if fuser "$PORT/tcp" 2>/dev/null; then
    echo "WARNING: Port $PORT still in use!"
    fuser -v "$PORT/tcp" 2>&1
    echo "Trying harder..."
    kill -9 "$(fuser -t "$PORT/tcp" 2>/dev/null)" 2>/dev/null
    sleep 5
fi

echo "=== Step 6: Start fresh ==="
# --only, so a config that ever grows a second app cannot start it by surprise.
# Delete-then-start is also the only sequence that applies a changed `script` or
# `interpreter`; a plain restart re-reads neither.
if ! pm2 start "$CONFIG" --only "$APP"; then
    echo "FATAL: pm2 start failed. $APP is NOT running."
    echo "Deliberately skipping pm2 save, so the resurrect definition survives."
    exit 1
fi
sleep 8

echo "=== Step 7: Status ==="
pm2 list

echo "=== Step 8: Health ==="
HEALTHY=0
curl -sf "http://127.0.0.1:$PORT/api/health" && { echo ""; HEALTHY=1; } || echo "FAILED"

echo "=== Step 9: Save ==="
# Only persist a process list that actually has the app online. Saving a failed
# state is what makes a bad restart survive a reboot.
STATUS=$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);console.log(p?p.pm2_env.status:"missing")}catch{console.log("unknown")}})' "$APP")
if [ "$STATUS" = "online" ]; then
    pm2 save
    echo "saved (status=online, health=$HEALTHY)"
else
    echo "NOT saving: $APP status is '$STATUS', not online."
    echo "Fix the app first; the previous saved list is still intact."
    exit 1
fi

echo "=== DONE ==="
