#!/usr/bin/env node
// DEPRECATED: Use scripts/health-check.sh instead. This script will be removed in a future version.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { createLogger } = require('../lib/logger');

const APP_DIR = path.join(__dirname, '..');
const HEALTH_URL = process.env.HEALTH_URL || 'http://127.0.0.1:4000/api/health';
const FAIL_FILE = '/tmp/festie-health-fails';
const RESTART_THRESHOLD = parseInt(process.env.RESTART_THRESHOLD || process.env.MAX_FAILS || '3');

const logger = createLogger('health-monitor');
const log = (level, message, data = {}) => {
  if (logger[level]) logger[level](message, data);
  else logger.info(message, data);
};

const getFailCount = () => {
  try {
    if (fs.existsSync(FAIL_FILE)) {
      const content = fs.readFileSync(FAIL_FILE, 'utf-8').trim();
      return parseInt(content, 10) || 0;
    }
  } catch (err) {
    log('warn', 'Failed to read fail count', { error: err.message });
  }
  return 0;
};

const setFailCount = (count) => {
  try {
    fs.writeFileSync(FAIL_FILE, String(count), 'utf-8');
  } catch (err) {
    log('warn', 'Failed to write fail count', { error: err.message });
  }
};

const clearFailCount = () => {
  try {
    if (fs.existsSync(FAIL_FILE)) {
      fs.unlinkSync(FAIL_FILE);
    }
  } catch (err) {
    log('warn', 'Failed to clear fail count', { error: err.message });
  }
};

const performHealthCheck = () => {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: 5000 }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const isHealthy = (json.data?.status === 'ok') || (json.status === 'ok');
          resolve({ success: true, healthy: isHealthy, statusCode: res.statusCode });
        } catch (err) {
          resolve({ success: true, healthy: false, statusCode: res.statusCode, error: 'Invalid JSON' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, healthy: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, healthy: false, error: 'Request timeout' });
    });
  });
};

const restartApp = () => {
  try {
    log('info', 'Restarting application via pm2');
    execFileSync('pm2', ['restart', 'festie'], { stdio: 'ignore' });
    clearFailCount();
    log('info', 'Application restarted successfully');
    process.exit(0);
  } catch (err) {
    log('error', 'Failed to restart application', { error: err.message });
    process.exit(1);
  }
};

// Main execution
(async () => {
  try {
    const result = await performHealthCheck();
    const failCount = getFailCount();

    if (result.healthy) {
      // Health check passed
      clearFailCount();
      log('info', 'Health check passed', {
        url: HEALTH_URL,
        statusCode: result.statusCode
      });
      process.exit(0);
    } else {
      // Health check failed
      const newFailCount = failCount + 1;
      setFailCount(newFailCount);

      log('warn', 'Health check failed', {
        url: HEALTH_URL,
        failCount: newFailCount,
        restartThreshold: RESTART_THRESHOLD,
        error: result.error,
        statusCode: result.statusCode
      });

      if (newFailCount >= RESTART_THRESHOLD) {
        log('error', 'Health check threshold reached, restarting application', {
          failCount: newFailCount,
          threshold: RESTART_THRESHOLD
        });
        restartApp();
      } else {
        process.exit(0);
      }
    }
  } catch (err) {
    log('error', 'Health monitor failed', { error: err.message });
    process.exit(1);
  }
})();
