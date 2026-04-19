import React from 'react';

/**
 * Skeleton for /account — avatar, username field, password section, and
 * push-notifications block. Matches the stacked card layout of AccountPage.
 */
export default function AccountSkeleton() {
  return (
    <div
      className="space-y-4 px-4 pb-24"
      aria-busy="true"
      aria-label="Loading account"
    >
      {/* avatar row */}
      <div
        className="p-4 rounded-lg"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
        }}
      >
        <div className="skeleton" style={{ height: 64, width: 64, borderRadius: '50%' }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="skeleton" style={{ height: 14, width: '50%' }} />
          <div className="skeleton" style={{ height: 32, width: 120, borderRadius: 6 }} />
        </div>
      </div>

      {/* form cards */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="p-4 rounded-lg"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div className="skeleton" style={{ height: 16, width: '40%' }} />
          <div className="skeleton" style={{ height: 40, width: '100%', borderRadius: 6 }} />
          {i !== 2 && (
            <div className="skeleton" style={{ height: 40, width: '100%', borderRadius: 6 }} />
          )}
          <div className="skeleton" style={{ height: 36, width: 120, borderRadius: 6, marginTop: 4 }} />
        </div>
      ))}
    </div>
  );
}
