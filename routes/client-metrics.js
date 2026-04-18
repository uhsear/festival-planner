/**
 * Client web-vitals beacon — accepts LCP/CLS/INP/FCP/TTFB metrics from web-vitals
 * beacons, validates ranges, and records them into a Prometheus histogram.
 *
 * sendBeacon sends body as Blob/text (no JSON content-type), so the route is
 * mounted with express.text() in server.js and we parse manually here.
 *
 * POST /api/v1/metrics/web-vitals  (body = JSON string)
 *   { name, value, rating, delta, id, url, navigationType }
 *
 * Metric names recorded: CLS, LCP, FCP, INP, TTFB. Values outside sane ranges
 * are dropped. Responds 204 regardless (beacon fire-and-forget).
 */
"use strict";

// Sane upper bounds (seconds for timing metrics, unitless for CLS).
// web-vitals ships LCP/FCP/INP/TTFB in milliseconds; we convert to seconds
// for histogram recording so all timing buckets share a unit.
const VALID_METRICS = Object.freeze({
  CLS:   { min: 0, max: 10,     unitDivisor: 1 },    // unitless layout-shift score
  LCP:   { min: 0, max: 60_000, unitDivisor: 1000 }, // ms -> s
  FCP:   { min: 0, max: 60_000, unitDivisor: 1000 }, // ms -> s
  INP:   { min: 0, max: 60_000, unitDivisor: 1000 }, // ms -> s
  TTFB:  { min: 0, max: 60_000, unitDivisor: 1000 }, // ms -> s
});

module.exports = function createClientMetricsRoutes(deps) {
  const { express, log, rateLimit, promMetrics } = deps;
  const router = express.Router();

  const noop = (_req, _res, next) => next();
  const limiter = typeof rateLimit === "function" ? rateLimit(120, "web-vitals") : noop;

  // Lazily register the web-vitals histogram on the shared registry the first
  // time this route loads. `promMetrics` is the object returned by
  // lib/metrics.js createMetrics() (distinct from deps.metrics, which is the
  // legacy in-memory request-count counter on state).
  let webVitalsHistogram = null;
  if (promMetrics && promMetrics.available && promMetrics.client && promMetrics.registry) {
    const existing = promMetrics.registry.getSingleMetric("fp_web_vitals_seconds");
    if (existing) {
      webVitalsHistogram = existing;
    } else {
      webVitalsHistogram = new promMetrics.client.Histogram({
        name: "fp_web_vitals_seconds",
        help: "Client-reported web-vitals (CLS unitless, others seconds)",
        labelNames: ["metric", "nav"],
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5, 2, 2.5, 4, 6, 10],
      });
      promMetrics.registry.registerMetric(webVitalsHistogram);
    }
  }

  router.post("/web-vitals", limiter, (req, res) => {
    let payload = req.body;
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch (_) { payload = null; }
    }
    if (!payload || typeof payload !== "object") {
      return res.status(204).end();
    }

    const { name, value, rating, delta, id, url, navigationType } = payload;
    if (typeof name !== "string" || typeof value !== "number" || !Number.isFinite(value)) {
      return res.status(204).end();
    }

    const spec = VALID_METRICS[name];
    if (!spec) return res.status(204).end();
    if (value < spec.min || value > spec.max) return res.status(204).end();

    const recorded = value / spec.unitDivisor;
    const nav = typeof navigationType === "string" && navigationType.length <= 32
      ? navigationType
      : "unknown";

    if (webVitalsHistogram) {
      try { webVitalsHistogram.observe({ metric: name, nav }, recorded); } catch (_) { /* swallow */ }
    }

    log.info({
      msg: "web-vitals",
      metric: name,
      value,
      rating: rating || null,
      delta: typeof delta === "number" ? delta : null,
      id: typeof id === "string" ? id.slice(0, 64) : null,
      nav,
      url: typeof url === "string" ? url.slice(0, 128) : null,
    });

    return res.status(204).end();
  });

  return router;
};
