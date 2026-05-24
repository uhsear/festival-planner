/**
 * Skeleton mirroring the grid layout used by /grid. Reserves sticky
 * stage-header row + scrollable body area so the route's chunk-load
 * doesn't shift the viewport.
 */
export default function GridSkeleton() {
  const cols = 4;

  return (
    <div
      className="fk-grid flex flex-col h-full min-h-0 overflow-hidden bg-bg-primary"
      aria-busy="true"
      aria-label="Loading grid"
    >
      {/* sticky header row */}
      <div
        className="fk-grid__head grid shrink-0 bg-bg-primary border-b border-border-light sticky top-0 z-10 grid-cols-[52px_repeat(4,1fr)]"
        data-grid-head
      >
        <div />
        {Array.from({ length: cols }).map((_, i) => (
          <div
            key={i}
            className="fk-grid__col-head py-2 px-1.5 mx-[3px] my-1 text-[0.65rem] font-bold uppercase tracking-[0.06em] text-center text-text-primary rounded-full leading-[1.25] overflow-hidden text-ellipsis whitespace-nowrap"
            data-grid-col-head
          >
            <div className="skeleton-shimmer mx-auto h-3.5 w-[60%]" />
          </div>
        ))}
      </div>

      {/* body */}
      <div
        className="fk-grid__body flex flex-1 min-h-0 overflow-x-auto overflow-y-auto pt-2 overscroll-contain"
        data-grid-body
      >
        <div
          className="relative shrink-0 w-[52px] border-r border-border-light bg-bg-primary sticky left-0 z-5 h-[600px]"
          data-grid-gutter
        >
          {[0, 1, 2, 3, 4, 5, 6].map((h) => (
            <span
              key={h}
              className="absolute right-2 -translate-y-1/2 text-[length:var(--font-size-10)] text-text-muted whitespace-nowrap leading-[var(--line-height-tight)] pointer-events-none tabular-nums"
              style={{ top: h * 90 }}
              aria-hidden="true"
              data-grid-hour-label
            >
              <span className="skeleton-shimmer inline-block h-2.5 w-7" />
            </span>
          ))}
        </div>
        <div className="flex flex-1 min-w-0 relative" data-grid-cols>
          {Array.from({ length: cols }).map((_, ci) => (
            <div
              key={ci}
              className="fk-grid__col relative flex-1 min-w-[110px] border-l border-border h-[600px]"
              data-grid-col
            >
              {[0, 1, 2].map((bi) => (
                <div
                  key={bi}
                  className="skeleton-shimmer absolute left-1.5 right-1.5 h-[110px] rounded-md opacity-60"
                  style={{
                    top: 60 + bi * 190 + ci * 15,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
