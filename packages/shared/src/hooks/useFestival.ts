import { useCallback } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { FestivalSet } from '../types';
import { STAGE_COLOR_FALLBACK } from '../utils/stageColor';

export interface UseFestivalReturn {
  getDays: () => { index: number; date: string; label?: string }[];
  getCurrentDaySets: () => FestivalSet[];
  getFilteredSets: () => FestivalSet[];
  getStageColor: (stageId: string) => string;
  getStageName: (stageId: string) => string | undefined;
}

export function useFestival(): UseFestivalReturn {
  const days = useFestivalStore((state) => state.days);
  const sets = useFestivalStore((state) => state.sets);
  const stages = useFestivalStore((state) => state.stages);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const activeStages = useFestivalStore((state) => state.activeStages);
  const searchQuery = useFestivalStore((state) => state.searchQuery);
  const onlyMine = useFestivalStore((state) => state.onlyMine);
  const currentProfile = useFestivalStore((state) => state.currentProfile);

  const getDays = useCallback(() => {
    return days.map((day, index) => ({
      index,
      date: day.date,
      label: day.label || day.date,
    }));
  }, [days]);

  const getCurrentDaySets = useCallback(() => {
    if (selectedDay < 0 || selectedDay >= days.length) return [];
    // Filter by dayIndex (set by selectFestival when flattening)
    return sets.filter((s) => s.dayIndex === selectedDay);
  }, [selectedDay, days, sets]);

  const getFilteredSets = useCallback(() => {
    const daySets = getCurrentDaySets();

    return daySets.filter((set) => {
      // Legacy: only filter when SOME but NOT ALL stages are selected
      if (activeStages.length > 0 && activeStages.length < stages.length && !activeStages.includes(set.stageId)) {
        return false;
      }

      // "My picks only" — show just the sets the user has picked.
      if (onlyMine && !currentProfile?.picks?.[set.id]) {
        return false;
      }

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesArtist =
          set.artist?.toLowerCase().includes(query) || set.artists?.some((a) => a.name.toLowerCase().includes(query));

        const stageName = stages.find((s) => s.id === set.stageId)?.name.toLowerCase();
        const matchesStage = stageName?.includes(query);

        return matchesArtist || matchesStage;
      }

      return true;
    });
  }, [getCurrentDaySets, activeStages, searchQuery, stages, onlyMine, currentProfile]);

  // Use actual stage.color from API response. When a stage has no color we
  // return the platform-neutral STAGE_COLOR_FALLBACK sentinel (NOT a web CSS var
  // — shared must stay RN-safe); each platform maps it to its own muted value
  // via resolveStageColor (web → var(--text-muted), mobile → token).
  const getStageColor = useCallback(
    (stageId: string): string => {
      return stages.find((s) => s.id === stageId)?.color || STAGE_COLOR_FALLBACK;
    },
    [stages],
  );

  const getStageName = useCallback(
    (stageId: string): string | undefined => {
      return stages.find((s) => s.id === stageId)?.name;
    },
    [stages],
  );

  return {
    getDays,
    getCurrentDaySets,
    getFilteredSets,
    getStageColor,
    getStageName,
  };
}
