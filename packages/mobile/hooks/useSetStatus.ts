import { useEffect, useMemo, useState } from 'react';
import type { FestivalSet } from '@festie/shared/types';
import { getSetStatus, type SetStatusResult } from '@festie/shared/utils';
import { useFestivalDataStore } from '@festie/shared/stores';

/**
 * Computes a set's live status (LIVE / soon / upcoming / later / past / TBA)
 * relative to the current time, re-evaluating on a 60-second tick. Mirrors the
 * web useSetStatus hook but reads days from mobile's festivalDataStore. The
 * status logic itself is the shared getSetStatus util (single source of truth).
 */
export function useSetStatus(set: FestivalSet): SetStatusResult {
  const [now, setNow] = useState(() => new Date());
  const days = useFestivalDataStore((s) => s.days);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  return useMemo(() => getSetStatus(set, now, days), [set, now, days]);
}
