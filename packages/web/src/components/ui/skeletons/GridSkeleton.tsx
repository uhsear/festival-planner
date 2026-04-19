import React from 'react';

/**
 * Skeleton mirroring the `.fk-grid` 4-column layout used by /grid. Reserves
 * toolbar + sticky stage-header row + scrollable body area so the route's
 * chunk-load doesn't shift the viewport.
 */
export default function GridSkeleton() {
  const cols = 4;
  const gutter = 52;

  return (
    <div className="fk-grid" aria-busy="true" aria-label="Loading grid">
      {/* toolbar */}
      <div className="fk-grid__toolbar">
        <div className="skeleton" style={{ height: 28, width: 120, borderRadius: 6 }} />
      </div>

      {/* sticky header row */}
      <div
        className="fk-grid__head"
        style={{ gridTemplateColumns: `${gutter}px repeat(${cols}, 1fr)` }}
      >
        <div />
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="fk-grid__col-head">
            <div className="skeleton" style={{ height: 14, width: '60%', margin: '0 auto' }} />
          </div>
        ))}
      </div>

      {/* body */}
      <div className="fk-grid__body">
        <div className="fk-grid__gutter" style={{ height: 600 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((h) => (
            <span
              key={h}
              className="fk-grid__hour-label"
              style={{ top: h * 90 }}
              aria-hidden="true"
            >
              <span className="skeleton" style={{ display: 'inline-block', height: 10, width: 28 }} />
            </span>
          ))}
        </div>
        <div className="fk-grid__cols">
          {Array.from({ length: cols }).map((_, ci) => (
            <div key={ci} className="fk-grid__col" style={{ height: 600 }}>
              {[0, 1, 2].map((bi) => (
                <div
                  key={bi}
                  className="skeleton"
                  style={{
                    position: 'absolute',
                    top: 60 + bi * 190 + ci * 15,
                    left: 6,
                    right: 6,
                    height: 110,
                    borderRadius: 6,
                    opacity: 0.6,
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
