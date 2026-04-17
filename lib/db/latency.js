'use strict';

const SLOW_QUERY_THRESHOLD_MS = 500;

// P2.12: Database query latency tracker
// Wraps store methods to collect timing data for the /metrics endpoint
// P3.5: Slow query logging — warns on queries exceeding threshold
function createDbLatencyTracker(log) {
  const stats = {}; // { storeName.method: { count, totalMs, maxMs } }

  function track(storeName, methodName, fn) {
    const key = `${storeName}.${methodName}`;
    return async function (...args) {
      const start = performance.now ? performance.now() : Date.now();
      const result = await fn.apply(this, args);
      const duration = (performance.now ? performance.now() : Date.now()) - start;
      if (!stats[key]) stats[key] = { count: 0, totalMs: 0, maxMs: 0 };
      stats[key].count++;
      stats[key].totalMs += duration;
      if (duration > stats[key].maxMs) stats[key].maxMs = duration;
      if (duration > SLOW_QUERY_THRESHOLD_MS && log) {
        log.warn('slow query', { store: storeName, method: methodName, durationMs: Math.round(duration), args: args.length });
      }
      return result;
    };
  }

  function wrapStore(storeName, store) {
    const wrapped = {};
    for (const [key, value] of Object.entries(store)) {
      if (typeof value === 'function') {
        wrapped[key] = track(storeName, key, value);
      } else {
        wrapped[key] = value;
      }
    }
    return wrapped;
  }

  return { stats, wrapStore };
}

module.exports = { createDbLatencyTracker };
