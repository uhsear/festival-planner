import { useMemo } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { useCrewStore } from '../stores/crewStore';
import { buildCrewNudges, CrewNudge } from '../utils/crewNudges';

/**
 * React binding over the pure `buildCrewNudges` aggregation: surfaces sets the
 * active crew has consensus on that the current user hasn't picked, scoped to
 * the selected day. Returns [] when there's no active crew or no profile.
 *
 * Keyed on `currentProfile?.id` (NOT the whole profile object) so toggling your
 * OWN pick — which flips the profile's object identity but not its id — doesn't
 * thrash the memo; it recomputes on `currentProfile?.picks` (your pick set),
 * the roster, and the day. The crew's picks live in `allProfiles`, so that's a
 * dependency too.
 */
export function useCrewNudges(): CrewNudge[] {
  const sets = useFestivalStore((state) => state.sets);
  const days = useFestivalStore((state) => state.days);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const allProfiles = useFestivalStore((state) => state.allProfiles);
  const currentFestival = useFestivalStore((state) => state.currentFestival);

  const activeCrew = useCrewStore((state) => state.activeCrew);
  const crewMembers = useCrewStore((state) => state.crewMembers);

  const currentProfileId = currentProfile?.id;
  const myUserId = currentProfile?.userId;
  const myPicks = currentProfile?.picks;
  const timeZone = currentFestival?.timeZone;

  return useMemo(() => {
    // No active crew or no profile → nothing to nudge.
    if (!activeCrew || !currentProfileId || !myUserId) return [];

    const crewMemberUserIds = new Set(crewMembers.map((m) => m.userId));

    return buildCrewNudges({
      sets,
      selectedDay,
      myPicks: myPicks ?? {},
      allProfiles,
      crewMemberUserIds,
      myUserId,
      now: Date.now(),
      days,
      timeZone,
    });
     
    // stands in for currentProfile to avoid memo thrash on self pick-toggle;
    // myPicks captures the pick changes that DO matter.
  }, [sets, days, selectedDay, currentProfileId, myUserId, myPicks, allProfiles, crewMembers, activeCrew, timeZone]);
}
