/**
 * Skeleton for /festival-mode — reserves the header + two sections (NOW and
 * UP NEXT) with card placeholders that match the live-render tree.
 */
export default function FestivalModeSkeleton() {
  return (
    <div className="px-4 max-w-[500px] mx-auto pb-[calc(20px+env(safe-area-inset-bottom,0px))]" aria-busy="true" aria-label="Loading festival mode">
      <div className="flex justify-between items-baseline mb-5">
        <div className="skeleton-shimmer h-[18px] w-[180px]" />
        <div className="skeleton-shimmer h-3.5 w-[60px]" />
      </div>

      {(['NOW', 'UP NEXT'] as const).map((label) => (
        <section key={label} className="mb-5" aria-label={`Loading ${label}`}>
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-2 leading-[1.15] font-display" aria-hidden="true">
            <span>{label === 'NOW' ? '🔴' : '⏭'}</span> {label}
          </h2>
          {[0, 1].slice(0, label === 'NOW' ? 1 : 2).map((i) => (
            <div
              key={i}
              className="fm-set-card block w-full text-left py-3.5 px-4 bg-glass rounded-xl border border-border mb-2 flex flex-col gap-2"
            >
              <div className="skeleton-shimmer h-[22px] w-[65%]" />
              <div className="skeleton-shimmer h-3.5 w-2/5" />
              <div className="skeleton-shimmer h-3 w-[35%]" />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
