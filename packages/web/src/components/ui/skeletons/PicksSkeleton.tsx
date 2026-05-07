/**
 * Skeleton for /picks — three priority sections (Must / Want / Maybe) with
 * 2-3 placeholder rows each, mirroring `.picks-section` + `.pick-item`.
 */
export default function PicksSkeleton() {
  return (
    <div className="picks-container" aria-busy="true" aria-label="Loading picks" role="region">
      {[
        { label: 'Must See', count: 3, dot: 'var(--priority-must)' },
        { label: 'Want to See', count: 2, dot: 'var(--priority-want)' },
        { label: 'Maybe', count: 2, dot: 'var(--priority-maybe)' },
      ].map((section) => (
        <div key={section.label} className="picks-section">
          <div className="picks-section-title">
            <div className="dot" style={{ background: section.dot }} />
            <span>{section.label}</span>
          </div>
          {Array.from({ length: section.count }).map((_, i) => (
            <div
              key={i}
              className="pick-item flex flex-col gap-1.5 pointer-events-none"
            >
              <div className="skeleton h-2.5 w-[30%]" />
              <div className="skeleton h-4 w-[70%]" />
              <div className="skeleton mt-0.5 h-3 w-[35%]" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
