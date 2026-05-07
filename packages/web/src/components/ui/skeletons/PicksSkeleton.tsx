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
              className="pick-item"
              style={{ display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none' }}
            >
              <div className="skeleton" style={{ height: 10, width: '30%' }} />
              <div className="skeleton" style={{ height: 16, width: '70%' }} />
              <div className="skeleton" style={{ height: 12, width: '35%', marginTop: 2 }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
