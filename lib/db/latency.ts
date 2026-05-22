const SLOW_QUERY_THRESHOLD_MS = 500;

interface LatencyStats {
  [key: string]: { count: number; totalMs: number; maxMs: number };
}

// P2.12: Database query latency tracker
// Wraps store methods to collect timing data for the /metrics endpoint
// P3.5: Slow query logging — warns on queries exceeding threshold
export function createDbLatencyTracker(log: any) {
  const stats: LatencyStats = {}; // { storeName.method: { count, totalMs, maxMs } }

  function track(storeName: string, methodName: string, fn: Function) {
    const key = `${storeName}.${methodName}`;
    return async function (this: any, ...args: any[]) {
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

  function wrapStore(storeName: string, store: Record<string, any>) {
    const wrapped: Record<string, any> = {};
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
