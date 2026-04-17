/**
 * Client Performance Metrics — LCP, INP, CLS, render timing, error reporting
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 */

export const perfMetrics = { lcp: 0, inp: 0, cls: 0, renders: 0, renderMs: 0, apiCalls: 0, apiMs: 0 };

export function initMetrics() {
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'largest-contentful-paint') perfMetrics.lcp = Math.round(entry.startTime);
        if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) perfMetrics.cls = Math.round((perfMetrics.cls + entry.value) * 1000) / 1000;
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'event') perfMetrics.inp = Math.max(perfMetrics.inp || 0, entry.duration);
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) perfMetrics.cls = Math.round((perfMetrics.cls + entry.value) * 1000) / 1000;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { /* PerformanceObserver not supported */ }

  window.addEventListener('error', (e) => {
    try {
      navigator.sendBeacon('/api/v1/metrics/client', JSON.stringify({
        type: 'error', message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, timestamp: Date.now(),
      }));
    } catch {}
  });

  window.addEventListener('unhandledrejection', (e) => {
    try {
      navigator.sendBeacon('/api/v1/metrics/client', JSON.stringify({
        type: 'unhandledrejection', message: String(e.reason), timestamp: Date.now(),
      }));
    } catch {}
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && perfMetrics.renders > 0) {
      const body = JSON.stringify({
        ...perfMetrics,
        avgRenderMs: Math.round(perfMetrics.renderMs / perfMetrics.renders),
        ua: navigator.userAgent?.slice(0, 100) || '',
        conn: navigator.connection?.effectiveType || 'unknown',
        ts: Date.now(),
      });
      navigator.sendBeacon?.('/api/v1/metrics/client', new Blob([body], { type: 'application/json' }));
    }
  });
}

export function trackRender(fn) {
  const t0 = performance.now();
  const result = fn();
  perfMetrics.renders++;
  perfMetrics.renderMs += performance.now() - t0;
  return result;
}
