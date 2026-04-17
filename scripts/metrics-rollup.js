#!/usr/bin/env node
'use strict';

/**
 * Metrics rollup cron — runs hourly to persist in-memory metrics to PostgreSQL.
 * Cron: 0 * * * * cd /path/to/festie && node scripts/metrics-rollup.js
 */

const { Pool } = require('pg');

// Load .env if DATABASE_URL not already set (cron doesn't inherit env)
if (!process.env.DATABASE_URL) {
  const envPath = require('path').join(__dirname, '..', '.env');
  const envContent = require('fs').readFileSync(envPath, 'utf8');
  const match = envContent.match(/^DATABASE_URL=(.*)$/m);
  if (match) process.env.DATABASE_URL = match[1].trim();
}
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/festival_planner';

async function rollup() {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    // Fetch current metrics from the health endpoint
    const http = require('http');
    // Use internal metrics endpoint (localhost-only, no auth required)
    const data = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:4000/api/internal/metrics-json', (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
    });

    const now = new Date();
    const bucketStart = new Date(now);
    bucketStart.setMinutes(0, 0, 0);
    const bucketEnd = new Date(bucketStart.getTime() + 3600000);

    const metrics = data.data || data;
    const statusCodes = metrics.statusCodes || {};

    await pool.query(`
      INSERT INTO metrics_rollups (bucket_start, bucket_end, total_requests, total_errors, avg_duration_ms, status_2xx, status_4xx, status_5xx, peak_connections, active_users)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT DO NOTHING
    `, [
      bucketStart.toISOString(),
      bucketEnd.toISOString(),
      metrics.totalRequests || 0,
      metrics.totalErrors || 0,
      metrics.requestCount > 0 ? (metrics.totalDuration / metrics.requestCount) : 0,
      statusCodes['2xx'] || 0,
      statusCodes['4xx'] || 0,
      statusCodes['5xx'] || 0,
      metrics.peakConnections || 0,
      metrics.socketConnections || 0,
    ]);

    console.log(`[metrics-rollup] Persisted rollup for ${bucketStart.toISOString()}`);
  } catch (err) {
    console.error(`[metrics-rollup] Error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

rollup();
