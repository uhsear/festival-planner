import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react';
// html-to-image is dynamic-imported inside exportGrid so it only loads when the
// user taps Export (saves ~50 KB gzipped from the initial grid-route chunk).
import { Share2 } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { artistDisplayName } from '@festie/shared/utils';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';

// PX_PER_MIN adapts to viewport width: narrower mobile → denser (1.6 px/min)
// so a 7-hour day fits in ≤ 680 px and the user still sees most of the day at
// once. On tablet/desktop we keep 2 px/min (120 px/hr) for readability.
function getPxPerMin(viewportW: number): number {
  if (viewportW <= 360) return 1.4;
  if (viewportW <= 430) return 1.6;
  return 2;
}

const PICK_COLOR: Record<string, string> = {
  must: 'var(--color-accent-coral)',
  'want-to-see': 'var(--color-accent-aqua)',
  maybe: 'var(--color-accent-amber)',
};

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fmtHour(totalMin: number): string {
  const h = Math.floor(totalMin / 60) % 24;
  return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
}

function fmtShort(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
}

function getGutterW(viewportW: number): number {
  if (viewportW <= 430) return 38;
  return 52;
}

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

  const [exporting, setExporting] = useState(false);

  const exportGrid = useCallback(async () => {
    if (!gridRef.current || exporting) return;
    setExporting(true);
    const dayName = selectedDay === 0 ? 'saturday' : 'sunday';
    const el = gridRef.current;
    const body = el.querySelector<HTMLElement>('.fk-grid__body');
    const cols = el.querySelector<HTMLElement>('.fk-grid__cols');
    const head = el.querySelector<HTMLElement>('.fk-grid__head');
    if (!body || !cols || !head) return;

    const dpr = Math.min(Math.max(Math.ceil(window.devicePixelRatio || 1), 2), 3);
    const saved = {
      elOverflow: el.style.overflow,
      elHeight: el.style.height,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      bodyWidth: body.style.width,
      headWidth: head.style.width,
      colsMinWidth: cols.style.minWidth,
    };
    try {
      const fullW = Math.max(cols.scrollWidth + (el.querySelector<HTMLElement>('.fk-grid__gutter')?.offsetWidth || 0), el.clientWidth);
      const fullH = Math.max(cols.scrollHeight + head.offsetHeight, el.clientHeight);

      el.style.overflow = 'visible';
      el.style.height = fullH + 'px';
      body.style.overflow = 'visible';
      body.style.height = (cols.scrollHeight) + 'px';
      body.style.width = fullW + 'px';
      head.style.width = fullW + 'px';
      cols.style.minWidth = fullW - (el.querySelector<HTMLElement>('.fk-grid__gutter')?.offsetWidth || 0) + 'px';

      await new Promise(r => setTimeout(r, 50));
      if (document.fonts?.ready) await document.fonts.ready;

      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(el, {
        backgroundColor: '#080810',
        pixelRatio: dpr,
        width: fullW,
        height: fullH,
        cacheBust: true,
      });
      if (!blob) throw new Error('Capture failed');

      const filename = `festie-${dayName}-grid.png`;
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${dayName} Grid` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: filename });
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e: unknown) {
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (!isAbort) console.error('Export failed', e);
    } finally {
      el.style.overflow = saved.elOverflow;
      el.style.height = saved.elHeight;
      body.style.overflow = saved.bodyOverflow;
      body.style.height = saved.bodyHeight;
      body.style.width = saved.bodyWidth;
      head.style.width = saved.headWidth;
      cols.style.minWidth = saved.colsMinWidth;
      setExporting(false);
    }
  }, [selectedDay, exporting]);

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

  // Pre-compute stageId → sets map once per render instead of filtering inside
  // every column .map() iteration. With 4 stages × 33 sets the filter ran 132×
  // before; now it's O(n) once.
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
  }, [bounds]);

  const nowPx = useMemo(() => {
    if (!bounds) return null;
    const now = new Date();
    const nm = now.getHours() * 60 + now.getMinutes();
    if (nm < bounds.lo || nm > bounds.hi) return null;
    return (nm - bounds.lo) * PX_PER_MIN;
  }, [bounds]);

  // Auto-scroll to NOW on mount (only when NOW is within the day's bounds).
  // Centers the line in the viewport so the user sees what's happening AND
  // what's about to start. Guarded by a ref so day-switches don't re-pull
  // the scroll after the user has already scrolled elsewhere.
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
    <div className="fk-grid-wrap">
      <button
        className="fk-grid__share-btn"
        onClick={exportGrid}
        title="Share grid"
        aria-label="Share grid as image"
        aria-busy={exporting ? 'true' : 'false'}
        disabled={exporting}
        type="button"
      >
        <Share2 size={15} aria-hidden="true" />
      </button>
    <div className="fk-grid" ref={gridRef} role="grid" aria-label="Festival schedule grid — stages as columns, time as rows">
      {/* ── Sticky stage-header row ── */}
      <div
        className="fk-grid__head"
        role="row"
        style={{
          gridTemplateColumns: `${GUTTER_W}px repeat(${visibleStages.length}, minmax(${vw <= 430 ? '92px' : '110px'}, 1fr))`,
        }}
      >
        <div role="columnheader" aria-label="Time" />
        {visibleStages.map((st) => {
          const c = getStageColor(st.id);
          return (
            <div
              key={st.id}
              className="fk-grid__col-head"
              role="columnheader"
              style={{ '--stage-c': c } as React.CSSProperties}
            >
              {getStageName(st.id)}
            </div>
          );
        })}
      </div>

      {/* ── Scrollable body ── */}
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
          {/* Now overlay */}
          {nowPx != null && (
            <div className="fk-grid__now-overlay" style={{ top: nowPx }}>
              <span className="fk-grid__now-label" aria-hidden="true">▶ NOW</span>
              <div className="fk-grid__now-line" />
            </div>
          )}

          {/* Stage columns */}
          {visibleStages.map((st) => {
            const c = getStageColor(st.id);
            const stageSets = setsByStage.get(st.id) || [];

            return (
              <div
                key={st.id}
                className="fk-grid__col"
                role="row"
                aria-label={getStageName(st.id)}
                style={{ height: totalH, '--stage-c': c } as React.CSSProperties}
              >
                {hours.map(({ m, px }) => (
                  <div key={m} className="fk-grid__line--hour" style={{ top: px }} />
                ))}
                {hours.slice(0, -1).map(({ m, px }) => (
                  <div key={`h-${m}`} className="fk-grid__line--half" style={{ top: px + 30 * PX_PER_MIN }} />
                ))}

                {stageSets.map((set) => {
                  const a = toMin(set.startTime!);
                  let b = toMin(set.endTime!);
                  if (b <= a) b += 1440;
                  const top    = (a - bounds.lo) * PX_PER_MIN;
                  // WCAG 2.5.5 — tap targets should be ≥44px. A 15-min set at
                  // PX_PER_MIN=1.6 is only 24px, so bump to 44 even if it
                  // overlaps slightly with the next slot (they're side-by-side
                  // in separate stage columns so no actual overlap happens).
                  const height = Math.max((b - a) * PX_PER_MIN, 44);
                  const pick   = getMyPick(set.id);
                  const pc     = pick ? PICK_COLOR[pick] : c;
                  const dn     = artistDisplayName(set, currentFestival.b2bSeparator);

                  return (
                    <button
                      key={set.id}
                      role="gridcell"
                      className={`fk-grid__set${pick ? ' fk-grid__set--picked' : ''}`}
                      style={
                        {
                          top,
                          height,
                          '--set-c': pc,
                          borderLeftColor: pc,
                          background: pick
                            ? `color-mix(in srgb, ${pc} 28%, #0d0d1a)`
                            : pc + '15',
                        } as React.CSSProperties
                      }
                      onClick={() => setDetailSet(set)}
                      aria-label={`${dn} at ${getStageName(st.id) || st.id}, ${fmtShort(set.startTime!)} to ${fmtShort(set.endTime!)}${pick ? ', ' + pick : ''}`}
                    >
                      {pick && (
                        <span className="fk-grid__pick-heart" style={{ color: pc }} aria-hidden="true">
                          ♥
                        </span>
                      )}
                      <span className="fk-grid__set-name">{dn}</span>
                      {height >= 48 && (
                        <span className="fk-grid__set-time">
                          {fmtShort(set.startTime!)}–{fmtShort(set.endTime!)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
}
