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
    script: 'server.ts',
    // Run TypeScript via Node + tsx loader. interpreter must be set explicitly:
    // PM2 v6 auto-selects `bun` for .ts scripts, which isn't installed.
    interpreter: 'node',
    // Fork mode (not cluster): PM2 cluster mode imports the script through its
    // ProcessContainer without the tsx ESM loader applied, so it can't load the
    // .ts entrypoint. Fork mode spawns `node --import tsx/esm server.ts` directly
    // (identical to `npm start`), which works. Multi-worker scaling would require
    // compiling the backend to JS first.
    exec_mode: 'fork',
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

    max_memory_restart: '384M',

    // Match Node's old-space ceiling to PM2's max_memory_restart so V8 GCs
    // aggressively before PM2 SIGKILLs the worker. Prevents mid-request kills.
    node_args: '--import tsx/esm --max-old-space-size=384',

    // All secrets and credentials loaded from .env via dotenv.
    // FIREBASE_CREDENTIALS_PATH, DATABASE_URL, SESSION_SECRET, WEBHOOK_TOKEN_HMAC_KEY
    // are in .env — do NOT put them here.
    env: {
      NODE_ENV: 'production',
      PUBLIC_ORIGIN: 'https://festie.us',
      ALLOWED_ORIGINS: 'https://festie.us',
      TRUST_PROXY: 'true',
      COOKIE_SECURE: 'true',
      COOKIE_SAME_SITE: 'strict',
      BIND_ADDRESS: '127.0.0.1',
      LOG_LEVEL: 'info',
      REDIS_URL: 'redis://127.0.0.1:6379',
      REDIS_ENABLED: 'true',
      CLUSTER_SIZE: '4'
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
