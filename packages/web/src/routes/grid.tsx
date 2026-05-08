import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { getPxPerMin, getGutterW, toMin, fmtHour } from '../components/grid/gridUtils';
import { useGridExport } from '../components/grid/useGridExport';
import GridStageHeader from '../components/grid/GridStageHeader';
import GridStageColumn from '../components/grid/GridStageColumn';

export default function GridView() {
  return (
    <RenderErrorBoundary name="grid">
      <GridViewInner />
    </RenderErrorBoundary>
  );
}

function GridViewInner() {
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const sets            = useFestivalStore((s) => s.sets);
  const stages          = useFestivalStore((s) => s.stages);
  const selectedDay     = useFestivalStore((s) => s.selectedDay);
  const activeStages    = useFestivalStore((s) => s.activeStages);
  const setDetailSet    = useUIStore((s) => s.setDetailSet);
  const { getMyPick }   = usePicks();
  const { getStageColor, getStageName } = useFestival();
  const gridRef = useRef<HTMLDivElement>(null);

  // Track viewport width so PX_PER_MIN + GUTTER_W can adapt on rotate/resize.
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const PX_PER_MIN = getPxPerMin(vw);
  const GUTTER_W = getGutterW(vw);

  const { exporting, exportGrid } = useGridExport(gridRef, selectedDay);

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
          (activeStages.length === 0 ||
            activeStages.length === stages.length ||
            activeStages.includes(s.stageId)),
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
    let lo = Infinity, hi = 0;
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
    for (let m = bounds.lo; m <= bounds.hi; m += 60)
      out.push({ m, px: (m - bounds.lo) * PX_PER_MIN });
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
    const body = gridRef.current.querySelector<HTMLElement>('.fk-grid__body');
    if (!body) return;
    const target = Math.max(0, nowPx - body.clientHeight / 2);
    body.scrollTo({ top: target, behavior: 'auto' });
    didAutoScroll.current = true;
  }, [nowPx]);

  if (!currentFestival)
    return (
      <div className="no-festival" role="status">
        <p>No festival selected.</p>
      </div>
    );
  if (!timedSets.length || !bounds)
    return (
      <div className="no-festival" role="status">
        <p>No timed sets to display.</p>
      </div>
    );

  const totalH = bounds.span * PX_PER_MIN;

  return (
    <div className="fk-grid" ref={gridRef} role="grid" aria-label="Festival schedule grid — stages as columns, time as rows">
      <GridStageHeader
        visibleStages={visibleStages}
        gutterW={GUTTER_W}
        minColWidth={vw <= 430 ? '92px' : '110px'}
        exporting={exporting}
        onExport={exportGrid}
        getStageColor={getStageColor}
        getStageName={getStageName}
      />

      {/* Scrollable body */}
      <div className="fk-grid__body" role="rowgroup" data-scroll-sentinel>
        {/* Time gutter */}
        <div className="fk-grid__gutter" role="presentation" style={{ height: totalH }}>
          {hours.map(({ m, px }) => (
            <span key={m} className="fk-grid__hour-label" style={{ top: px }}>
              {fmtHour(m)}
            </span>
          ))}
        </div>

        {/* Columns wrapper */}
        <div className="fk-grid__cols" role="presentation">
          {nowPx != null && (
            <div className="fk-grid__now-overlay" style={{ top: nowPx }}>
              <span className="fk-grid__now-label" aria-hidden="true">&#9654; NOW</span>
              <div className="fk-grid__now-line" />
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
              b2bSeparator={currentFestival.b2bSeparator}
              getMyPick={getMyPick}
              onSetClick={setDetailSet}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
