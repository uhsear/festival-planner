import React from 'react';

/**
 * Layout-matched skeleton for /cards. Renders 8 placeholder tiles inside the
 * same `.card-grid` container used by CardsView so the page doesn't jolt when
 * the real content streams in — identical column count, gap, padding, and
 * tile height (~190 px, matching real `.set-card` total box: 18 padding +
 * 11 stage pill + 10 gap + 20 artist + 4 gap + 13 time + 12 gap + 44 footer
 * + 18 padding). Bumping from 6 → 8 covers the typical first-fold on
 * desktop (3-col × 3 rows partial) without over-reserving on mobile where
 * only the first 2 are visible above the fold.
 *
 * Inner placeholder uses a non-animated frame + animated bars to avoid the
 * full-tile shimmer flashing the whole card — cheaper on mobile and reads
 * more like "loading content" than "loading tile".
 */
export default function CardsSkeleton() {
  return (
    <div className="card-grid" aria-busy="true" aria-label="Loading sets" role="region">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="card-enter"
          style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}
        >
          <div
            style={{
              height: 190,
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 18,
              background: 'var(--bg-card, rgba(20,20,38,0.65))',
              border: '1px solid var(--border-light, rgba(255,255,255,0.1))',
              borderLeft: '4px solid transparent',
              backdropFilter: 'blur(8px)',
            }}
          >
            {/* Stage pill */}
            <div className="skeleton" style={{ height: 18, width: 72, borderRadius: 6 }} />
            {/* Artist name */}
            <div className="skeleton" style={{ height: 22, width: '75%', marginTop: 4 }} />
            {/* Time */}
            <div className="skeleton" style={{ height: 13, width: '45%' }} />
            {/* Footer: priority buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
              <div className="skeleton" style={{ height: 36, width: 36, borderRadius: '50%' }} />
              <div className="skeleton" style={{ height: 36, width: 36, borderRadius: '50%' }} />
              <div className="skeleton" style={{ height: 36, width: 36, borderRadius: '50%' }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
