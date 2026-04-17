#!/usr/bin/env node
'use strict';

/**
 * Error Rate Alert — Lightweight cron-based alerting for Festie
 *
 * Checks the health endpoint and PM2 error logs for elevated error rates.
 * Sends alerts via a webhook URL (Slack, Discord, ntfy, or any HTTP endpoint).
 *
 * Usage:
 *   Check every 5 minutes via cron:
 *   [star]/5 * * * * cd /path/to/festie && node scripts/error-rate-alert.js >> logs/alert.log 2>&1
 *
 * Environment:
 *   ALERT_WEBHOOK_URL   - POST webhook for alerts (required for actual notifications)
 *   ALERT_THRESHOLD     - Error count threshold per window (default: 10)
 *   ALERT_COOLDOWN_MIN  - Minutes between repeat alerts (default: 30)
 *   HEALTH_URL          - Health endpoint URL (default: http://127.0.0.1:4000/api/health)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ── Config ──
const HEALTH_URL = process.env.HEALTH_URL || 'http://127.0.0.1:4000/api/health';
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_THRESHOLD = parseInt(process.env.ALERT_THRESHOLD, 10) || 10;
const ALERT_COOLDOWN_MIN = parseInt(process.env.ALERT_COOLDOWN_MIN, 10) || 30;
const LOG_DIR = path.join(__dirname, '..', 'logs');
const STATE_FILE = path.join(LOG_DIR, '.alert-state.json');

// ── State (persisted between runs) ──
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastAlertAt: 0, lastErrorCount: 0 };
  }
}

function saveState(state) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Health Check ──
function checkHealth(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ ok: res.statusCode === 200 && data?.data?.status === 'ok', status: res.statusCode, body: data });
        } catch {
          resolve({ ok: false, status: res.statusCode, body });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
  });
}

// ── Error Log Analysis ──
function countRecentErrors(windowMinutes = 5) {
  const errorLogPath = path.join(LOG_DIR, 'pm2-error.log');
  if (!fs.existsSync(errorLogPath)) return 0;

  const cutoff = Date.now() - windowMinutes * 60_000;
  const content = fs.readFileSync(errorLogPath, 'utf8');
  const lines = content.split('\n').filter(Boolean);

  let errorCount = 0;
  for (const line of lines) {
    // PM2 error logs have timestamps like "2026-03-18T16:47:56:"
    const tsMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    if (tsMatch) {
      const ts = new Date(tsMatch[1]).getTime();
      if (ts > cutoff) errorCount++;
    }
  }
  return errorCount;
}

// ── PM2 Process Check ──
function checkPM2Processes() {
  const { execSync } = require('child_process');
  try {
    const output = execSync('pm2 jlist 2>/dev/null', { timeout: 5000 }).toString();
    const procs = JSON.parse(output);
    const fpProcs = procs.filter((p) => p.name === 'festie');
    const stopped = fpProcs.filter((p) => p.pm2_env.status !== 'online');
    const highMem = fpProcs.filter((p) => (p.monit?.memory || 0) > 200 * 1024 * 1024); // >200MB
    return {
      total: fpProcs.length,
      online: fpProcs.length - stopped.length,
      stopped: stopped.length,
      highMemory: highMem.length,
      avgMemoryMB: Math.round(fpProcs.reduce((sum, p) => sum + (p.monit?.memory || 0), 0) / fpProcs.length / 1024 / 1024),
    };
  } catch {
    return { total: 0, online: 0, stopped: 0, highMemory: 0, avgMemoryMB: 0 };
  }
}

// ── Alert Sender ──
function sendAlert(message) {
  const timestamp = new Date().toISOString();
  console.log(`[ALERT ${timestamp}] ${message}`);

  if (!ALERT_WEBHOOK_URL) {
    console.log('[ALERT] No ALERT_WEBHOOK_URL configured — logging only');
    return Promise.resolve();
  }

  const payload = JSON.stringify({ text: `🚨 Festie Alert\n${message}` });
  const url = new URL(ALERT_WEBHOOK_URL);
  const mod = url.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const req = mod.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 5000 }, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', (err) => { console.error('[ALERT] webhook failed:', err.message); resolve(); });
    req.write(payload);
    req.end();
  });
}

// ── Main ──
async function main() {
  const state = loadState();
  const alerts = [];

  // 1. Health check
  const health = await checkHealth(HEALTH_URL);
  if (!health.ok) {
    alerts.push(`Health check FAILED (status: ${health.status}, error: ${health.error || 'unhealthy response'})`);
  }

  // 2. Error log count
  const errorCount = countRecentErrors(5);
  if (errorCount >= ALERT_THRESHOLD) {
    alerts.push(`${errorCount} errors in PM2 error log (last 5 minutes, threshold: ${ALERT_THRESHOLD})`);
  }

  // 3. PM2 process health
  const pm2 = checkPM2Processes();
  if (pm2.stopped > 0) {
    alerts.push(`${pm2.stopped}/${pm2.total} PM2 instances are NOT online`);
  }
  if (pm2.highMemory > 0) {
    alerts.push(`${pm2.highMemory}/${pm2.total} instances over 200MB (avg: ${pm2.avgMemoryMB}MB)`);
  }

  // 4. Decide whether to alert
  if (alerts.length > 0) {
    const now = Date.now();
    const cooldownMs = ALERT_COOLDOWN_MIN * 60_000;
    if (now - state.lastAlertAt > cooldownMs) {
      await sendAlert(alerts.join('\n'));
      state.lastAlertAt = now;
    } else {
      console.log(`[SUPPRESSED] ${alerts.length} alert(s) within cooldown window`);
    }
  } else {
    console.log(`[OK ${new Date().toISOString()}] Health: ok, Errors: ${errorCount}, PM2: ${pm2.online}/${pm2.total} online, Mem: ${pm2.avgMemoryMB}MB avg`);
  }

  state.lastErrorCount = errorCount;
  saveState(state);
}

main().catch((err) => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
