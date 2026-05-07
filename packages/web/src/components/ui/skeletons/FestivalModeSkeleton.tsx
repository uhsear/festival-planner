/**
 * Skeleton for /festival-mode — reserves the header + two sections (NOW and
 * UP NEXT) with `.fm-set-card` placeholders that match the live-render tree.
 */
export default function FestivalModeSkeleton() {
  return (
    <div className="festival-mode-view" aria-busy="true" aria-label="Loading festival mode">
      <div className="fm-header">
        <div className="skeleton h-[18px] w-[180px]" />
        <div className="skeleton h-3.5 w-[60px]" />
      </div>

      {(['NOW', 'UP NEXT'] as const).map((label) => (
        <section key={label} className="fm-section" aria-label={`Loading ${label}`}>
          <h2 className="fm-section-title" aria-hidden="true">
            <span>{label === 'NOW' ? '🔴' : '⏭'}</span> {label}
          </h2>
          {[0, 1].slice(0, label === 'NOW' ? 1 : 2).map((i) => (
            <div
              key={i}
              className="fm-set-card flex flex-col gap-2"
            >
              <div className="skeleton h-[22px] w-[65%]" />
              <div className="skeleton h-3.5 w-2/5" />
              <div className="skeleton h-3 w-[35%]" />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
