import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { Priority } from '@festie/shared/types';
import RefreshableView from '../components/layout/RefreshableView';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import TimelineGrid from '../features/TimelineGrid';
import EmptyState from '../components/ui/EmptyState';
import TBASection from '../components/timeline/TBASection';
import { useTimelineFilters } from '../hooks/useTimelineFilters';
import { CalendarX, Music } from 'lucide-react';

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

  // Track viewport so we can size the 15-min timeline row to fit the day in
  // one screen on mobile. Desktop keeps the fixed 36 px row so artists remain
  // touch-comfortable; mobile computes `(availableH - header) / totalSlots`
  // with a 22 px floor (minimum legible height for a pill-style label).
  const [vpH, setVpH] = useState(() => typeof window === 'undefined' ? 900 : window.innerHeight);
  const [vpW, setVpW] = useState(() => typeof window === 'undefined' ? 1024 : window.innerWidth);
  useEffect(() => {
    const onResize = () => { setVpH(window.innerHeight); setVpW(window.innerWidth); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const rowHeight = useMemo(() => {
    if (vpW > 430) return 36; // desktop/tablet stays dense
    const reserved = 160 + 40;
    const avail = Math.max(280, vpH - reserved);
    const slots = timeBounds?.totalSlots ?? 20;
    return Math.max(26, Math.min(36, Math.floor(avail / slots)));
  }, [vpH, vpW, timeBounds?.totalSlots]);

  // Minute-tick so the now-indicator advances without a parent rerender.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // Now-indicator calculation
  const nowIndicator = useMemo(() => {
    if (!timeBounds) return null;
    const now = new Date(nowTick);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    if (nowMins >= timeBounds.minMin && nowMins <= timeBounds.maxMin) {
      return ((nowMins - timeBounds.minMin) / (timeBounds.maxMin - timeBounds.minMin)) * 100;
    }
    return null;
  }, [timeBounds, nowTick]);

  // Auto-scroll-to-now once per day switch
  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollToNow = useCallback(() => {
    const el = gridRef.current;
    if (!el || nowIndicator === null) return;
    const target = el.querySelector<HTMLElement>('.timeline-now-line');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [nowIndicator]);

  useEffect(() => {
    if (nowIndicator === null) return;
    const id = window.requestAnimationFrame(() => scrollToNow());
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay]);

  const handleSavePick = async (setId: string, priority: string | null) => {
    if (currentFestival) {
      await savePick(currentFestival.id, setId, priority as Priority | null);
    }
  };

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
        <div className="timeline-container" role="region" aria-label="Timeline view" data-scroll-sentinel>
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
        <div className="no-festival">
          <p>No sets scheduled for this day — try switching days above.</p>
        </div>
      </RefreshableView>
    );
  }

  if (!visibleStages.length) {
    return (
      <RefreshableView queryKeys={[['sets'], ['festival']]} className="timeline-view">
        <div className="no-festival">
          <p>All stages are filtered out — tap a stage above to show it.</p>
        </div>
      </RefreshableView>
    );
  }

  return (
    <RefreshableView queryKeys={[['sets'], ['festival']]} className="timeline-view">
      <div className="timeline-container" role="region" aria-label="Timeline view" data-scroll-sentinel>
        <details className="timeline-legend" aria-label="Timeline legend">
          <summary>Legend</summary>
          <ul className="timeline-legend-list">
            <li>
              <span className="legend-swatch bg-[var(--color-accent-coral,#ff6b6b)]" aria-hidden="true" />
              Must See (your pick)
            </li>
            <li>
              <span className="legend-swatch bg-[var(--color-accent-aqua,#00d4aa)]" aria-hidden="true" />
              Want to See (your pick)
            </li>
            <li>
              <span className="legend-swatch bg-[var(--color-accent-amber,#f59e0b)]" aria-hidden="true" />
              Maybe (your pick)
            </li>
            <li>
              <span className="legend-dot" aria-hidden="true" />
              Crew pick — a friend in your crew also picked this set
            </li>
            <li>
              <span aria-hidden="true">⚠</span>
              Schedule conflict with another of your picks
            </li>
            <li>
              <span className="legend-now-line" aria-hidden="true" />
              Current time
            </li>
          </ul>
        </details>
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
            className="timeline-jump-now"
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
