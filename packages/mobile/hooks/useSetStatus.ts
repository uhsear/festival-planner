import { useMemo, useSyncExternalStore } from 'react';
import type { FestivalSet } from '@festie/shared/types';
import { getSetStatus, type SetStatusResult } from '@festie/shared/utils';
import { useFestivalDataStore } from '@festie/shared/stores';

// ── Shared 60s clock (mirrors packages/web/src/hooks/useSetStatus.ts) ──────
// One module-level interval shared by every mounted SetCardMobile, instead of
// N independent per-card setIntervals. The interval auto-starts/stops with
// the first/last subscriber.
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

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Computes a set's live status (LIVE / soon / upcoming / later / past / TBA)
 * relative to the current time, re-evaluating on a shared 60-second tick.
 * Mirrors the web useSetStatus hook but reads days from mobile's
 * festivalDataStore. The status logic itself is the shared getSetStatus util.
 */
export function useSetStatus(set: FestivalSet): SetStatusResult {
  const nowMs = useNow();
  const days = useFestivalDataStore((s) => s.days);

  return useMemo(() => getSetStatus(set, new Date(nowMs), days), [set, nowMs, days]);
}
