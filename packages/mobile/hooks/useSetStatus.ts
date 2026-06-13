import { useMemo } from 'react';
import type { FestivalSet } from '@festie/shared/types';
import { getSetStatus, resolveFestivalTimeZone, type SetStatusResult } from '@festie/shared/utils';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useNow } from './useNow';

/**
 * Computes a set's live status (LIVE / soon / upcoming / later / past / TBA)
 * relative to the current time, re-evaluating on a 60-second tick via the shared
 * `useNow` hook (which also snaps to the real clock on app foreground). Mirrors
 * the web useSetStatus hook but reads days from mobile's festivalDataStore. The
 * status logic itself is the shared getSetStatus util.
 */
export function useSetStatus(set: FestivalSet): SetStatusResult {
  const nowMs = useNow(60_000);
  const days = useFestivalDataStore((s) => s.days);
  // Validate through the shared resolver so a garbage IANA id can never reach
  // Intl and crash the render (undefined → device-local frame).
  const timeZone = useFestivalDataStore((s) => resolveFestivalTimeZone(s.currentFestival));

  return useMemo(() => getSetStatus(set, new Date(nowMs), days, timeZone), [set, nowMs, days, timeZone]);
}
