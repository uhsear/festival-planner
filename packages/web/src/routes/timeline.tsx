import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { FestivalSet, Priority, Stage, Profile, Festival } from '@festie/shared/types';
import {
  timeToMinutes,
  artistDisplayName,
  getConflictingSetIds,
} from '@festie/shared/utils';
import RefreshableView from '../components/layout/RefreshableView';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import TimelineGrid from '../features/TimelineGrid';
import StageBadge from '../components/ui/StageBadge';
import EmptyState from '../components/ui/EmptyState';
import { CalendarX, Music } from 'lucide-react';

const SLOT_MINUTES = 15;

const PRI_MAP: Record<string, string> = {
  must: 'must',
  'want-to-see': 'want',
  maybe: 'maybe',
};

export default function TimelineView() {
  return (
    <RenderErrorBoundary name="timeline">
      <TimelineViewInner />
    </RenderErrorBoundary>
  );
}

function TimelineViewInner() {
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const sets = useFestivalStore((state) => state.sets);
  const stages = useFestivalStore((state) => state.stages);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const activeStages = useFestivalStore((state) => state.activeStages);

  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const { getMyPick, getOtherPicks, savePick } = usePicks();
  const { getStageColor } = useFestival();

  // Ensure all stages are active if none selected
  const effectiveActiveStages = useMemo(() => {
    if (!activeStages || activeStages.length === 0) {
      return stages.map((st) => st.id);
    }
    return activeStages;
  }, [activeStages, stages]);

  const visibleStages = useMemo(() => {
    return stages.filter((st) => effectiveActiveStages.includes(st.id));
  }, [stages, effectiveActiveStages]);

  // Filter sets for the selected day using dayIndex
  const allDaySets = useMemo(() => {
    let filtered = sets.filter((s) => s.dayIndex === selectedDay);
    // Filter by active stages — only when some but not all are selected
    if (effectiveActiveStages.length > 0 && effectiveActiveStages.length < stages.length) {
      filtered = filtered.filter((s) => effectiveActiveStages.includes(s.stageId));
    }
    return filtered;
  }, [sets, selectedDay, stages, effectiveActiveStages]);

  const timedSets = useMemo(
    () => allDaySets.filter((s) => s.startTime && s.endTime),
    [allDaySets],
  );

  const timelessSets = useMemo(
    () =>
      allDaySets
        .filter((s) => !s.startTime || !s.endTime)
        .sort((a, b) =>
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
  const timeBounds = useMemo(() => {
    if (timedSets.length === 0) return null;

    let minMin = 24 * 60;
    let maxMin = 0;

    timedSets.forEach((s) => {
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
    // Reserve: header+bottom nav+sub-header collapsed ≈ 160 px + stage header 40 px
    const reserved = 160 + 40;
    const avail = Math.max(280, vpH - reserved);
    const slots = timeBounds?.totalSlots ?? 20;
    // 26 px floor keeps a 12.5 px / 1.15-line-height artist name legible inside
    // a single 15-min slot (was 22 px — mid-descender clip over colored bg).
    // Grid may scroll past one screen when slots × 26 > avail; that's fine.
    return Math.max(26, Math.min(36, Math.floor(avail / slots)));
  }, [vpH, vpW, timeBounds?.totalSlots]);

  // Minute-tick so the now-indicator advances without a parent rerender. Using
  // a 30 s interval keeps the line visibly alive at 1 px/min on dense grids.
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
      const pct = ((nowMins - timeBounds.minMin) / (timeBounds.maxMin - timeBounds.minMin)) * 100;
      return pct;
    }
    return null;
  }, [timeBounds, nowTick]);

  // Auto-scroll-to-now once per day switch so the user lands at the action.
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
    // Defer one frame so the grid lays out before we measure.
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
        {/* Legend — the small circles in each set block are crew-overlap
            indicators (friends who also picked the set). Collapsible so it
            doesn't steal mobile viewport space after the first visit. */}
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

        {/* Jump-to-now FAB — only when today's timeline is active and the line
            exists. Anchored to the container so it stays reachable as the user
            scrolls through a dense day. */}
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

        {/* TBA section for sets without times */}
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

/* ---- TBA Section sub-component ---- */

interface TBASectionProps {
  sets: FestivalSet[];
  stages: Stage[];
  getMyPick: (setId: string) => Priority | null | undefined;
  getOtherPicks: (setId: string) => Array<{ profileId: string; priority: Priority; name?: string }>;
  conflictIds: Set<string>;
  currentProfile: Profile | null;
  currentFestival: Festival | null;
  getStageColor: (stageId: string) => string;
  onSavePick: (setId: string, priority: string | null) => void;
  onOpenDetail: (set: FestivalSet) => void;
}

function TBASection({
  sets,
  stages,
  getMyPick,
  getOtherPicks,
  conflictIds: _conflictIds,
  currentProfile,
  currentFestival,
  getStageColor,
  onSavePick,
  onOpenDetail,
}: TBASectionProps) {
  return (
    <div className="timeline-tba-section">
      <div className="timeline-tba-header">TBA — Times Not Yet Announced</div>
      <div className="timeline-tba-grid">
        {sets.map((s, idx) => {
          const myPick = getMyPick(s.id);
          const others = getOtherPicks(s.id);
          const stage = stages.find((st) => st.id === s.stageId);
          const stageColor = stage ? getStageColor(stage.id) : undefined;
          const priClass = myPick ? ' priority-' + (PRI_MAP[myPick] || '') : '';
          const dn = artistDisplayName(s, currentFestival?.b2bSeparator);

          return (
            <div
              key={s.id}
              className={'timeline-tba-card stagger-item relative' + priClass}
              style={stageColor ? { '--i': Math.min(idx, 20), borderLeft: `3px solid ${stageColor}` } as React.CSSProperties : { '--i': Math.min(idx, 20) } as React.CSSProperties}
            >
              {/* Positioned click overlay — keeps outer div non-interactive so
                  priority buttons inside don't trigger nested-interactive. */}
              <button
                type="button"
                className="tba-card-click-target absolute inset-0 z-[1] cursor-pointer border-0 bg-transparent p-0 m-0"
                aria-label={`${dn}${stage ? ' at ' + stage.name : ''}, time TBA${myPick ? ', priority: ' + myPick : ''}`}
                onClick={() => onOpenDetail(s)}
              />
              <div className="set-artist relative z-[2] pointer-events-none">{dn}</div>
              {stage && stageColor && (
                <StageBadge
                  variant="pick"
                  stageName={stage.name}
                  stageColor={stageColor}
                  className="relative z-[2] text-[11px]"
                />
              )}

              {/* Priority pick buttons */}
              {currentProfile && (
                <div className="timeline-pick-group relative z-[2]">
                  {([['must', '★'], ['want-to-see', '◆'], ['maybe', '●']] as const).map(
                    ([p, icon]) => {
                      const active = myPick === p;
                      return (
                        <button
                          key={p}
                          className={
                            'timeline-pick-btn' +
                            (active ? ' active-' + PRI_MAP[p] : '')
                          }
                          type="button"
                          aria-pressed={active ? 'true' : 'false'}
                          aria-label={
                            (p === 'must'
                              ? 'Must See'
                              : p === 'want-to-see'
                                ? 'Want to See'
                                : 'Maybe') + (active ? ' (selected)' : '')
                          }
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSavePick(s.id, active ? null : p);
                          }}
                        >
                          {icon}
                        </button>
                      );
                    },
                  )}
                </div>
              )}

              {/* Crew overlap */}
              {others.length > 0 && (
                <div className="set-overlap relative z-[2]">
                  {others.slice(0, 3).map((o) => (
                    <div
                      key={o.profileId}
                      className="mini-avatar h-4 w-4 text-[7px]"
                      title={`${o.name || 'Crew member'} (${o.priority})`}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
