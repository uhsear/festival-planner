/**
 * Skeleton for /wrap — 4-stat row + top-5 set leaderboard. Matches WrapPage's
 * summary layout so the route-chunk + ratings fetch can land without jolt.
 */
export default function WrapSkeleton() {
  return (
    <div className="space-y-4 px-4 pb-24" aria-busy="true" aria-label="Loading wrap">
      {/* hero header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', padding: '24px 0' }}>
        <div className="skeleton" style={{ height: 28, width: 200 }} />
        <div className="skeleton" style={{ height: 14, width: 140 }} />
      </div>

      {/* stats grid — 4 tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="skeleton"
            style={{ height: 88, borderRadius: 12, opacity: 0.75 }}
          />
        ))}
      </div>

      {/* top-sets leaderboard */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="skeleton" style={{ height: 16, width: 120 }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="p-3 rounded-lg"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              display: 'flex',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <div className="skeleton" style={{ height: 32, width: 32, borderRadius: '50%' }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="skeleton" style={{ height: 14, width: '60%' }} />
              <div className="skeleton" style={{ height: 10, width: '35%' }} />
            </div>
            <div className="skeleton" style={{ height: 14, width: 36 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
