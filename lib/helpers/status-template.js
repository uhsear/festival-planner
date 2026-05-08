// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

/**
 * Renders the admin status HTML dashboard page.
 * Extracted from routes/admin-status.js to keep route handlers lean.
 *
 * @param {object} data - Status data for the template
 * @param {string} data.nonceAttr - CSP nonce attribute string (e.g. ' nonce="abc"')
 * @param {string} data.uptimeStr - Human-readable uptime string
 * @param {number} data.workerId - Process PID
 * @param {object} data.mem - process.memoryUsage() result
 * @param {number} data.connections - Active WebSocket connections
 * @param {number} data.onlineUsers - Online user count
 * @param {number} data.totalUsers - Total user count
 * @param {number} data.totalFestivals - Total festival count
 * @param {number} data.totalProfiles - Total profile count
 * @param {object|null} data.metrics - Server metrics object (may be null)
 * @returns {string} Full HTML page
 */
function renderStatusPage(data) {
  const {
    nonceAttr, uptimeStr, workerId, mem, connections,
    onlineUsers, totalUsers, totalFestivals, totalProfiles, metrics,
  } = data;

  return `<!DOCTYPE html>
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
          <span class="stat-value status-ok">&#10003; Healthy</span>
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
          <span class="stat-value">${onlineUsers}</span>
        </div>
      </div>

      <div class="card">
        <h2>Data</h2>
        <div class="stat">
          <span class="stat-label">Total Users</span>
          <span class="stat-value">${totalUsers}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Total Festivals</span>
          <span class="stat-value">${totalFestivals}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Total Profiles</span>
          <span class="stat-value">${totalProfiles}</span>
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
}

module.exports = { renderStatusPage };
