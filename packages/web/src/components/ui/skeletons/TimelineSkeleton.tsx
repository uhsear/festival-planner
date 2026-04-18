import React from 'react';

/**
 * Skeleton mirroring `.timeline-grid` — a 4-stage column layout with 5
 * staggered placeholder set blocks. Matches TimelineView's grid template so
 * the lazy-route swap in feels seamless on mobile.
 */
export default function TimelineSkeleton() {
  const stages = 4;
  const slots = 16;

  return (
    <div
      className="timeline-container"
      aria-busy="true"
      aria-label="Loading timeline"
      role="region"
    >
      <div
        className="timeline-grid"
        style={{
          gridTemplateColumns: `52px repeat(${stages}, minmax(0, 1fr))`,
          gridTemplateRows: `auto repeat(${slots}, 28px)`,
          position: 'relative',
        }}
      >
        {/* corner */}
        <div className="timeline-header-cell" />
        {/* stage headers */}
        {Array.from({ length: stages }).map((_, i) => (
          <div key={`h-${i}`} className="timeline-header-cell">
            <div className="skeleton" style={{ height: 14, width: '60%', margin: '0 auto' }} />
          </div>
        ))}

        {/* time-axis labels */}
        {Array.from({ length: slots }).map((_, i) => (
          <div
            key={`t-${i}`}
            className="timeline-time-cell"
            style={{ gridRow: i + 2, gridColumn: 1 }}
          >
            {i % 2 === 0 ? (
              <div className="skeleton" style={{ height: 10, width: 32 }} />
            ) : null}
          </div>
        ))}

        {/* placeholder set blocks — staggered across columns/rows */}
        {[
          { col: 1, row: 1, span: 3 },
          { col: 2, row: 2, span: 4 },
          { col: 3, row: 4, span: 3 },
          { col: 4, row: 6, span: 5 },
          { col: 2, row: 10, span: 4 },
        ].map((b, i) => (
          <div
            key={`s-${i}`}
            className="skeleton"
            style={{
              gridRow: `${b.row + 1} / span ${b.span}`,
              gridColumn: b.col + 1,
              margin: '1px 2px',
              borderRadius: 6,
              opacity: 0.65,
            }}
          />
        ))}
      </div>
    </div>
  );
}
