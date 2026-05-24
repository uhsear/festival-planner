import { useCallback } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { Priority } from '@festie/shared/types';
import RefreshableView from '../components/layout/RefreshableView';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import TimelineGrid from '../features/TimelineGrid';
import EmptyState from '../components/ui/EmptyState';
import TBASection from '../components/timeline/TBASection';
import TimelineLegend from '../components/timeline/TimelineLegend';
import { useTimelineFilters } from '../hooks/useTimelineFilters';
import { useTimelineViewport } from '../hooks/useTimelineViewport';
import { useNowIndicator } from '../hooks/useNowIndicator';
import { CalendarX, Music, Filter } from 'lucide-react';
import { cn } from '../lib/utils';

export default function TimelineView() {
  return (
    <RenderErrorBoundary name="timeline">
      <TimelineViewInner />
    </RenderErrorBoundary>
  );
}

function TimelineViewInner() {
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const { getMyPick, getOtherPicks, savePick } = usePicks();
  const { getStageColor } = useFestival();

  const {
    currentFestival,
    stages,
    selectedDay,
    visibleStages,
    allDaySets,
    timedSets,
    timelessSets,
    conflictIds,
    timeBounds,
  } = useTimelineFilters();

  const { vpW, rowHeight } = useTimelineViewport(timeBounds?.totalSlots);
  const { nowIndicator, gridRef, scrollToNow } = useNowIndicator(timeBounds, selectedDay);

  const handleSavePick = useCallback(
    async (setId: string, priority: string | null) => {
      if (currentFestival) {
        await savePick(currentFestival.id, setId, priority as Priority | null);
      }
    },
    [currentFestival, savePick],
  );

  if (!currentFestival) {
    return (
      <EmptyState
        icon={<CalendarX className="w-12 h-12" aria-hidden="true" />}
        title="No festival loaded"
        description="Choose a festival from the top menu to see the timeline."
      />
    );
  }

  // TBA-only fallback (no timed sets but there are timeless sets)
  if (timedSets.length === 0 && timelessSets.length > 0) {
    return (
      <RefreshableView queryKeys={[['sets'], ['festival']]} className="timeline-view">
        <div
          className="relative overflow-auto h-full [-webkit-overflow-scrolling:touch] overscroll-contain"
          role="region"
          aria-label="Timeline view"
          data-scroll-sentinel
        >
          <TBASection
            sets={timelessSets}
            stages={stages}
            getMyPick={getMyPick}
            getOtherPicks={getOtherPicks}
            conflictIds={conflictIds}
            currentProfile={currentProfile}
            currentFestival={currentFestival}
            getStageColor={getStageColor}
            onSavePick={handleSavePick}
            onOpenDetail={setDetailSet}
          />
        </div>
      </RefreshableView>
    );
  }

  if (!allDaySets.length || !timeBounds || timeBounds.totalSlots <= 0 || timeBounds.totalSlots > 200) {
    return (
      <RefreshableView queryKeys={[['sets'], ['festival']]} className="timeline-view">
        <EmptyState
          icon={<Music className="w-9 h-9" aria-hidden="true" />}
          title="No sets scheduled for this day"
          description="Try switching days above to find scheduled sets."
        />
      </RefreshableView>
    );
  }

  if (!visibleStages.length) {
    return (
      <RefreshableView queryKeys={[['sets'], ['festival']]} className="timeline-view">
        <EmptyState
          icon={<Filter className="w-9 h-9" aria-hidden="true" />}
          title="All stages are filtered out"
          description="Tap a stage above to show it on the timeline."
        />
      </RefreshableView>
    );
  }

  return (
    <RefreshableView queryKeys={[['sets'], ['festival']]} className="timeline-view">
      <div
        className="relative overflow-auto h-full [-webkit-overflow-scrolling:touch] overscroll-contain"
        role="region"
        aria-label="Timeline view"
        data-scroll-sentinel
      >
        <TimelineLegend />
        <TimelineGrid
          visibleStages={visibleStages}
          timedSets={timedSets}
          timeBounds={timeBounds}
          selectedDay={selectedDay}
          rowHeight={rowHeight}
          vpW={vpW}
          nowIndicator={nowIndicator}
          conflictIds={conflictIds}
          currentProfile={currentProfile}
          currentFestival={currentFestival}
          gridRef={gridRef}
          getMyPick={getMyPick}
          getOtherPicks={getOtherPicks}
          getStageColor={getStageColor}
          onSetClick={setDetailSet}
          onSavePick={handleSavePick}
        />

        {nowIndicator !== null && (
          <button
            type="button"
            className={cn(
              'fixed right-4 bottom-[calc(88px+env(safe-area-inset-bottom,0px))]',
              'inline-flex items-center gap-1.5',
              'px-3.5 py-2.5 rounded-full',
              'bg-[var(--color-accent-coral,#ff6b6b)]',
              'text-[var(--color-bg-primary,#0d0d1a)]',
              'border-none text-[13px] font-bold tracking-[0.02em]',
              'cursor-pointer z-30 min-h-11',
              'shadow-[0_6px_20px_rgba(255,107,107,0.35),0_1px_3px_rgba(0,0,0,0.25)]',
              'transition-[transform,box-shadow] duration-150',
              'ease-[cubic-bezier(0.16,1,0.3,1)]',
              'hover:shadow-[0_8px_24px_rgba(255,107,107,0.45),0_1px_4px_rgba(0,0,0,0.3)]',
              'active:scale-[0.96]',
            )}
            aria-label="Scroll to current time"
            onClick={scrollToNow}
          >
            <Music aria-hidden="true" className="w-4 h-4" />
            <span>Now</span>
          </button>
        )}

        {timelessSets.length > 0 && (
          <TBASection
            sets={timelessSets}
            stages={stages}
            getMyPick={getMyPick}
            getOtherPicks={getOtherPicks}
            conflictIds={conflictIds}
            currentProfile={currentProfile}
            currentFestival={currentFestival}
            getStageColor={getStageColor}
            onSavePick={handleSavePick}
            onOpenDetail={setDetailSet}
          />
        )}
      </div>
    </RefreshableView>
  );
}
