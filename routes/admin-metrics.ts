// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
//
// Prometheus-compatible metrics exposition + cert-pin + internal metrics JSON.
// Split out of routes/health.js on 2026-04-14 to isolate the large
// `/metrics` builder and keep health.js focused on liveness.
//
//   GET /metrics                   — Prometheus text exposition (admin-auth)
//   GET /cert-pins                 — public cert-pin hashes for mobile clients
//   GET /internal/metrics-json     — localhost-only metrics JSON (cron use)
//
// The client-side Web-Vitals counters (`clientMetrics`, `clientMetricsBuckets`)
// are OWNED by routes/health.js and passed in via `deps` — see its return
// object. They are optional; if absent, the client-perf block is skipped.

import { Router } from 'express';

export default function createAdminMetricsRoutes(deps: any): { router: Router } {
  const {
    adminAuth, setNoStore, log,
    getUsers: _getUsers, getFestivals, getProfiles, io, stores, state, pool,
    sendSuccess, sendError, ErrorCodes,
  } = deps;

  const router = Router();
  const config = deps.config;

  // Shared client-perf counters (set by routes/health.js on POST /metrics/client).
  // Optional — default to empty shapes so the exposition logic is safe when the
  // health module hasn't been wired (e.g. isolated test harness).
  const clientMetrics = deps.clientMetrics || { samples: 0, lcpSum: 0, fidSum: 0, clsSum: 0, renderMsSum: 0, renderCount: 0 };
  const clientMetricsBuckets = deps.clientMetricsBuckets || { lcp_under_2500: 0, lcp_over_2500: 0, fid_under_100: 0, fid_over_100: 0, render_under_500: 0, render_over_500: 0 };

  // Prometheus-compatible metrics endpoint for monitoring tools
  router.get('/metrics', adminAuth, async (req: any, res: any) => {
    try {
    setNoStore(res);
    const metrics = deps.metrics;
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const connections = io.engine?.clientsCount || 0;

    const lines = [
      '# HELP fp_uptime_seconds Time since server start',
      '# TYPE fp_uptime_seconds gauge',
      `fp_uptime_seconds ${Math.round(uptime)}`,
      '# HELP fp_memory_rss_bytes Resident set size',
      '# TYPE fp_memory_rss_bytes gauge',
      `fp_memory_rss_bytes ${mem.rss}`,
      '# HELP fp_memory_heap_used_bytes Heap used',
      '# TYPE fp_memory_heap_used_bytes gauge',
      `fp_memory_heap_used_bytes ${mem.heapUsed}`,
      '# HELP fp_websocket_connections Active WebSocket connections',
      '# TYPE fp_websocket_connections gauge',
      `fp_websocket_connections ${connections}`,
      '# HELP fp_users_total Total registered users',
      '# TYPE fp_users_total gauge',
      `fp_users_total ${await stores.users.countActive()}`,
      '# HELP fp_festivals_total Total festivals',
      '# TYPE fp_festivals_total gauge',
      `fp_festivals_total ${(await getFestivals()).length}`,
      '# HELP fp_profiles_total Total profiles',
      '# TYPE fp_profiles_total gauge',
      `fp_profiles_total ${(await getProfiles()).length}`,
      '# HELP fp_online_rooms Active festival rooms',
      '# TYPE fp_online_rooms gauge',
      `fp_online_rooms ${state.onlineUsers.size}`,
    ];

    if (metrics) {
      lines.push(
        '# HELP fp_http_requests_total Total HTTP requests',
        '# TYPE fp_http_requests_total counter',
        `fp_http_requests_total ${metrics.totalRequests}`,
        '# HELP fp_http_errors_total Total HTTP errors',
        '# TYPE fp_http_errors_total counter',
        `fp_http_errors_total ${metrics.totalErrors}`,
        '# HELP fp_http_duration_avg_ms Average request duration',
        '# TYPE fp_http_duration_avg_ms gauge',
        `fp_http_duration_avg_ms ${metrics.requestCount > 0 ? Math.round(metrics.totalDuration / metrics.requestCount) : 0}`,
        '# HELP fp_socket_connections_total Total socket connections since start',
        '# TYPE fp_socket_connections_total counter',
        `fp_socket_connections_total ${metrics.socketConnections || 0}`,
        '# HELP fp_socket_peak_concurrent Peak concurrent connections',
        '# TYPE fp_socket_peak_concurrent gauge',
        `fp_socket_peak_concurrent ${metrics.peakConnections || 0}`,
      );
      for (const [bucket, count] of Object.entries(metrics.statusCodes || {})) {
        lines.push(`fp_http_requests_total{status="${bucket}"} ${count}`);
      }
    }

    // Per-endpoint latency (P1.5)
    if (metrics.endpointLatency) {
      lines.push(
        '# HELP fp_endpoint_latency_avg_ms Per-endpoint average latency',
        '# TYPE fp_endpoint_latency_avg_ms gauge',
        '# HELP fp_endpoint_latency_max_ms Per-endpoint max latency',
        '# TYPE fp_endpoint_latency_max_ms gauge',
        '# HELP fp_endpoint_requests_total Per-endpoint request count',
        '# TYPE fp_endpoint_requests_total counter',
      );
      for (const [endpoint, stats] of Object.entries(metrics.endpointLatency) as [string, any][]) {
        const avg = stats.count > 0 ? Math.round(stats.totalMs / stats.count) : 0;
        const safeLabel = endpoint.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        lines.push(
          `fp_endpoint_latency_avg_ms{endpoint="${safeLabel}"} ${avg}`,
          `fp_endpoint_latency_max_ms{endpoint="${safeLabel}"} ${stats.maxMs}`,
          `fp_endpoint_requests_total{endpoint="${safeLabel}"} ${stats.count}`,
        );
      }
    }

    // Auth failure metric (P2.13)
    if (metrics.authFailures !== undefined) {
      lines.push(
        '# HELP fp_auth_failures_total Total failed login attempts',
        '# TYPE fp_auth_failures_total counter',
        `fp_auth_failures_total ${metrics.authFailures}`,
      );
    }

    // Add rate limit telemetry
    lines.push(
      '# HELP fp_rate_limit_entries Active rate limit entries',
      '# TYPE fp_rate_limit_entries gauge',
      `fp_rate_limit_entries_api ${state.rateLimits.size || 0}`,
      `fp_rate_limit_entries_auth ${state.authRateLimits.size || 0}`,
      `fp_rate_limit_entries_socket ${state.socketConnectRateLimits?.size || 0}`,
    );

    // PostgreSQL connection pool metrics
    const pgPool = pool || stores?.pool;
    if (pgPool) {
      lines.push(
        '# HELP fp_pg_pool_total Total connections in pool',
        '# TYPE fp_pg_pool_total gauge',
        `fp_pg_pool_total ${pgPool.totalCount}`,
        '# HELP fp_pg_pool_idle Idle connections in pool',
        '# TYPE fp_pg_pool_idle gauge',
        `fp_pg_pool_idle ${pgPool.idleCount}`,
        '# HELP fp_pg_pool_waiting Clients waiting for a connection',
        '# TYPE fp_pg_pool_waiting gauge',
        `fp_pg_pool_waiting ${pgPool.waitingCount}`,
      );
    }

    // Add violation telemetry
    if (metrics?.rateLimitViolations) {
      lines.push(
        '# HELP fp_rate_limit_violations Total rate limit violations',
        '# TYPE fp_rate_limit_violations counter',
        `fp_rate_limit_violations ${metrics.rateLimitViolations}`,
      );
    }

    // Database query latency (P2.12)
    const dbTracker = deps.dbLatencyTracker;
    if (dbTracker?.stats) {
      lines.push(
        '# HELP fp_db_query_avg_ms Database query average latency',
        '# TYPE fp_db_query_avg_ms gauge',
        '# HELP fp_db_query_max_ms Database query max latency',
        '# TYPE fp_db_query_max_ms gauge',
        '# HELP fp_db_query_total Database query count',
        '# TYPE fp_db_query_total counter',
      );
      for (const [op, stats] of Object.entries(dbTracker.stats) as [string, any][]) {
        const avg = stats.count > 0 ? Math.round((stats.totalMs / stats.count) * 100) / 100 : 0;
        const safeOp = op.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        lines.push(
          `fp_db_query_avg_ms{op="${safeOp}"} ${avg}`,
          `fp_db_query_max_ms{op="${safeOp}"} ${Math.round(stats.maxMs * 100) / 100}`,
          `fp_db_query_total{op="${safeOp}"} ${stats.count}`,
        );
      }
    }

    // Client-side Web Vitals + render performance
    if (clientMetrics.samples > 0) {
      const avgLcp = Math.round(clientMetrics.lcpSum / clientMetrics.samples);
      const avgFid = Math.round(clientMetrics.fidSum / clientMetrics.samples);
      const avgCls = Math.round(clientMetrics.clsSum / clientMetrics.samples * 1000) / 1000;
      const avgRender = clientMetrics.renderCount > 0 ? Math.round(clientMetrics.renderMsSum / clientMetrics.samples) : 0;
      lines.push(
        '# HELP fp_client_lcp_avg_ms Average Largest Contentful Paint',
        '# TYPE fp_client_lcp_avg_ms gauge',
        `fp_client_lcp_avg_ms ${avgLcp}`,
        '# HELP fp_client_fid_avg_ms Average First Input Delay',
        '# TYPE fp_client_fid_avg_ms gauge',
        `fp_client_fid_avg_ms ${avgFid}`,
        '# HELP fp_client_cls_avg Average Cumulative Layout Shift',
        '# TYPE fp_client_cls_avg gauge',
        `fp_client_cls_avg ${avgCls}`,
        '# HELP fp_client_render_avg_ms Average render() duration',
        '# TYPE fp_client_render_avg_ms gauge',
        `fp_client_render_avg_ms ${avgRender}`,
        '# HELP fp_client_samples Total client metric samples',
        '# TYPE fp_client_samples counter',
        `fp_client_samples ${clientMetrics.samples}`,
        '# HELP fp_client_lcp_slo LCP SLO bucket counts',
        '# TYPE fp_client_lcp_slo counter',
        `fp_client_lcp_slo{le="2500"} ${clientMetricsBuckets.lcp_under_2500}`,
        `fp_client_lcp_slo{le="+Inf"} ${clientMetricsBuckets.lcp_under_2500 + clientMetricsBuckets.lcp_over_2500}`,
        '# HELP fp_client_render_slo Render SLO bucket counts',
        '# TYPE fp_client_render_slo counter',
        `fp_client_render_slo{le="500"} ${clientMetricsBuckets.render_under_500}`,
        `fp_client_render_slo{le="+Inf"} ${clientMetricsBuckets.render_under_500 + clientMetricsBuckets.render_over_500}`,
      );
    }

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return res.send(lines.join('\n') + '\n');
    } catch (error: any) {
      log.error('metrics endpoint failed', { error: error.message });
      return sendError(res, 500, 'Failed to generate metrics', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Certificate Pinning — public key pin hashes for mobile clients
  router.get('/cert-pins', (req: any, res: any) => {
    const pinConfig = {
      primary: config.CERT_PIN_PRIMARY || '',
      backup: config.CERT_PIN_BACKUP || '',
    };

    // Only expose pins if at least one is configured
    if (!pinConfig.primary && !pinConfig.backup) {
      return sendError(res, 503, 'Certificate pinning not configured', ErrorCodes.SERVICE_UNAVAILABLE);
    }

    res.setHeader('Cache-Control', 'public, max-age=86400');
    return sendSuccess(res, {
      cert_pins: pinConfig,
      timestamp: new Date().toISOString(),
    });
  });

  // Internal metrics JSON endpoint — localhost-only, no auth required.
  // Used by scripts/metrics-rollup.js cron job.
  router.get('/internal/metrics-json', (req: any, res: any) => {
    // Only allow requests from localhost — use the raw TCP peer address so this
    // check cannot be bypassed via X-Forwarded-For when TRUST_PROXY is enabled.
    const ip = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!isLocal) return sendError(res, 403, 'Localhost only', ErrorCodes.FORBIDDEN);
    setNoStore(res);
    const metrics = deps.metrics || {};
    return sendSuccess(res, {
      totalRequests: metrics.totalRequests || 0,
      totalErrors: metrics.totalErrors || 0,
      totalDuration: metrics.totalDuration || 0,
      requestCount: metrics.requestCount || 0,
      statusCodes: metrics.statusCodes ? { ...metrics.statusCodes } : {},
      socketConnections: metrics.socketConnections || 0,
      peakConnections: metrics.peakConnections || 0,
      dbLatency: deps.dbLatencyTracker?.stats || {},
    });
  });

  return { router };
}
