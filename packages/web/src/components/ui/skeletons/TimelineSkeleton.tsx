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
        className="timeline-grid relative"
        style={{
          gridTemplateColumns: `52px repeat(${stages}, minmax(0, 1fr))`,
          gridTemplateRows: `auto repeat(${slots}, 28px)`,
        }}
      >
        {/* corner */}
        <div className="timeline-header-cell" />
        {/* stage headers */}
        {Array.from({ length: stages }).map((_, i) => (
          <div key={`h-${i}`} className="timeline-header-cell">
            <div className="skeleton mx-auto h-3.5 w-[60%]" />
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
              <div className="skeleton h-2.5 w-8" />
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
            className="skeleton m-[1px_2px] rounded-md opacity-65"
            style={{
              gridRow: `${b.row + 1} / span ${b.span}`,
              gridColumn: b.col + 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}
