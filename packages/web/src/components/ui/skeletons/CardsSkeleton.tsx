/**
 * Layout-matched skeleton for /cards. Renders 8 placeholder tiles inside the
 * same `.card-grid` container used by CardsView so the page doesn't jolt when
 * the real content streams in — identical column count, gap, padding, and
 * tile height (~190 px, matching real `.set-card` total box: 18 padding +
 * 11 stage pill + 10 gap + 20 artist + 4 gap + 13 time + 12 gap + 44 footer
 * + 18 padding). Bumping from 6 -> 8 covers the typical first-fold on
 * desktop (3-col x 3 rows partial) without over-reserving on mobile where
 * only the first 2 are visible above the fold.
 *
 * Inner placeholder uses a non-animated frame + animated bars to avoid the
 * full-tile shimmer flashing the whole card — cheaper on mobile and reads
 * more like "loading content" than "loading tile".
 */
export default function CardsSkeleton() {
  return (
    <div
      className="card-grid grid w-full [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-4 mx-auto pb-5 px-3 sm:px-4 md:gap-5 max-w-[1440px]"
      aria-busy="true"
      aria-label="Loading sets"
      role="region"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card-enter" style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}>
          <div className="flex h-[190px] flex-col gap-2.5 rounded-xl border border-[var(--color-aqua-a08)] bg-[var(--color-bg-card,rgba(20,20,38,0.65))] p-[18px] backdrop-blur-sm">
            {/* Stage pill */}
            <div className="skeleton-shimmer h-[18px] w-[72px] rounded-md" />
            {/* Artist name */}
            <div className="skeleton-shimmer mt-1 h-[22px] w-3/4" />
            {/* Time */}
            <div className="skeleton-shimmer h-[13px] w-[45%]" />
            {/* Footer: priority buttons */}
            <div className="mt-auto flex gap-2">
              <div className="skeleton-shimmer h-9 w-9 rounded-full" />
              <div className="skeleton-shimmer h-9 w-9 rounded-full" />
              <div className="skeleton-shimmer h-9 w-9 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
