import { useMemo, useSyncExternalStore } from 'react';
import { FestivalSet } from '@festie/shared/types';
import { getSetStatus, resolveFestivalTimeZone } from '@festie/shared/utils';
import { useFestivalStore, useFestivalDataStore } from '@festie/shared/stores/festivalStore';

// Status logic now lives in @festie/shared/utils as the single source of truth
// shared with mobile. Re-exported here so existing web imports keep working.
export { getSetStatus } from '@festie/shared/utils';
export type { SetStatus, SetStatusResult } from '@festie/shared/utils';
import type { SetStatusResult } from '@festie/shared/utils';

// ── Shared 60s clock ────────────────────────────────────────────────────────
// Previously every SetCard spun up its own 60s setInterval (one per visible
// card = dozens of timers on the cards/timeline views). They now all subscribe
// to a single module-level interval via useSyncExternalStore. The interval only
// runs while at least one consumer is mounted, mirroring the lone nowMs tick in
// routes/timeline.tsx.
const TICK_MS = 60_000;
let _now = Date.now();
const _listeners = new Set<() => void>();
let _timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  _now = Date.now();
  for (const listener of _listeners) listener();
}

function subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  if (_timer === null) {
    _now = Date.now();
    _timer = setInterval(tick, TICK_MS);
  }
  return () => {
    _listeners.delete(listener);
    if (_listeners.size === 0 && _timer !== null) {
      clearInterval(_timer);
      _timer = null;
    }
  };
}

function getSnapshot(): number {
  return _now;
}

/**
 * Shared clock hook: returns the current time in ms, advanced once every 60s by
 * a single module-level interval shared across all consumers. Use this instead
 * of a per-component setInterval when you only need minute-granularity time.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook that computes set status relative to current time.
 * Updates on a shared 60-second clock (see useNow).
 * Memoized to avoid recomputing on every render.
 */
export function useSetStatus(set: FestivalSet): SetStatusResult;
export function useSetStatus(sets: FestivalSet[]): SetStatusResult[];
export function useSetStatus(sets: FestivalSet | FestivalSet[]): SetStatusResult | SetStatusResult[] {
  const nowMs = useNow();
  const days = useFestivalStore((s) => s.days);
  // Validate through the shared resolver so a garbage IANA id can never reach
  // Intl and crash the SetCard/timeline render (undefined → device-local frame).
  const timeZone = useFestivalDataStore((s) => resolveFestivalTimeZone(s.currentFestival));
  const isSingleSet = !Array.isArray(sets);
  const setsArray = useMemo(() => (isSingleSet ? [sets] : sets), [isSingleSet, sets]);

  // Memoize the computation
  const results = useMemo(() => {
    const now = new Date(nowMs);
    return setsArray.map((set) => getSetStatus(set, now, days, timeZone));
  }, [setsArray, nowMs, days, timeZone]);

  return isSingleSet ? results[0]! : results;
}
