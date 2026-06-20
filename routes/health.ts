// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
//
// Health-route composer (2026-04-14 split).
//
// Historically this file contained every liveness / admin / Prometheus
// route on a single router. It was split into three focused modules:
//
//   ./health-core.js    — /health, /metrics/client, /ready, /info
//   ./admin-status.js   — /admin/health, /admin/status, /admin/analytics(/view)
//   ./admin-metrics.js  — /metrics, /cert-pins, /internal/metrics-json
//
// To keep `server.js` byte-identical (it still calls
// `require('./routes/health')(deps)` and mounts the returned router on
// `/api/v1` and `/api`), this module is now a thin composer: it
// instantiates all three sub-factories and mounts them onto a parent
// Express router. Every previous URL continues to resolve exactly as
// before.
//
// The shared client-perf counters (`clientMetrics`, `clientMetricsBuckets`)
// are OWNED by the health-core module — they are mutated in-place by the
// POST /metrics/client handler. We forward the SAME object references
// through `deps` to admin-metrics so the Prometheus exposition reads the
// live counters. Reference identity is load-bearing here.

import { Router } from 'express';
import createHealthCoreRoutes from './health-core.js';
import createAdminStatusRoutes from './admin-status.js';
import createAdminMetricsRoutes from './admin-metrics.js';

export default function createHealthRoutes(deps: any) {
  const router = Router();

  // 1. Health-core owns the client-metrics counters.
  const healthCore = createHealthCoreRoutes(deps);

  // 2. Admin status dashboard — independent of client metrics.
  const adminStatus = createAdminStatusRoutes(deps);

  // 3. Admin metrics (Prometheus) — needs reference-identical counters
  //    from health-core so the exposition sees live writes.
  const adminMetrics = createAdminMetricsRoutes({
    ...deps,
    clientMetrics:        healthCore.clientMetrics,
    clientMetricsBuckets: healthCore.clientMetricsBuckets,
  });

  // Mount all three sub-routers at the root of this composer router.
  // server.js then mounts the whole thing on `/api/v1` and `/api`,
  // yielding identical final URLs to the pre-split implementation.
  router.use('/', healthCore.router);
  router.use('/', adminStatus.router);
  router.use('/', adminMetrics.router);

  return {
    router,
    setReady: healthCore.setReady,
    // Re-expose for any external callers that previously reached into
    // the return object. These are the SAME refs held by admin-metrics,
    // so mutations remain visible everywhere.
    clientMetrics:        healthCore.clientMetrics,
    clientMetricsBuckets: healthCore.clientMetricsBuckets,
  };
}
