import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { getPxPerMin, getGutterW, toMin, fmtHour } from '../components/grid/gridUtils';
import { useGridExport } from '../components/grid/useGridExport';
import GridStageHeader from '../components/grid/GridStageHeader';
import GridStageColumn from '../components/grid/GridStageColumn';
import EmptyState from '../components/ui/EmptyState';
import { CalendarX, Clock } from 'lucide-react';
import { cn } from '../lib/utils';

export default function GridView() {
  return (
    <RenderErrorBoundary name="grid">
      <GridViewInner />
    </RenderErrorBoundary>
  );
}

function GridViewInner() {
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const sets = useFestivalStore((s) => s.sets);
  const stages = useFestivalStore((s) => s.stages);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const days = useFestivalStore((s) => s.days);
  const activeStages = useFestivalStore((s) => s.activeStages);
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  const { getMyPick, getOtherPicks } = usePicks();
  const { getStageColor, getStageName } = useFestival();

  // Compact crew-overlap indicator for grid cells: how many OTHER crew members
  // picked a set. Reads persisted allProfiles (via getOtherPicks), so the
  // count renders offline. The grid cell is the first surface to wire this.
  const getOverlapCount = useCallback((setId: string) => getOtherPicks(setId).length, [getOtherPicks]);
  const gridRef = useRef<HTMLDivElement>(null);

  // Track viewport width so PX_PER_MIN + GUTTER_W can adapt on rotate/resize.
  // Throttled via rAF so rapid resize events don't re-render every column per frame.
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));
  useEffect(() => {
    let rafId: number | null = null;
    const onResize = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        setVw(window.innerWidth);
        rafId = null;
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);
  const PX_PER_MIN = getPxPerMin(vw);
  const GUTTER_W = getGutterW(vw);
  // Min column width — shared by the header grid and the body columns so they
  // stay aligned; columns then flex to fill the remaining width on desktop.
  const minColW = vw <= 430 ? '92px' : '110px';

  const { exporting, exportGrid } = useGridExport(
    gridRef,
    selectedDay,
    days?.[selectedDay]?.label ?? `day-${selectedDay + 1}`,
  );

  const visibleStages = useMemo(() => {
    if (activeStages.length > 0 && activeStages.length < stages.length)
      return stages.filter((st) => activeStages.includes(st.id));
    return stages;
  }, [stages, activeStages]);

  const timedSets = useMemo(
    () =>
      sets.filter(
        (s) =>
          s.dayIndex === selectedDay &&
          s.startTime &&
          s.endTime &&
          (activeStages.length === 0 || activeStages.length === stages.length || activeStages.includes(s.stageId)),
      ),
    [sets, selectedDay, activeStages, stages],
  );

  // Pre-compute stageId -> sets map once per render instead of filtering inside
  // every column .map() iteration.
  const setsByStage = useMemo(() => {
    const m = new Map<string, typeof timedSets>();
    for (const s of timedSets) {
      const arr = m.get(s.stageId) || [];
      arr.push(s);
      m.set(s.stageId, arr);
    }
    return m;
  }, [timedSets]);

  const bounds = useMemo(() => {
    if (!timedSets.length) return null;
    let lo = Infinity,
      hi = 0;
    for (const s of timedSets) {
      const a = toMin(s.startTime!);
      const b = toMin(s.endTime!);
      lo = Math.min(lo, a);
      hi = Math.max(hi, b <= a ? b + 1440 : b);
    }
    lo = Math.floor(lo / 60) * 60;
    hi = Math.ceil(hi / 60) * 60;
    return { lo, hi, span: hi - lo };
  }, [timedSets]);

  const hours = useMemo(() => {
    if (!bounds) return [];
    const out: { m: number; px: number }[] = [];
    for (let m = bounds.lo; m <= bounds.hi; m += 60) out.push({ m, px: (m - bounds.lo) * PX_PER_MIN });
    return out;
  }, [bounds, PX_PER_MIN]);

  const nowPx = useMemo(() => {
    if (!bounds) return null;
    const now = new Date();
    const nm = now.getHours() * 60 + now.getMinutes();
    if (nm < bounds.lo || nm > bounds.hi) return null;
    return (nm - bounds.lo) * PX_PER_MIN;
  }, [bounds, PX_PER_MIN]);

  // Auto-scroll to NOW on mount (only when NOW is within the day's bounds).
  const didAutoScroll = useRef(false);
  useEffect(() => {
    if (didAutoScroll.current || nowPx == null || !gridRef.current) return;
    const body = gridRef.current.querySelector<HTMLElement>('[data-grid-body]');
    if (!body) return;
    const target = Math.max(0, nowPx - body.clientHeight / 2);
    body.scrollTo({ top: target, behavior: 'auto' });
    didAutoScroll.current = true;
  }, [nowPx]);

  if (!currentFestival)
    return (
      <EmptyState
        icon={<CalendarX className="w-9 h-9" aria-hidden="true" />}
        title="No festival selected"
        description="Choose a festival from the top menu to view the schedule grid."
      />
    );
  if (!timedSets.length || !bounds)
    return (
      <EmptyState
        icon={<Clock className="w-9 h-9" aria-hidden="true" />}
        title="No timed sets to display"
        description="There are no sets with scheduled times for this day. Try switching days above."
      />
    );

  const totalH = bounds.span * PX_PER_MIN;

  return (
    <div
      className={cn('fk-grid flex flex-col h-full min-h-0 overflow-hidden bg-bg-primary')}
      ref={gridRef}
      role="grid"
      aria-label="Festival schedule grid — stages as columns, time as rows"
    >
      <GridStageHeader
        visibleStages={visibleStages}
        gutterW={GUTTER_W}
        minColWidth={minColW}
        exporting={exporting}
        onExport={exportGrid}
        getStageColor={getStageColor}
        getStageName={getStageName}
      />

      {/* Scrollable body */}
      <div
        className="fk-grid__body flex flex-1 min-h-0 overflow-x-auto overflow-y-auto pt-2 overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
        role="rowgroup"
        data-scroll-sentinel
        data-grid-body
      >
        {/* Time gutter */}
        <div
          className="relative shrink-0 border-r border-border-light bg-bg-primary sticky left-0 z-5"
          role="presentation"
          style={{ height: totalH, width: GUTTER_W }}
          data-grid-gutter
        >
          {hours.map(({ m, px }) => (
            <span
              key={m}
              className="absolute right-2 -translate-y-1/2 text-[length:var(--font-size-10)] text-text-muted whitespace-nowrap leading-[var(--line-height-tight)] pointer-events-none tabular-nums"
              style={{ top: px }}
            >
              {fmtHour(m)}
            </span>
          ))}
        </div>

        {/* Columns wrapper */}
        <div className="flex flex-1 min-w-0 relative" role="presentation" data-grid-cols>
          {nowPx != null && (
            <div
              className="absolute left-0 right-0 flex items-center pointer-events-none z-[8] -translate-y-1/2"
              style={{ top: nowPx }}
            >
              <span
                className="text-[length:var(--font-size-10)] font-bold text-accent-coral tracking-[0.08em] px-1 whitespace-nowrap shrink-0 tabular-nums"
                aria-hidden="true"
              >
                &#9654; NOW
              </span>
              <div className="flex-1 h-0.5 bg-accent-coral opacity-80 shadow-[0_0_6px_color-mix(in_srgb,var(--color-accent-coral)_70%,transparent)] animate-[fk-grid-now-pulse_2.4s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:opacity-85" />
            </div>
          )}

          {visibleStages.map((st) => (
            <GridStageColumn
              key={st.id}
              stageId={st.id}
              stageSets={setsByStage.get(st.id) || []}
              stageColor={getStageColor(st.id)}
              stageName={getStageName(st.id)}
              hours={hours}
              bounds={bounds}
              totalH={totalH}
              pxPerMin={PX_PER_MIN}
              minColWidth={minColW}
              b2bSeparator={currentFestival.b2bSeparator}
              getMyPick={getMyPick}
              getOverlapCount={getOverlapCount}
              onSetClick={setDetailSet}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
