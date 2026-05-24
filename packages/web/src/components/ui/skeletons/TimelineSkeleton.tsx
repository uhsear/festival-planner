import { cn } from '../../../lib/utils';

/**
 * Skeleton mirroring the timeline grid — a 4-stage column layout with 5
 * staggered placeholder set blocks. Matches TimelineView's grid template so
 * the lazy-route swap in feels seamless on mobile.
 */
export default function TimelineSkeleton() {
  const stages = 4;
  const slots = 16;

  return (
    <div
      className="relative overflow-auto h-full [-webkit-overflow-scrolling:touch] overscroll-contain"
      aria-busy="true"
      aria-label="Loading timeline"
      role="region"
    >
      <div
        className={cn(
          'timeline-grid',
          'grid relative min-w-[800px] gap-0',
          'grid-cols-[52px_repeat(4,minmax(0,1fr))]',
          'grid-rows-[auto_repeat(16,28px)]',
        )}
      >
        {/* corner */}
        <div
          className={cn(
            'timeline-header-cell',
            'sticky top-0 z-10 text-center',
            'bg-[rgba(10,10,20,0.95)] backdrop-blur-[8px]',
            'border-b-2 border-b-[var(--color-border)]',
            'font-bold uppercase tracking-[1.5px]',
            // Mobile: smaller text, tight padding, allow wrapping
            'text-[0.6rem] leading-[1.2] px-0.5 py-1 whitespace-normal break-words overflow-hidden',
            // Desktop: restore full sizing
            'md:text-[11px] md:leading-normal md:px-2 md:py-2.5',
          )}
        />
        {/* stage headers */}
        {Array.from({ length: stages }).map((_, i) => (
          <div
            key={`h-${i}`}
            className={cn(
              'timeline-header-cell',
              'sticky top-0 z-10 text-center',
              'bg-[rgba(10,10,20,0.95)] backdrop-blur-[8px]',
              'border-b-2 border-b-[var(--color-border)]',
              'font-bold uppercase tracking-[1.5px]',
              // Mobile: smaller text, tight padding, allow wrapping
              'text-[0.6rem] leading-[1.2] px-0.5 py-1 whitespace-normal break-words overflow-hidden',
              // Desktop: restore full sizing
              'md:text-[11px] md:leading-normal md:px-2 md:py-2.5',
            )}
          >
            <div className="skeleton-shimmer mx-auto h-3.5 w-[60%]" />
          </div>
        ))}

        {/* time-axis labels */}
        {Array.from({ length: slots }).map((_, i) => (
          <div
            key={`t-${i}`}
            className={cn(
              'timeline-time-cell',
              'sticky left-0 z-5',
              'px-2.5 py-1',
              'text-[11px] font-semibold text-[var(--color-text-muted)]',
              'bg-[var(--color-bg-primary)]',
              'border-r border-r-[var(--color-border)]',
              'flex items-start justify-end whitespace-nowrap',
              'tabular-nums',
            )}
            style={{ gridRow: i + 2, gridColumn: 1 }}
          >
            {i % 2 === 0 ? (
              <div className="skeleton-shimmer h-2.5 w-8" />
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
            className="skeleton-shimmer m-[1px_2px] rounded-md opacity-65"
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
