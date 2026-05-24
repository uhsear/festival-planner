/**
 * Skeleton for /picks -- three priority sections (Must / Want / Maybe) with
 * 2-3 placeholder rows each, mirroring the picks section + item layout.
 */
export default function PicksSkeleton() {
  return (
    <div className="pb-5" aria-busy="true" aria-label="Loading picks" role="region">
      {[
        { label: 'Must See', count: 3, dot: 'var(--priority-must)' },
        { label: 'Want to See', count: 2, dot: 'var(--priority-want)' },
        { label: 'Maybe', count: 2, dot: 'var(--priority-maybe)' },
      ].map((section) => (
        <div key={section.label} className="mb-4 md:grid md:grid-cols-2 md:gap-x-4">
          <div className="relative overflow-hidden col-span-full font-display text-[11px] font-bold uppercase tracking-[3px] mb-3.5 pb-2.5 border-b border-border-light flex items-center gap-[var(--space-5)]">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: section.dot }} />
            <span>{section.label}</span>
          </div>
          {Array.from({ length: section.count }).map((_, i) => (
            <div
              key={i}
              className="pick-item grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-2 px-4 py-3 bg-bg-card backdrop-blur-[8px] border border-border rounded-[var(--radius-sm)] mb-1.5 flex flex-col gap-1.5 pointer-events-none"
            >
              <div className="skeleton-shimmer h-2.5 w-[30%]" />
              <div className="skeleton-shimmer h-4 w-[70%]" />
              <div className="skeleton-shimmer mt-0.5 h-3 w-[35%]" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
