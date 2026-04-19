import { useEffect } from 'react';

/**
 * Generic error fallback for TanStack Router's `errorComponent` prop.
 * Catches render crashes per-route so a single broken page doesn't
 * produce a white screen. Logs the error for Sentry / console debugging.
 */
export default function RouteErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[route error]', error);
  }, [error]);

  return (
    <div className="no-festival" role="alert">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Something went wrong</h2>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, margin: '8px 0 16px' }}>
        An unexpected error occurred. Try reloading the page.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => reset()}>
          Try again
        </button>
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    </div>
  );
}
