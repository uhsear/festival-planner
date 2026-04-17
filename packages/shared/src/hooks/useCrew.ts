import { useCallback, useMemo } from 'react';
import { useCrewStore } from '../stores/crewStore';
import { useFestivalStore } from '../stores/festivalStore';
import { Profile, Priority } from '../types';

export interface UseCrewReturn {
  getCrewScopedProfiles: () => Profile[];
  getCrewScopedOtherPicks: (
    setId: string,
  ) => Array<{ profileId: string; priority: Priority }>;
}

export function useCrew(): UseCrewReturn {
  const crewMembers = useCrewStore((state) => state.crewMembers);
  const allProfiles = useFestivalStore((state) => state.allProfiles);
  const currentProfile = useFestivalStore((state) => state.currentProfile);

  const getCrewScopedProfiles = useCallback(() => {
    const crewMemberIds = new Set(crewMembers.map((m) => m.userId));
    return allProfiles.filter((p) => crewMemberIds.has(p.userId));
  }, [crewMembers, allProfiles]);

  const getCrewScopedOtherPicks = useCallback(
    (setId: string): Array<{ profileId: string; priority: Priority }> => {
      const scopedProfiles = getCrewScopedProfiles();
      return scopedProfiles
        .filter((p) => p.id !== currentProfile?.id && p.picks[setId])
        .map((p) => ({
          profileId: p.id,
          priority: p.picks[setId] as Priority,
        }));
    },
    [getCrewScopedProfiles, currentProfile?.id],
  );

  return {
    getCrewScopedProfiles,
    getCrewScopedOtherPicks,
  };
}
