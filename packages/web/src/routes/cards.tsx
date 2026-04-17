import React, { useMemo } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { artistDisplayName, getSetHotness, getConflictingSetIds } from '@festie/shared/utils';
import { formatTime } from '@festie/shared/utils';
import SetCard from '../components/features/SetCard';

export default function CardsView() {
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const sets = useFestivalStore((state) => state.sets);
  const stages = useFestivalStore((state) => state.stages);
  const days = useFestivalStore((state) => state.days);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const searchQuery = useFestivalStore((state) => state.searchQuery);
  const activeStages = useFestivalStore((state) => state.activeStages);

  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const { getMyPick, getOtherPicks } = usePicks();
  const { getStageColor, getStageName } = useFestival();

  // Filter sets by day, stages, and search query — mirrors legacy filteredSets()
  const filteredSets = useMemo(() => {
    // Filter by selected day using dayIndex (legacy: getCurrentDaySets via day array index)
    let filtered = sets.filter((s) => s.dayIndex === selectedDay);

    // Filter by search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          (s.artists?.some((a) => a.name.toLowerCase().includes(q))) ||
          (s.artist || '').toLowerCase().includes(q),
      );
    }

    // Filter by active stages — legacy: only filters when SOME but NOT ALL selected
    if (activeStages.length > 0 && activeStages.length < stages.length) {
      filtered = filtered.filter((s) => activeStages.includes(s.stageId));
    }

    // Sort by hotness (picks count), then by time, then by artist name
    return filtered.sort((a, b) => {
      const hotA = getSetHotness(a);
      const hotB = getSetHotness(b);
      if (hotA > 0 || hotB > 0) return hotB - hotA;

      const timeA = a.startTime || '';
      const timeB = b.startTime || '';
      if (timeA && timeB) return timeA.localeCompare(timeB);
      if (timeA && !timeB) return -1;
      if (!timeA && timeB) return 1;

      return artistDisplayName(a, currentFestival?.b2bSeparator).localeCompare(
        artistDisplayName(b, currentFestival?.b2bSeparator),
        undefined,
        { sensitivity: 'base' },
      );
    });
  }, [sets, selectedDay, stages, activeStages, searchQuery, currentFestival?.b2bSeparator]);

  // Compute conflict set IDs
  const conflictIds = useMemo(() => {
    return getConflictingSetIds(filteredSets, getMyPick);
  }, [filteredSets, getMyPick]);

  // Show loading skeleton while festivals are being fetched on boot
  if (!currentFestival) {
    return (
      <div className="loading-skeleton" aria-busy="true" aria-label="Loading festival data">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton-card">
            <div className="skeleton-line skeleton-title" />
            <div className="skeleton-line skeleton-time" />
            <div className="skeleton-line skeleton-stage" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Card grid */}
      {filteredSets.length === 0 ? (
        <div className="no-festival" role="status" aria-live="polite" style={{ gridColumn: '1 / -1' }}>
          <p>{searchQuery ? 'No artists match your search.' : 'No sets for this day.'}</p>
        </div>
      ) : (
        <div className="card-grid" role="region" aria-label="Card view">
          {filteredSets.map((set, idx) => {
            const sc = getStageColor(set.stageId);
            const sn = getStageName(set.stageId) || 'Unknown';
            const others = getOtherPicks(set.id);
            const setConflicts = conflictIds.has(set.id)
              ? filteredSets.filter((s) => s.id !== set.id && conflictIds.has(s.id))
              : [];

            return (
              <div
                key={set.id}
                className="card-enter"
                style={{ animationDelay: `${Math.min(idx * 30, 600)}ms` }}
              >
                <SetCard
                  set={set}
                  onTap={() => setDetailSet(set)}
                  showPicks={!!currentProfile}
                  stageName={sn}
                  stageColor={sc}
                  friendProfiles={others}
                  conflicts={setConflicts}
                  b2bSeparator={currentFestival?.b2bSeparator}
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
