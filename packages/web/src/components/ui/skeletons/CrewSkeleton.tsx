/**
 * Skeleton for /crew — crew selector + home-base card + invite bar + tab bar
 * + 3 member rows. Matches the authenticated CrewView layout so the page
 * doesn't jolt when the chunk + crew fetch resolve.
 */
export default function CrewSkeleton() {
  return (
    <div className="crew-page space-y-4 pb-24" aria-busy="true" aria-label="Loading crew">
      {/* crew selector */}
      <div className="px-4">
        <div className="skeleton h-10 w-full rounded-lg" />
      </div>

      <div className="space-y-4 px-4">
        {/* home-base card */}
        <div className="skeleton h-24 w-full rounded-xl opacity-70" />

        {/* invite bar */}
        <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="skeleton h-2.5 w-20" />
            <div className="skeleton h-3 w-[60%]" />
          </div>
          <div className="skeleton h-9 w-[72px] rounded-md" />
        </div>

        {/* tab row */}
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="skeleton h-10 min-w-16 flex-1 rounded-lg"
            />
          ))}
        </div>

        {/* member rows */}
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3"
            >
              <div className="skeleton h-10 w-10 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="skeleton h-3.5 w-[55%]" />
                <div className="skeleton h-2.5 w-[30%]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
