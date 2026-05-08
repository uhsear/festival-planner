/**
 * Skeleton mirroring the `.fk-grid` 4-column layout used by /grid. Reserves
 * sticky stage-header row + scrollable body area so the route's
 * chunk-load doesn't shift the viewport.
 */
export default function GridSkeleton() {
  const cols = 4;
  const _gutter = 52;

  return (
    <div className="fk-grid" aria-busy="true" aria-label="Loading grid">
      {/* sticky header row */}
      <div
        className="fk-grid__head grid-cols-[52px_repeat(4,1fr)]"
      >
        <div />
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="fk-grid__col-head">
            <div className="skeleton mx-auto h-3.5 w-[60%]" />
          </div>
        ))}
      </div>

      {/* body */}
      <div className="fk-grid__body">
        <div className="fk-grid__gutter h-[600px]">
          {[0, 1, 2, 3, 4, 5, 6].map((h) => (
            <span
              key={h}
              className="fk-grid__hour-label"
              style={{ top: h * 90 }}
              aria-hidden="true"
            >
              <span className="skeleton inline-block h-2.5 w-7" />
            </span>
          ))}
        </div>
        <div className="fk-grid__cols">
          {Array.from({ length: cols }).map((_, ci) => (
            <div key={ci} className="fk-grid__col h-[600px]">
              {[0, 1, 2].map((bi) => (
                <div
                  key={bi}
                  className="skeleton absolute left-1.5 right-1.5 h-[110px] rounded-md opacity-60"
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
