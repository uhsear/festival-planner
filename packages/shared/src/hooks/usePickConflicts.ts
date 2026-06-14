import { useMemo } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { buildPickConflicts, ConflictGroup } from '../utils/pickConflicts';
import { resolveFestivalTimeZone } from '../utils/festivalTime';

/**
 * React binding over the pure `buildPickConflicts`: surfaces the set-time
 * clashes among the current user's OWN picks, scoped to the selected day, so
 * web and mobile can render an identical "you can't be in two places at once"
 * banner. Returns [] when there's no profile or no clashes.
 *
 * Mirrors `useCrewNudges`: keyed on `currentProfile?.id` (NOT the whole profile
 * object) so toggling a pick — which flips the profile's object identity but not
 * its id — doesn't thrash the memo; it recomputes on `currentProfile?.picks`
 * (the pick set), `sets`, `days`, `selectedDay`, and the festival time zone.
 *
 * Crew context is intentionally omitted here (no `allProfiles` / crew ids
 * threaded) — this is the personal clash banner; `useCrewNudges` covers crew
 * consensus separately.
 */
export function usePickConflicts(): ConflictGroup[] {
  const sets = useFestivalStore((state) => state.sets);
  const days = useFestivalStore((state) => state.days);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const currentFestival = useFestivalStore((state) => state.currentFestival);

  const currentProfileId = currentProfile?.id;
  const myPicks = currentProfile?.picks;
  const timeZone = resolveFestivalTimeZone(currentFestival);

  return useMemo(() => {
    if (!currentProfileId) return [];

    return buildPickConflicts({
      sets,
      myPicks: myPicks ?? {},
      selectedDay,
      days,
      timeZone,
    });
    // currentProfileId stands in for currentProfile to avoid memo thrash on
    // self pick-toggle; myPicks captures the pick changes that DO matter.
  }, [sets, days, selectedDay, currentProfileId, myPicks, timeZone]);
}
