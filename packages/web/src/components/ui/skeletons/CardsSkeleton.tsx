import React from 'react';

/**
 * Layout-matched skeleton for /cards. Renders 6 placeholder tiles inside the
 * same `.card-grid` container used by CardsView so the page doesn't jolt when
 * the real content streams in — identical column count, gap, and tile height.
 */
export default function CardsSkeleton() {
  return (
    <div className="card-grid" aria-busy="true" aria-label="Loading sets" role="region">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="card-enter"
          style={{ animationDelay: `${Math.min(i * 30, 180)}ms` }}
        >
          <div
            className="skeleton"
            style={{
              height: 150,
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 14,
              background: 'var(--bg-card, rgba(255,255,255,0.03))',
              border: '1px solid var(--border, rgba(255,255,255,0.06))',
            }}
          >
            <div className="skeleton" style={{ height: 18, width: '70%' }} />
            <div className="skeleton" style={{ height: 12, width: '40%' }} />
            <div className="skeleton" style={{ height: 12, width: '55%', marginTop: 'auto' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
