import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { Priority } from '@festie/shared/types';
import { getSetTimeBounds, artistDisplayName, resolveStageColor } from '@festie/shared/utils';
import RefreshableView from '../components/layout/RefreshableView';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import TimelineGrid from '../features/TimelineGrid';
import EmptyState from '../components/ui/EmptyState';
import TBASection from '../components/timeline/TBASection';
import TimelineLegend from '../components/timeline/TimelineLegend';
import LastSyncedBadge from '../components/features/LastSyncedBadge';
import LowPowerIndicator from '../components/features/LowPowerIndicator';
import { useTimelineFilters } from '../hooks/useTimelineFilters';
import { useTimelineViewport } from '../hooks/useTimelineViewport';
import { useNowIndicator } from '../hooks/useNowIndicator';
import { useScrollProgress } from '../hooks/useScrollProgress';
import { useNow } from '../hooks/useSetStatus';
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
  const days = useFestivalStore((state) => state.days);
  const allSets = useFestivalStore((state) => state.sets);
  const setDetailSet = useUIStore((state) => state.setDetailSet);
  // Low-power mode backs off the per-tick auto-scroll-to-now (an aggressive,
  // battery-costing reflow loop). The manual "Now" button stays available.
  const lowPowerMode = useFestivalModeStore((state) => state.lowPowerMode);
  const { getMyPick, getOtherPicks, savePick } = usePicks();
  const { getStageColor: getStageColorRaw } = useFestival();
  // Map shared's platform-neutral fallback sentinel to the web muted CSS var.
  const getStageColor = useCallback(
    (stageId: string) => resolveStageColor(getStageColorRaw(stageId), 'var(--text-muted)'),
    [getStageColorRaw],
  );

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

  // R11: scroll-driven aqua beam in the left gutter. The hook updates a
  // --scroll-progress custom property on the scroll container (fallback path);
  // modern engines fill the beam natively via animation-timeline: scroll().
  const { ref: scrollRef, handleScroll: handleBeamScroll } = useScrollProgress<HTMLDivElement>();

  // --- Live mode -----------------------------------------------------------
  // A 60s device-clock tick drives the next-pick countdown and the auto-scroll.
  // Fully offline-native: reads only cached sets + the local clock, never the
  // network. Set-time math comes from the SHARED getSetTimeBounds (TZ-safe,
  // post-midnight rollover) — never a local parseSetMs. Shares the single
  // module-level clock (useNow) with every SetCard instead of a second interval.
  const nowMs = useNow();

  // Countdown to the next picked set (across all days, like festival-mode's
  // "up next"), recomputed every tick from the device clock.
  const nextPick = useMemo(() => {
    const picks = currentProfile?.picks;
    if (!picks) return null;
    let best: { set: (typeof allSets)[number]; startMs: number } | null = null;
    for (const s of allSets) {
      if (!picks[s.id]) continue;
      const bounds = getSetTimeBounds(s, days);
      if (!bounds || bounds.startMs <= nowMs) continue;
      if (!best || bounds.startMs < best.startMs) best = { set: s, startMs: bounds.startMs };
    }
    return best;
  }, [currentProfile?.picks, allSets, days, nowMs]);

  const nextPickLabel = useMemo(() => {
    if (!nextPick) return null;
    const totalMin = Math.max(0, Math.round((nextPick.startMs - nowMs) / 60_000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const eta = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
    return {
      eta,
      name: artistDisplayName(nextPick.set, currentFestival?.b2bSeparator),
    };
  }, [nextPick, nowMs, currentFestival?.b2bSeparator]);

  // Track active user scrolling so the tick-driven auto-scroll never fights a
  // user who is reading another part of the timeline. Any scroll on the
  // container arms the flag for 8s; while armed, the tick won't yank the view.
  const recentlyScrolledRef = useRef(false);
  const scrollArmTimerRef = useRef<number | null>(null);

  const handleUserScroll = useCallback(() => {
    recentlyScrolledRef.current = true;
    if (scrollArmTimerRef.current !== null) window.clearTimeout(scrollArmTimerRef.current);
    scrollArmTimerRef.current = window.setTimeout(() => {
      recentlyScrolledRef.current = false;
    }, 8_000);
  }, []);

  useEffect(
    () => () => {
      if (scrollArmTimerRef.current !== null) window.clearTimeout(scrollArmTimerRef.current);
    },
    [],
  );

  // Auto-scroll to now on each tick — but only when the user isn't actively
  // scrolling and a now-line exists for the current day.
  useEffect(() => {
    if (lowPowerMode) return; // back off the auto-scroll loop to save battery
    if (nowIndicator === null) return;
    if (recentlyScrolledRef.current) return;
    const id = window.requestAnimationFrame(() => {
      if (!recentlyScrolledRef.current) scrollToNow();
    });
    return () => window.cancelAnimationFrame(id);
  }, [nowMs, nowIndicator, scrollToNow, lowPowerMode]);

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
        ref={scrollRef}
        onScroll={() => {
          handleUserScroll();
          handleBeamScroll();
        }}
        className="timeline-scroll relative overflow-auto h-full [-webkit-overflow-scrolling:touch] overscroll-contain"
        role="region"
        aria-label="Timeline view"
        data-scroll-sentinel
      >
        {/* R11 — full-height content wrapper so the beam's % height resolves
            against scroll content, not the viewport. The beam fills top→current
            scroll position in the left gutter. */}
        <div className="timeline-content relative min-h-full">
          <div className="timeline-beam" aria-hidden="true" />
          <div className="sticky top-0 z-20 bg-bg-sticky shadow-sticky [backdrop-filter:saturate(140%)_blur(8px)]">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TimelineLegend />
              <div className="flex items-center gap-1.5 flex-wrap pr-3 py-0.5">
                <LowPowerIndicator />
                <LastSyncedBadge surface="schedule" />
              </div>
            </div>
            {nextPickLabel && (
              <div
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-text-secondary border-t border-border-default/40"
                aria-live="polite"
                data-testid="next-pick-countdown"
              >
                <Music aria-hidden="true" className="w-3.5 h-3.5 text-[var(--color-text-danger)]" />
                <span>
                  Up next in <span className="text-[var(--color-text-danger)]">{nextPickLabel.eta}</span>
                  {' · '}
                  <span className="text-text-primary">{nextPickLabel.name}</span>
                </span>
              </div>
            )}
          </div>
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
                'fixed right-4',
                'bottom-[calc(var(--bottom-nav-h,88px)+8px+env(safe-area-inset-bottom,0px))]',
                'lg:bottom-6',
                'inline-flex items-center gap-1.5',
                'px-3.5 py-2.5 rounded-full',
                'bg-[var(--color-accent-coral)]',
                'text-[var(--color-bg-primary)]',
                'border-none text-[length:var(--font-size-13)] font-bold tracking-[var(--letter-spacing-caps)]',
                'cursor-pointer z-30 min-h-11',
                'shadow-[var(--shadow-glow-coral),0_1px_3px_rgba(0,0,0,0.25)]',
                'transition-[transform,box-shadow] duration-150',
                'ease-out',
                'hover:shadow-[0_8px_24px_rgba(255,51,102,0.45),0_1px_4px_rgba(0,0,0,0.3)]',
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
      </div>
    </RefreshableView>
  );
}
