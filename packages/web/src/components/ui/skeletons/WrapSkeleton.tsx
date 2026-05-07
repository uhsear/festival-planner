/**
 * Skeleton for /wrap — 4-stat row + top-5 set leaderboard. Matches WrapPage's
 * summary layout so the route-chunk + ratings fetch can land without jolt.
 */
export default function WrapSkeleton() {
  return (
    <div className="space-y-4 px-4 pb-24" aria-busy="true" aria-label="Loading wrap">
      {/* hero header */}
      <div className="flex flex-col items-center gap-2.5 py-6">
        <div className="skeleton h-7 w-[200px]" />
        <div className="skeleton h-3.5 w-[140px]" />
      </div>

      {/* stats grid — 4 tiles */}
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="skeleton h-[88px] rounded-xl opacity-75"
          />
        ))}
      </div>

      {/* top-sets leaderboard */}
      <div className="flex flex-col gap-2.5">
        <div className="skeleton h-4 w-[120px]" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3"
          >
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="skeleton h-3.5 w-[60%]" />
              <div className="skeleton h-2.5 w-[35%]" />
            </div>
            <div className="skeleton h-3.5 w-9" />
          </div>
        ))}
      </div>
    </div>
  );
}
