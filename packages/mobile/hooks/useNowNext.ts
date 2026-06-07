import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useFestivalDataStore } from '@festie/shared/stores';
import { getSetTimeBounds } from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';

/** A picked set resolved to absolute epoch-ms bounds + its priority. */
export interface NowNextSet {
  set: FestivalSet;
  start: number;
  end: number;
  priority: Priority;
}

export interface NowNext {
  /** Current wall-clock time, re-synced every 60s and on foreground. */
  now: Date;
  /** The user's picked sets playing right now (may overlap across stages). */
  current: NowNextSet[];
  /** The soonest upcoming picked sets, ascending by start time. */
  upcoming: NowNextSet[];
}

/**
 * P1-2 — the shared "Now & Next" live-day selector.
 *
 * Resolves the current profile's picked sets to TZ-safe epoch bounds (via the
 * shared {@link getSetTimeBounds}, incl. post-midnight rollover) and splits them
 * into what's playing NOW vs. what's UP NEXT against the wall clock. Drives both
 * the full festival-mode screen and the compact home-screen Now & Next strip so
 * the two surfaces can never drift.
 *
 * On-device + offline-honest: no network — purely the cached set model + picks.
 * The 60s tick keeps the now/next split fresh; an AppState listener re-syncs the
 * clock on foreground because JS timers are suspended while backgrounded.
 *
 * @param upcomingLimit how many upcoming sets to return (default 5).
 */
export function useNowNext(upcomingLimit = 5): NowNext {
  const sets = useFestivalDataStore((s) => s.sets) as FestivalSet[];
  const days = useFestivalDataStore((s) => s.days);
  const picks = useFestivalDataStore((s) => s.currentProfile?.picks);

  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    // iOS suspends JS timers while backgrounded, so the now/up-next split goes
    // stale. Re-sync to the wall clock the moment the app is foregrounded.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  return useMemo<NowNext>(() => {
    if (!picks || !sets.length || !days.length) {
      return { now, current: [], upcoming: [] };
    }
    const nowMs = now.getTime();
    const timed: NowNextSet[] = [];
    for (const s of sets) {
      const priority = picks[s.id];
      if (!priority) continue;
      // Shared TZ-safe bounds (incl. post-midnight rollover); null = TBA.
      const bounds = getSetTimeBounds(s, days);
      if (!bounds) continue;
      timed.push({ set: s, start: bounds.startMs, end: bounds.endMs, priority });
    }
    return {
      now,
      current: timed.filter((x) => x.start <= nowMs && x.end > nowMs).sort((a, b) => a.end - b.end),
      upcoming: timed
        .filter((x) => x.start > nowMs)
        .sort((a, b) => a.start - b.start)
        .slice(0, upcomingLimit),
    };
  }, [picks, sets, days, now, upcomingLimit]);
}
