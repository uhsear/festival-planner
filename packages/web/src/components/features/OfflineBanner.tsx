import React, { useEffect, useState } from 'react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { cn } from '../../lib/utils';

const DISMISS_KEY = 'fp-offline-banner-dismissed';

/**
 * Banner displayed when the app is offline.
 * Shows pending mutation count and allows dismissal.
 *
 * Dismissal persists for the session (via sessionStorage) so reloading
 * while offline doesn't re-show the banner. The flag is cleared when
 * the app comes back online.
 */
export default function OfflineBanner() {
  const offlineMode = useUIStore((state) => state.offlineMode);
  const pendingSync = useUIStore((state) => state.pendingSync);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  });

  // Clear the dismissal flag when we go back online, so the next offline
  // episode shows the banner again.
  useEffect(() => {
    if (!offlineMode) {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(DISMISS_KEY);
      }
      if (dismissed) setDismissed(false);
    }
  }, [offlineMode, dismissed]);

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(DISMISS_KEY, '1');
    }
  };

  if (!offlineMode || dismissed) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-40 px-4 py-3 flex items-center justify-between',
        'bg-accent-amber/90 backdrop-blur-xl border-b border-accent-amber/20',
        'text-bg-primary',
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-bg-primary animate-pulse" />
        <span className="text-sm font-medium">
          You're offline — changes will sync when you reconnect
        </span>
        {pendingSync > 0 && (
          <span className="ml-2 px-2 py-0.5 rounded-full bg-bg-primary/20 text-xs font-medium">
            {pendingSync} pending
          </span>
        )}
      </div>

      <button
        onClick={handleDismiss}
        className="text-bg-primary hover:opacity-70 transition-opacity p-1"
        aria-label="Dismiss offline notice"
      >
        ×
      </button>
    </div>
  );
}
