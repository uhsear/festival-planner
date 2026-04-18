import React from 'react';

/**
 * Skeleton for /festival-mode — reserves the header + two sections (NOW and
 * UP NEXT) with `.fm-set-card` placeholders that match the live-render tree.
 */
export default function FestivalModeSkeleton() {
  return (
    <div className="festival-mode-view" aria-busy="true" aria-label="Loading festival mode">
      <div className="fm-header">
        <div className="skeleton" style={{ height: 18, width: 180 }} />
        <div className="skeleton" style={{ height: 14, width: 60 }} />
      </div>

      {(['NOW', 'UP NEXT'] as const).map((label) => (
        <section key={label} className="fm-section" aria-label={`Loading ${label}`}>
          <h2 className="fm-section-title" aria-hidden="true">
            <span>{label === 'NOW' ? '🔴' : '⏭'}</span> {label}
          </h2>
          {[0, 1].slice(0, label === 'NOW' ? 1 : 2).map((i) => (
            <div
              key={i}
              className="fm-set-card"
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <div className="skeleton" style={{ height: 22, width: '65%' }} />
              <div className="skeleton" style={{ height: 14, width: '40%' }} />
              <div className="skeleton" style={{ height: 12, width: '35%' }} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
