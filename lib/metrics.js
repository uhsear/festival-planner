/**
 * Prometheus metrics — opt-in. Safe if prom-client isn't installed
 * (returns a no-op metrics object and /metrics returns 503).
 *
 * Exports:
 *   createMetrics(ctx?) → { registry, httpHistogram, socketGauge, pgPoolGauge, ... }
 *   metricsMiddleware(metrics) → Express middleware that records HTTP latency
 *   metricsHandler(metrics) → Express route handler for GET /metrics
 */

let client = null;
let available = false;
try {
  client = require('prom-client');
  available = true;
} catch {
  client = null;
  available = false;
}

function createMetrics() {
  if (!available) {
    return {
      available: false,
      registry: null,
      httpHistogram: null,
      socketGauge: null,
      pgPoolTotalGauge: null,
      pgPoolIdleGauge: null,
      pgPoolWaitingGauge: null,
      errorCounter: null,
      rateLimitCounter: null,
      authFailuresCounter: null,
      dbQueryHistogram: null,
      rateLimitHitsCounter: null,
    };
  }

  const registry = new client.Registry();
  const workerId = process.env.NODE_APP_INSTANCE !== undefined
    ? String(process.env.NODE_APP_INSTANCE)
    : (process.env.PM_ID !== undefined ? String(process.env.PM_ID) : '0');
  registry.setDefaultLabels({ service: 'festie', worker: workerId });
  client.collectDefaultMetrics({ register: registry, prefix: 'festie_' });

  const httpHistogram = new client.Histogram({
    name: 'festie_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });
  registry.registerMetric(httpHistogram);

  const httpCounter = new client.Counter({
    name: 'festie_http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
  });
  registry.registerMetric(httpCounter);

  const socketGauge = new client.Gauge({
    name: 'festie_socket_connected_clients',
    help: 'Currently connected Socket.IO clients',
  });
  registry.registerMetric(socketGauge);

  const pgPoolTotalGauge = new client.Gauge({
    name: 'festie_pg_pool_total',
    help: 'Total connections in the pg pool',
  });
  const pgPoolIdleGauge = new client.Gauge({
    name: 'festie_pg_pool_idle',
    help: 'Idle connections in the pg pool',
  });
  const pgPoolWaitingGauge = new client.Gauge({
    name: 'festie_pg_pool_waiting',
    help: 'Queries waiting for a pg connection',
  });
  registry.registerMetric(pgPoolTotalGauge);
  registry.registerMetric(pgPoolIdleGauge);
  registry.registerMetric(pgPoolWaitingGauge);

  const errorCounter = new client.Counter({
    name: 'festie_errors_total',
    help: 'Unhandled/captured errors',
    labelNames: ['kind'],
  });
  registry.registerMetric(errorCounter);

  const rateLimitCounter = new client.Counter({
    name: 'festie_rate_limit_hits_total',
    help: 'Rate limit rejections',
    labelNames: ['scope'],
  });
  registry.registerMetric(rateLimitCounter);

  const rateLimitFallbackCounter = new client.Counter({
    name: 'festie_rate_limit_fallback_total',
    help: 'Rate limiter failed-over to in-memory cluster-unaware fallback',
    labelNames: ['tier'],
  });
  registry.registerMetric(rateLimitFallbackCounter);

  // --- fp_* namespace: auth/db/rate-limit observability counters ---
  // Named fp_* to match the web-vitals histogram + future frontend-facing
  // metrics. Coexist with the existing festie_* series (different names).

  const authFailuresCounter = new client.Counter({
    name: 'fp_auth_failures_total',
    help: 'Authentication failures by reason (bad-password, expired-token, locked, ...)',
    labelNames: ['reason'],
  });
  registry.registerMetric(authFailuresCounter);

  const dbQueryHistogram = new client.Histogram({
    name: 'fp_db_query_duration_seconds',
    help: 'Database query duration per store/method',
    labelNames: ['store', 'method'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  });
  registry.registerMetric(dbQueryHistogram);

  const rateLimitHitsCounter = new client.Counter({
    name: 'fp_rate_limit_hits_total',
    help: 'Rate-limit hits by tier and action',
    labelNames: ['tier', 'action'],
  });
  registry.registerMetric(rateLimitHitsCounter);

  return {
    available: true,
    client,
    registry,
    httpHistogram,
    httpCounter,
    socketGauge,
    pgPoolTotalGauge,
    pgPoolIdleGauge,
    pgPoolWaitingGauge,
    errorCounter,
    rateLimitCounter,
    rateLimitFallbackCounter,
    authFailuresCounter,
    dbQueryHistogram,
    rateLimitHitsCounter,
  };
}

/** Express middleware — records timing histogram + counter per request. */
function metricsMiddleware(metrics) {
  if (!metrics || !metrics.available) return (req, res, next) => next();
  return function metricsMw(req, res, next) {
    const end = metrics.httpHistogram.startTimer();
    res.on('finish', () => {
      const route = (req.route && req.route.path) || req.baseUrl || 'unknown';
      const labels = {
        method: req.method,
        route: String(route).slice(0, 120),
        status: String(res.statusCode),
      };
      end(labels);
      metrics.httpCounter.inc(labels);
    });
    next();
  };
}

/** Returns a GET /metrics handler, locked to internal IPs. */
function metricsHandler(metrics) {
  return async function metricsHandlerFn(req, res) {
    if (!metrics || !metrics.available) {
      res.status(503).type('text/plain').send('metrics unavailable (prom-client not installed)');
      return;
    }
    if (!isInternalIp(req)) {
      res.status(403).type('text/plain').send('forbidden');
      return;
    }
    try {
      res.set('Content-Type', metrics.registry.contentType);
      res.end(await metrics.registry.metrics());
    } catch (err) {
      res.status(500).type('text/plain').send(`metrics error: ${err.message}`);
    }
  };
}

function isInternalIp(req) {
  const ip = (req.ip || req.connection?.remoteAddress || '').replace(/^::ffff:/, '');
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  // Cloudflare Tunnel often presents 127.0.0.1; also allow explicit header-based override.
  return false;
}

/** Periodically sample pg pool + socket counts. Returns a stop() function. */
function startMetricsSampler(metrics, { pool, io } = {}, intervalMs = 10_000) {
  if (!metrics || !metrics.available) return () => {};
  const sample = () => {
    try {
      if (pool && typeof pool.totalCount === 'number') {
        metrics.pgPoolTotalGauge.set(pool.totalCount);
        metrics.pgPoolIdleGauge.set(pool.idleCount || 0);
        metrics.pgPoolWaitingGauge.set(pool.waitingCount || 0);
      }
      if (io && io.engine && typeof io.engine.clientsCount === 'number') {
        metrics.socketGauge.set(io.engine.clientsCount);
      }
    } catch { /* ignore sampler errors */ }
  };
  sample();
  const handle = setInterval(sample, intervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  return () => clearInterval(handle);
}

/**
 * Start a dedicated per-worker metrics HTTP listener bound to 127.0.0.1.
 *
 * Rationale: PM2 cluster mode shares the main HTTP port across workers, so
 * scrapes to port 4000 hit a round-robin worker. prom-client AggregatorRegistry
 * requires the cluster primary to orchestrate, but PM2 owns the primary. The
 * simplest correct solution is to have each worker bind its own metrics port
 * (basePort + workerId) and let Prometheus scrape all N targets directly.
 *
 * Only binds to 127.0.0.1. Prometheus must run on the same host or use
 * a reverse proxy with IP allowlist.
 */
function startMetricsListener(metrics, { basePort = 9400, workerId = 0 } = {}) {
  if (!metrics || !metrics.available) return () => {};
  const http = require('http');
  const port = basePort + Number(workerId);
  const handler = async (req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    try {
      res.writeHead(200, { 'Content-Type': metrics.registry.contentType });
      res.end(await metrics.registry.metrics());
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('metrics error: ' + err.message);
    }
  };
  const srv = http.createServer(handler);
  srv.listen(port, '127.0.0.1');
  srv.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') return;
    throw err;
  });
  srv.unref();
  return () => new Promise((resolve) => srv.close(resolve));
}

module.exports = {
  createMetrics,
  metricsMiddleware,
  metricsHandler,
  startMetricsSampler,
  available,
  startMetricsListener,
};
