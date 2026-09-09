// ──────────────────────────────────────────────────────────────────────────────
// PM2 Log Rotation Setup (required for production)
//
// Install:    pm2 install pm2-logrotate
// Configure:  pm2 set pm2-logrotate:max_size 50M
//             pm2 set pm2-logrotate:retain 7
//             pm2 set pm2-logrotate:compress true
//
// Verify:     pm2 describe pm2-logrotate
// ──────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [{
    name: 'festie',
    // Run the esbuild bundle, NOT TypeScript source. `npm run build`
    // (scripts/build.mjs) emits dist/server.js plus the two worker entrypoints;
    // dist/ is gitignored, so the deploy builds it on the host (deploy.py step 4).
    // REVERTED to the tsx path. Pointing this at dist/server.js was a LANDMINE:
    // PM2's stored definition kept running server.ts, so production looked fine,
    // but rollback.sh does `pm2 delete` + `pm2 start ecosystem.config.cjs`, which
    // DOES read this file — so a rollback during an incident would have booted an
    // artifact that cannot start, turning a recovery into an outage.
    //
    // Why dist cannot boot under PM2 today (validated on festie-staging, see
    // docs/runbooks/deploy.md): package.json is `type: module`, the build emits
    // ESM, and the bundle contains top-level await, so PM2's require()-based fork
    // container fails with ERR_REQUIRE_ASYNC_MODULE. A generated CommonJS entry
    // clears that specific error but the process still exits 0 about three
    // seconds in, before any application log. Necessary, not sufficient.
    //
    // The prize is still real — routes/export.ts skips its worker-thread export
    // pool when the entry path ends in .ts and falls back to inline export — so
    // this is worth finishing. It is not worth shipping half.
    script: 'server.ts',
    interpreter: 'node_modules/.bin/tsx',

    exec_mode: 'fork',
    // Stays 1. Bundling did NOT unblock cluster mode: lib/email.ts send-idempotency
    // and the two in-memory limiters in routes/email-auth.ts are per-process state.
    instances: 1,
    autorestart: true,
    watch: false,

    // Fork mode doesn't guarantee an IPC channel, and the server only emits
    // process.send('ready') under cluster (isCluster) — so wait_ready would make
    // PM2 kill the healthy process at listen_timeout. Disable it for fork mode.
    wait_ready: false,
    listen_timeout: 15000,

    // Give the shutdown handler time to close server + IO + DB (must exceed SHUTDOWN_TIMEOUT_MS: 30s)
    kill_timeout: 35000,

    // Restart backoff: wait 5s between restart attempts to let TIME_WAIT clear
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: 5000,

    // Headroom for a single fork worker. The bundle drops tsx's in-memory
    // transpile but adds the export worker threads (own heaps), so the net is
    // unmeasured — the ceiling is left where it was rather than guessed at.
    max_memory_restart: '768M',

    // All secrets and credentials loaded from .env via dotenv.
    // FIREBASE_CREDENTIALS_PATH, DATABASE_URL, SESSION_SECRET, WEBHOOK_TOKEN_HMAC_KEY
    // are in .env — do NOT put them here.
    env: {
      NODE_ENV: 'production',
      PUBLIC_ORIGIN: 'https://festie.us',
      ALLOWED_ORIGINS: 'https://festie.us',
      TRUST_PROXY: 'loopback',
      COOKIE_SECURE: 'true',
      COOKIE_SAME_SITE: 'strict',
      BIND_ADDRESS: '127.0.0.1',
      LOG_LEVEL: 'info',
      REDIS_URL: 'redis://127.0.0.1:6379',
      REDIS_ENABLED: 'true',
      CLUSTER_SIZE: '1'
    },

    // Log configuration
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    merge_logs: true,
    time: true,

    // Log rotation (requires pm2-logrotate: pm2 install pm2-logrotate)
    // These are app-level settings; pm2-logrotate module config is set via:
    //   pm2 set pm2-logrotate:max_size    50M
    //   pm2 set pm2-logrotate:retain       14
    //   pm2 set pm2-logrotate:compress    true
    //   pm2 set pm2-logrotate:dateFormat  YYYY-MM-DD_HH-mm-ss
    //   pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
    //   pm2 set pm2-logrotate:workerInterval 30
  }]
};
