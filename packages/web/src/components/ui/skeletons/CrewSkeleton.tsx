import React from 'react';

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
        <div className="skeleton" style={{ height: 40, width: '100%', borderRadius: 8 }} />
      </div>

      <div className="space-y-4 px-4">
        {/* home-base card */}
        <div
          className="skeleton"
          style={{ height: 96, width: '100%', borderRadius: 12, opacity: 0.7 }}
        />

        {/* invite bar */}
        <div
          className="p-3 rounded-lg"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="skeleton" style={{ height: 10, width: 80 }} />
            <div className="skeleton" style={{ height: 12, width: '60%' }} />
          </div>
          <div className="skeleton" style={{ height: 36, width: 72, borderRadius: 6 }} />
        </div>

        {/* tab row */}
        <div style={{ display: 'flex', gap: 6 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{ height: 40, flex: 1, borderRadius: 8, minWidth: 64 }}
            />
          ))}
        </div>

        {/* member rows */}
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
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
              <div className="skeleton" style={{ height: 40, width: 40, borderRadius: '50%' }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="skeleton" style={{ height: 14, width: '55%' }} />
                <div className="skeleton" style={{ height: 10, width: '30%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
