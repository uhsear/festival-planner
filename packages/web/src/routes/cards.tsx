import React, { useMemo } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { artistDisplayName, getSetHotness, getConflictingSetIds } from '@festie/shared/utils';
import SetCard from '../components/features/SetCard';
import EmptyState from '../components/ui/EmptyState';
import CardsSkeleton from '../components/ui/skeletons/CardsSkeleton';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { Music, SearchX } from 'lucide-react';

export default function CardsView() {
  return (
    <RenderErrorBoundary name="cards">
      <CardsViewInner />
    </RenderErrorBoundary>
  );
}

function CardsViewInner() {
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const sets = useFestivalStore((state) => state.sets);
  const stages = useFestivalStore((state) => state.stages);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const searchQuery = useFestivalStore((state) => state.searchQuery);
  const activeStages = useFestivalStore((state) => state.activeStages);

  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const setDetailAutoSpotify = useUIStore((state) => state.setDetailAutoSpotify);
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

  const conflictsBySetId = useMemo(() => {
    const conflictSets = filteredSets.filter((s) => conflictIds.has(s.id));
    const map = new Map<string, typeof conflictSets>();
    for (const s of conflictSets) {
      map.set(s.id, conflictSets.filter((c) => c.id !== s.id));
    }
    return map;
  }, [filteredSets, conflictIds]);

  // Show layout-matched skeleton while festivals are being fetched on boot
  // — same component the router uses for the chunk-load fallback so the
  // visual is continuous across route-transition → data-fetch.
  if (!currentFestival) {
    return <CardsSkeleton />;
  }

  return (
    <>
      {/* Card grid */}
      {filteredSets.length === 0 ? (
        <EmptyState
          icon={searchQuery
            ? <SearchX className="w-12 h-12" aria-hidden="true" />
            : <Music    className="w-12 h-12" aria-hidden="true" />}
          title={searchQuery ? 'No artists match your search' : 'No sets for this day'}
          description={searchQuery
            ? 'Try a different spelling or clear the search to see the full lineup.'
            : 'Pick another day from the day selector to browse the schedule.'}
        />
      ) : (
        <div className="card-grid" role="region" aria-label="Card view">
          {filteredSets.map((set, idx) => {
            const sc = getStageColor(set.stageId);
            const sn = getStageName(set.stageId) || 'Unknown';
            const others = getOtherPicks(set.id);
            const setConflicts = conflictsBySetId.get(set.id) || [];

            return (
              <div
                key={set.id}
                className="card-enter stagger-item"
                style={{ '--i': Math.min(idx, 20) } as React.CSSProperties}
              >
                <SetCard
                  set={set}
                  onTap={() => setDetailSet(set)}
                  onPreview={() => { setDetailAutoSpotify(true); setDetailSet(set); }}
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
