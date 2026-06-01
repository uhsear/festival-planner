import { useMemo } from 'react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { usePicks, useFestival, useCrew } from '@festie/shared/hooks';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { artistDisplayName, artistSubtitle, getSetLinks, detectConflicts } from '@festie/shared/utils';

export interface CrewMemberPick {
  profileId: string;
  priority: string;
  name: string;
  avatar?: string;
}

export interface CrewNote {
  name: string;
  note: string;
}

export function useDetailPanelData(set: FestivalSet) {
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalDays = useFestivalStore((s) => s.days);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const allProfiles = useFestivalStore((s) => s.allProfiles);
  const sets = useFestivalStore((s) => s.sets);
  const activeCrew = useCrewStore((s) => s.activeCrew);

  const { getMyPick, savePick, saveNote, getOtherPicks, saveReminder, getMyReminder } = usePicks();
  const { getStageColor, getStageName } = useFestival();
  const { getCrewScopedOtherPicks } = useCrew();

  const b2bSeparator = currentFestival?.b2bSeparator;
  const stageColor = getStageColor(set.stageId);
  const stageName = getStageName(set.stageId) || 'Unknown';
  const myPick = getMyPick(set.id);
  const myReminder = getMyReminder(set.id);
  const artistName = artistDisplayName(set, b2bSeparator);
  const sub = artistSubtitle(set, b2bSeparator);
  const artistLinks = getSetLinks(set);
  const isB2B = (set.artists?.length || 0) > 1;
  const primaryArtist = set.artists?.[0];

  const allGenres = useMemo(() => {
    return [...new Set((set.artists || []).flatMap((a) => a.genres || []))].slice(0, 6);
  }, [set.artists]);

  const conflicts = useMemo(() => {
    if (!currentProfile) return [];
    const detected = detectConflicts(sets, (setId: string) => {
      const val = currentProfile.picks[setId];
      return (val as Priority) || null;
    });
    return detected
      .filter((c) => c.setA.id === set.id || c.setB.id === set.id)
      .map((c) => (c.setA.id === set.id ? c.setB : c.setA));
  }, [sets, currentProfile, set.id]);

  const others: CrewMemberPick[] = useMemo(() => {
    if (!currentProfile) return [];
    const raw = activeCrew ? getCrewScopedOtherPicks(set.id) : getOtherPicks(set.id);
    return raw.map((o) => {
      const profile = allProfiles.find((p) => p.id === o.profileId);
      const avatarUrl = (profile as { avatarUrl?: string | null } | undefined)?.avatarUrl;
      return {
        ...o,
        name: profile?.name || 'Unknown',
        avatar: (avatarUrl ?? undefined) as string | undefined,
      };
    });
  }, [currentProfile, activeCrew, set.id, getCrewScopedOtherPicks, getOtherPicks, allProfiles]);

  const crewNotes: CrewNote[] = useMemo(() => {
    return allProfiles
      .filter((p) => p.id !== currentProfile?.id && p.notes?.['crew:' + set.id])
      .map((p) => ({ name: p.name || 'Unknown', note: p.notes['crew:' + set.id]! }));
  }, [allProfiles, currentProfile?.id, set.id]);

  const whoTitle = useMemo(() => {
    if (activeCrew) {
      return others.length > 0
        ? `${activeCrew.name} (${others.length} going)`
        : `No one in ${activeCrew.name} going yet`;
    }
    return others.length > 0 ? `Who's Going (${others.length})` : 'Nobody else going yet';
  }, [activeCrew, others.length]);

  return {
    currentFestival,
    festivalDays,
    currentProfile,
    b2bSeparator,
    stageColor,
    stageName,
    myPick,
    myReminder,
    saveReminder,
    artistName,
    sub,
    artistLinks,
    isB2B,
    primaryArtist,
    allGenres,
    conflicts,
    others,
    crewNotes,
    whoTitle,
    savePick,
    saveNote,
    getOtherPicks,
    getStageName,
  };
}
