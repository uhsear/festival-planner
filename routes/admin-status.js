// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
//
// Admin status & analytics routes (split from routes/health.js on 2026-04-14):
//   GET /admin/health              — JSON system status (admin-auth)
//   GET /admin/status              — HTML dashboard (admin-auth, strict nonce CSP)
//   GET /admin/analytics           — aggregated festival analytics JSON (admin-auth)
//   GET /admin/analytics/view      — HTML analytics dashboard (admin-auth, strict nonce CSP)
//
// The strict nonce CSP helper lives here because both HTML routes in this
// file need it. If a third file ever needs the same policy, promote it to
// lib/csp-helpers.js.
const { renderAnalyticsDashboard } = require('../lib/analytics-template');

module.exports = function createAdminStatusRoutes(deps) {
  const {
    express,
    adminAuth, setNoStore,
    getUsers, getFestivals, getProfiles, io, stores, state, pool,
    sendSuccess, sendError, ErrorCodes, log,
  } = deps;

  const router = express.Router();

  // Strict nonce-based CSP for HTML routes served from this module. Replaces
  // an earlier per-route CSP that whitelisted 'unsafe-inline' and silently
  // undermined the global nonce policy (audit fix 2026-04-14). Any inline
  // <style>/<script> in these handlers must carry `nonce="${cspNonce}"`.
  function buildStrictNonceCSP(nonce) {
    const nonceDir = nonce ? `'nonce-${nonce}'` : "'self'";
    return [
      "default-src 'self'",
      `script-src 'self' ${nonceDir}`,
      `style-src 'self' ${nonceDir}`,
      "img-src 'self' data: https:",
      "connect-src 'self' wss: https:",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
      'upgrade-insecure-requests',
    ].join('; ');
  }

  router.get('/admin/health', adminAuth, async (req, res) => {
    setNoStore(res);
    const mem = process.memoryUsage();

    const metrics = deps.metrics;

    // PostgreSQL connection pool stats
    const pgPool = pool || stores?.pool;
    const poolStats = pgPool ? {
      totalCount: pgPool.totalCount,
      idleCount: pgPool.idleCount,
      waitingCount: pgPool.waitingCount,
    } : null;

    return sendSuccess(res, {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      },
      connections: io.engine?.clientsCount || 0,
      users: (await getUsers()).length,
      festivals: (await getFestivals()).length,
      profiles: (await getProfiles()).length,
      onlineRooms: state.onlineUsers.size,
      rateLimits: {
        api: state.rateLimits.size,
        auth: state.authRateLimits.size,
        adminAuth: state.adminAuthRateLimits.size,
        socketConnect: state.socketConnectRateLimits?.size || 0,
      },
      database: poolStats,
      requests: metrics ? {
        total: metrics.totalRequests,
        errors: metrics.totalErrors,
        avgDurationMs: metrics.requestCount > 0
          ? Math.round(metrics.totalDuration / metrics.requestCount)
          : 0,
        statusCodes: { ...metrics.statusCodes },
      } : null,
      sockets: metrics ? {
        totalConnections: metrics.socketConnections || 0,
        totalDisconnections: metrics.socketDisconnections || 0,
        transportErrors: metrics.socketErrors || 0,
        peakConcurrent: metrics.peakConnections || 0,
      } : null,
      startedAt: metrics?.startedAt || null,
    });
  });

  // Admin status page — HTML dashboard view
  router.get('/admin/status', adminAuth, async (req, res) => {
    setNoStore(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    const cspNonce = res.locals.cspNonce || '';
    res.setHeader('Content-Security-Policy', buildStrictNonceCSP(cspNonce));

    const mem = process.memoryUsage();
    const uptime = Math.round(process.uptime());
    const connections = io.engine?.clientsCount || 0;
    const metrics = deps.metrics;
    const workerId = process.pid;

    // Format uptime as human-readable
    const uptimeStr = (() => {
      const days = Math.floor(uptime / 86400);
      const hours = Math.floor((uptime % 86400) / 3600);
      const mins = Math.floor((uptime % 3600) / 60);
      const secs = uptime % 60;
      if (days > 0) return `${days}d ${hours}h ${mins}m`;
      if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
      if (mins > 0) return `${mins}m ${secs}s`;
      return `${secs}s`;
    })();

    const nonceAttr = cspNonce ? ` nonce="${cspNonce}"` : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Festie - Admin Status</title>
  <style${nonceAttr}>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0f0f0f;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    header {
      border-bottom: 1px solid #333;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    h1 {
      font-size: 28px;
      margin-bottom: 8px;
    }
    .timestamp {
      color: #999;
      font-size: 14px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
    }
    .card h2 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #999;
      margin-bottom: 12px;
      border-bottom: 1px solid #333;
      padding-bottom: 8px;
    }
    .stat {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid #222;
    }
    .stat:last-child {
      border-bottom: none;
    }
    .stat-label {
      color: #999;
      font-size: 13px;
    }
    .stat-value {
      font-weight: 600;
      font-size: 16px;
      color: #fff;
      font-family: "Courier New", monospace;
    }
    .status-ok { color: #4ade80; }
    .status-warning { color: #facc15; }
    .status-critical { color: #ef4444; }
    footer {
      text-align: center;
      padding-top: 20px;
      border-top: 1px solid #333;
      color: #666;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Festie Admin Status</h1>
      <div class="timestamp">${new Date().toISOString()}</div>
    </header>

    <div class="grid">
      <div class="card">
        <h2>Server</h2>
        <div class="stat">
          <span class="stat-label">Uptime</span>
          <span class="stat-value">${uptimeStr}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Worker ID (PID)</span>
          <span class="stat-value">${workerId}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Status</span>
          <span class="stat-value status-ok">✓ Healthy</span>
        </div>
      </div>

      <div class="card">
        <h2>Memory</h2>
        <div class="stat">
          <span class="stat-label">RSS</span>
          <span class="stat-value">${Math.round(mem.rss / 1024 / 1024)} MB</span>
        </div>
        <div class="stat">
          <span class="stat-label">Heap Used</span>
          <span class="stat-value">${Math.round(mem.heapUsed / 1024 / 1024)} MB</span>
        </div>
        <div class="stat">
          <span class="stat-label">Heap Total</span>
          <span class="stat-value">${Math.round(mem.heapTotal / 1024 / 1024)} MB</span>
        </div>
      </div>

      <div class="card">
        <h2>Connections</h2>
        <div class="stat">
          <span class="stat-label">Active WebSocket</span>
          <span class="stat-value">${connections}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Online Users</span>
          <span class="stat-value">${state.onlineUsers.size}</span>
        </div>
      </div>

      <div class="card">
        <h2>Data</h2>
        <div class="stat">
          <span class="stat-label">Total Users</span>
          <span class="stat-value">${(await getUsers()).length}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Total Festivals</span>
          <span class="stat-value">${(await getFestivals()).length}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Total Profiles</span>
          <span class="stat-value">${(await getProfiles()).length}</span>
        </div>
      </div>

      ${metrics ? `
      <div class="card">
        <h2>Requests</h2>
        <div class="stat">
          <span class="stat-label">Total</span>
          <span class="stat-value">${metrics.totalRequests}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Errors</span>
          <span class="stat-value ${metrics.totalErrors > 0 ? 'status-warning' : ''}">${metrics.totalErrors}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Avg Duration</span>
          <span class="stat-value">${metrics.requestCount > 0 ? Math.round(metrics.totalDuration / metrics.requestCount) : 0}ms</span>
        </div>
      </div>

      <div class="card">
        <h2>Socket.IO</h2>
        <div class="stat">
          <span class="stat-label">Total Connections</span>
          <span class="stat-value">${metrics.socketConnections || 0}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Peak Concurrent</span>
          <span class="stat-value">${metrics.peakConnections || 0}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Transport Errors</span>
          <span class="stat-value ${(metrics.socketErrors || 0) > 0 ? 'status-warning' : ''}">${metrics.socketErrors || 0}</span>
        </div>
      </div>
      ` : ''}
    </div>

    <footer>
      <p>Festie Server Status Dashboard</p>
    </footer>
  </div>
</body>
</html>`;

    return res.send(html);
  });

  // Admin Analytics Dashboard — aggregated stats for festival management
  router.get('/admin/analytics', adminAuth, async (req, res) => {
    try {
      setNoStore(res);
      // eslint-disable-next-line no-shadow
      const pool = deps.pool || stores?.pool;
      if (!pool) return res.json({ data: null, error: { message: 'Database not available' } });

      // Most-picked sets (top 20)
      const topSetsResult = await pool.query(`
        SELECT fs.artist, fs.stage_id AS "stageId", fs.start_time AS "startTime", fs.end_time AS "endTime",
               fs.day_index AS "dayIndex", fs.festival_id AS "festivalId",
               COUNT(*) AS "pickCount",
               COUNT(*) FILTER (WHERE fpp.priority = 'must') AS "mustCount",
               COUNT(*) FILTER (WHERE fpp.priority = 'want-to-see') AS "wantCount",
               COUNT(*) FILTER (WHERE fpp.priority = 'maybe') AS "maybeCount"
        FROM festival_profile_picks fpp
        JOIN festival_sets fs ON fpp.set_id = fs.id
        JOIN festival_profiles fp ON fpp.profile_id = fp.id AND fp.deleted_at IS NULL
        GROUP BY fs.id, fs.artist, fs.stage_id, fs.start_time, fs.end_time, fs.day_index, fs.festival_id
        ORDER BY "pickCount" DESC
        LIMIT 20
      `);

      // Active users (users with picks, ordered by last activity)
      const activeUsersResult = await pool.query(`
        SELECT u.id, u.username, u.avatar_key AS "avatarKey",
               COUNT(DISTINCT fp.id) AS "profileCount",
               COUNT(fpp.set_id) AS "totalPicks",
               MAX(fp.updated_at) AS "lastActive"
        FROM users u
        JOIN festival_profiles fp ON fp.user_id = u.id AND fp.deleted_at IS NULL
        LEFT JOIN festival_profile_picks fpp ON fpp.profile_id = fp.id
        WHERE u.deleted_at IS NULL
        GROUP BY u.id, u.username, u.avatar_key
        ORDER BY "lastActive" DESC NULLS LAST
        LIMIT 50
      `);

      // Crew sizes
      const crewsResult = await pool.query(`
        SELECT c.id, c.name, c.festival_id AS "festivalId",
               COUNT(cm.user_id) AS "memberCount",
               c.created_at AS "createdAt"
        FROM crews c
        LEFT JOIN crew_members cm ON cm.crew_id = c.id
        GROUP BY c.id, c.name, c.festival_id, c.created_at
        ORDER BY "memberCount" DESC
        LIMIT 20
      `);

      // Festival-level stats
      const festivalStatsResult = await pool.query(`
        SELECT f.id, f.name,
               COUNT(DISTINCT fp.id) AS "profileCount",
               COUNT(DISTINCT fpp.set_id) AS "uniqueSetsPicked",
               COUNT(fpp.*) AS "totalPicks"
        FROM festivals f
        LEFT JOIN festival_profiles fp ON fp.festival_id = f.id AND fp.deleted_at IS NULL
        LEFT JOIN festival_profile_picks fpp ON fpp.profile_id = fp.id
        WHERE f.deleted_at IS NULL
        GROUP BY f.id, f.name
        ORDER BY "profileCount" DESC
      `);

      return sendSuccess(res, {
          topSets: topSetsResult.rows,
          activeUsers: activeUsersResult.rows.map(u => ({
            ...u,
            avatarKey: undefined, // don't expose avatar keys
          })),
          crews: crewsResult.rows,
          festivalStats: festivalStatsResult.rows,
          generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      log.error('analytics query failed', { error: error.message });
      return sendError(res, 500, 'Failed to load analytics', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Admin Analytics Dashboard — HTML view
  router.get('/admin/analytics/view', adminAuth, async (req, res) => {
    try {
      setNoStore(res);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // AUDIT FIX (2026-04-14): the previous per-route CSP whitelisted
      // 'unsafe-inline' for both script-src and style-src, which defeated
      // the global nonce-based policy. Replace with a strict nonce CSP.
      // renderAnalyticsDashboard must emit inline <style>/<script> tags with
      // nonce="${res.locals.cspNonce}"; any remaining inline without a nonce
      // will be blocked (which is the intended failure mode).
      res.setHeader('Content-Security-Policy', buildStrictNonceCSP(res.locals.cspNonce || ''));

      const origin = deps.config.PUBLIC_ORIGIN || '';
      return res.send(renderAnalyticsDashboard(origin, { nonce: res.locals.cspNonce || '' }));
    } catch (error) {

      log.error('analytics view error', { error: error.message });
      return res.status(500).send('Failed to load analytics dashboard');
    }
  });

  // Satisfy lint — express is destructured for parity with siblings but only
  // express.Router() is consumed directly above.
  void express;

  return { router };
};
