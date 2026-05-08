import { useMemo } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { usePicks } from '@festie/shared/hooks';
import { FestivalSet, Stage } from '@festie/shared/types';
import {
  timeToMinutes,
  artistDisplayName,
  getConflictingSetIds,
} from '@festie/shared/utils';

const SLOT_MINUTES = 15;

export interface TimeBounds {
  minMin: number;
  maxMin: number;
  totalSlots: number;
}

export function useTimelineFilters() {
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const sets = useFestivalStore((state) => state.sets);
  const stages = useFestivalStore((state) => state.stages);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const activeStages = useFestivalStore((state) => state.activeStages);
  const { getMyPick } = usePicks();

  // Ensure all stages are active if none selected
  const effectiveActiveStages = useMemo(() => {
    if (!activeStages || activeStages.length === 0) {
      return stages.map((st: Stage) => st.id);
    }
    return activeStages;
  }, [activeStages, stages]);

  const visibleStages = useMemo(() => {
    return stages.filter((st: Stage) => effectiveActiveStages.includes(st.id));
  }, [stages, effectiveActiveStages]);

  // Filter sets for the selected day using dayIndex
  const allDaySets = useMemo(() => {
    let filtered = sets.filter((s: FestivalSet) => s.dayIndex === selectedDay);
    // Filter by active stages -- only when some but not all are selected
    if (effectiveActiveStages.length > 0 && effectiveActiveStages.length < stages.length) {
      filtered = filtered.filter((s: FestivalSet) => effectiveActiveStages.includes(s.stageId));
    }
    return filtered;
  }, [sets, selectedDay, stages, effectiveActiveStages]);

  const timedSets = useMemo(
    () => allDaySets.filter((s: FestivalSet) => s.startTime && s.endTime),
    [allDaySets],
  );

  const timelessSets = useMemo(
    () =>
      allDaySets
        .filter((s: FestivalSet) => !s.startTime || !s.endTime)
        .sort((a: FestivalSet, b: FestivalSet) =>
          artistDisplayName(a, currentFestival?.b2bSeparator).localeCompare(
            artistDisplayName(b, currentFestival?.b2bSeparator),
            undefined,
            { sensitivity: 'base' },
          ),
        ),
    [allDaySets, currentFestival?.b2bSeparator],
  );

  // Conflict detection
  const conflictIds = useMemo(
    () => getConflictingSetIds(allDaySets, getMyPick),
    [allDaySets, getMyPick],
  );

  // Calculate time bounds
  const timeBounds = useMemo((): TimeBounds | null => {
    if (timedSets.length === 0) return null;

    let minMin = 24 * 60;
    let maxMin = 0;

    timedSets.forEach((s: FestivalSet) => {
      const start = timeToMinutes(s.startTime!);
      let end = timeToMinutes(s.endTime!);
      if (end <= start) end += 24 * 60;
      if (start < minMin) minMin = start;
      if (end > maxMin) maxMin = end;
    });

    minMin = Math.floor(minMin / SLOT_MINUTES) * SLOT_MINUTES;
    maxMin = Math.ceil(maxMin / SLOT_MINUTES) * SLOT_MINUTES;
    const totalSlots = (maxMin - minMin) / SLOT_MINUTES;

    return { minMin, maxMin, totalSlots };
  }, [timedSets]);

  return {
    currentFestival,
    stages,
    selectedDay,
    visibleStages,
    allDaySets,
    timedSets,
    timelessSets,
    conflictIds,
    timeBounds,
  };
}
