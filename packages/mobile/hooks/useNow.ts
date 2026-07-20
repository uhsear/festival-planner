import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

/**
 * Returns a "now" timestamp (ms since epoch) that refreshes on an interval,
 * so render bodies and useMemo factories can derive time-relative values
 * without calling the impure `Date.now()` directly during render
 * (react-hooks/purity).
 *
 * Backed by ONE module-level clock per distinct `intervalMs` (mirrors the
 * shared-clock singleton in web's `useSetStatus.ts` and this package's own
 * `lib/liveSocket.ts`) instead of a per-call timer: every `useNow(60_000)`
 * caller (e.g. every visible SetCardMobile via `useSetStatus`) now shares one
 * setInterval, created lazily on the first subscriber and cleared once the
 * last one unmounts. A single app-wide AppState listener, ref-counted across
 * every mounted `useNow()` call regardless of intervalMs, replaces what used
 * to be one `AppState.addEventListener` per call site.
 *
 * The default 30s cadence matches the timeline indicator; pass a coarser
 * interval for screens that only need minute-level staleness.
 *
 * iOS suspends JS timers while backgrounded, so the shared AppState listener
 * also snaps the clock to the real time the instant the app returns to the
 * foreground.
 */

interface IntervalBucket {
  timer: ReturnType<typeof setInterval>;
  listeners: Set<() => void>;
}

let _now = Date.now();
const _buckets = new Map<number, IntervalBucket>();
let _appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
let _appStateRefCount = 0;

function createBucket(intervalMs: number): IntervalBucket {
  const listeners = new Set<() => void>();
  const timer = setInterval(() => {
    _now = Date.now();
    for (const listener of listeners) listener();
  }, intervalMs);
  const bucket: IntervalBucket = { timer, listeners };
  _buckets.set(intervalMs, bucket);
  return bucket;
}

/**
 * Shared setInterval registry: one bucket per distinct `intervalMs`, shared
 * by every subscriber at that cadence. Exported (alongside `getNow` and
 * `__resetForTests`) purely so the singleton-sharing behavior has a runnable
 * test — this package's vitest config runs `environment: 'node'` with no
 * React renderer, so `useNow()` itself cannot be rendered here; mocking
 * `react-native` lets the module load, and these plain functions are the
 * same ones `useNow` calls internally.
 */
export function subscribeInterval(intervalMs: number, listener: () => void): () => void {
  const bucket = _buckets.get(intervalMs) ?? createBucket(intervalMs);
  bucket.listeners.add(listener);
  return () => {
    bucket.listeners.delete(listener);
    if (bucket.listeners.size === 0) {
      clearInterval(bucket.timer);
      _buckets.delete(intervalMs);
    }
  };
}

export function getNow(): number {
  return _now;
}

/** Ref-counted app-wide AppState listener shared across every useNow() call. */
function acquireForeground(): () => void {
  _appStateRefCount += 1;
  if (_appStateRefCount === 1) {
    _appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      _now = Date.now();
      for (const bucket of _buckets.values()) {
        for (const listener of bucket.listeners) listener();
      }
    });
  }
  return () => {
    _appStateRefCount -= 1;
    const sub = _appStateSub;
    if (_appStateRefCount === 0 && sub) {
      sub.remove();
      _appStateSub = null;
    }
  };
}

export function useNow(intervalMs = 30_000): number {
  const subscribe = useCallback(
    (listener: () => void) => subscribeInterval(intervalMs, listener),
    [intervalMs],
  );

  const now = useSyncExternalStore(subscribe, getNow, getNow);

  useEffect(() => acquireForeground(), []);

  return now;
}

/** Test-only: clears all shared timers/listeners so tests don't leak into each other. */
export function __resetForTests(): void {
  for (const bucket of _buckets.values()) clearInterval(bucket.timer);
  _buckets.clear();
  if (_appStateSub) _appStateSub.remove();
  _appStateSub = null;
  _appStateRefCount = 0;
  _now = Date.now();
}
