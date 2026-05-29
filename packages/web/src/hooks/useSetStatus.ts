import { useEffect, useMemo, useState } from 'react';
import { FestivalSet } from '@festie/shared/types';
import { getSetStatus } from '@festie/shared/utils';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';

// Status logic now lives in @festie/shared/utils as the single source of truth
// shared with mobile. Re-exported here so existing web imports keep working.
export { getSetStatus } from '@festie/shared/utils';
export type { SetStatus, SetStatusResult } from '@festie/shared/utils';
import type { SetStatusResult } from '@festie/shared/utils';

/**
 * Hook that computes set status relative to current time.
 * Updates on a 60-second interval.
 * Memoized to avoid recomputing on every render.
 */
export function useSetStatus(set: FestivalSet): SetStatusResult;
export function useSetStatus(sets: FestivalSet[]): SetStatusResult[];
export function useSetStatus(sets: FestivalSet | FestivalSet[]): SetStatusResult | SetStatusResult[] {
  const [now, setNow] = useState(() => new Date());
  const days = useFestivalStore((s) => s.days);
  const isSingleSet = !Array.isArray(sets);
  const setsArray = useMemo(() => isSingleSet ? [sets] : sets, [isSingleSet, sets]);

  // Update current time on 60-second interval
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60000); // Update every 60 seconds

    return () => clearInterval(timer);
  }, []);

  // Memoize the computation
  const results = useMemo(() => {
    return setsArray.map((set) => getSetStatus(set, now, days));
  }, [setsArray, now, days]);

  return isSingleSet ? results[0]! : results;
}
