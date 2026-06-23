import React, { useEffect, useState } from 'react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { cn } from '../../lib/utils';
import PendingSyncSheet from './PendingSyncSheet';

const DISMISS_KEY = 'fp-offline-banner-dismissed';

/**
 * Banner surfacing the offline-sync state. Three states, in priority order:
 *
 *  1. FAILED  — failedSync.length > 0: a coral/warning bar "{n} change(s)
 *     couldn't sync" with a button that opens the PendingSyncSheet to retry or
 *     dismiss each one. Highest priority because dropped writes are the thing
 *     the user most needs to know about.
 *  2. OFFLINE — offlineMode: amber "You're offline — changes will sync when you
 *     reconnect", plus the pending count.
 *  3. SYNCING — online with pendingSync > 0: aqua "Syncing {n} change(s)…" with
 *     a Flush-now escape hatch.
 *
 * Dismissal of the OFFLINE state persists for the session (sessionStorage) so a
 * reload while offline doesn't re-nag; it's cleared on reconnect. The FAILED
 * state is intentionally NOT dismissible from the banner (the user must act on
 * it via the sheet) so a silent drop can't slip by.
 */
export default function OfflineBanner() {
  const offlineMode = useUIStore((state) => state.offlineMode);
  const pendingSync = useUIStore((state) => state.pendingSync);
  const failedSync = useUIStore((state) => state.failedSync);
  const failedCount = failedSync.length;

  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  });
  const [sheetOpen, setSheetOpen] = useState(false);

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

  const handleFlush = () => {
    const q = window.__festieQueue;
    if (q?.processQueue) q.processQueue().catch(() => {});
  };

  // ── State resolution (FAILED > OFFLINE > SYNCING) ─────────────────
  const showFailed = failedCount > 0;
  const showOffline = offlineMode && !dismissed;
  const showSyncing = !offlineMode && pendingSync > 0;

  // The failed sheet can be open even when no other banner state is active.
  if (!showFailed && !showOffline && !showSyncing) {
    return sheetOpen ? <PendingSyncSheet onClose={() => setSheetOpen(false)} /> : null;
  }

  // FAILED takes the bar; offline/syncing render only when there's no failure.
  let tone: string;
  let message: string;
  if (showFailed) {
    tone = 'bg-[var(--color-accent-coral-strong)] border-b border-[var(--color-accent-coral-strong-hover)] text-[var(--color-text-on-accent)]';
    message = `${failedCount} change${failedCount === 1 ? '' : 's'} couldn't sync`;
  } else if (showOffline) {
    tone = 'bg-accent-amber/90 border-b border-accent-amber/20 text-bg-primary';
    message = "You're offline. Changes will sync when you reconnect.";
  } else {
    tone = 'bg-accent-aqua/90 border-b border-accent-aqua/20 text-bg-primary';
    message = `Syncing ${pendingSync} pending change${pendingSync === 1 ? '' : 's'}…`;
  }

  return (
    <>
      <div
        className={cn(
          'fixed top-0 left-0 right-0 z-40 px-4 py-3 flex items-center justify-between gap-3',
          tone,
          'backdrop-blur-xl',
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-2 h-2 rounded-full bg-bg-primary animate-pulse flex-shrink-0" />
          <span className="text-sm font-medium truncate">{message}</span>
          {!showFailed && pendingSync > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-bg-primary/20 text-xs font-medium flex-shrink-0">
              {pendingSync}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {showFailed && (
            <button
              onClick={() => setSheetOpen(true)}
              className="text-xs font-bold px-2 py-1 rounded bg-bg-primary/10 hover:bg-bg-primary/20 min-h-[44px]"
            >
              Review
            </button>
          )}
          {!showFailed && showSyncing && (
            <button
              onClick={handleFlush}
              className="text-xs font-bold px-2 py-1 rounded bg-bg-primary/10 hover:bg-bg-primary/20 min-h-[44px]"
            >
              Flush now
            </button>
          )}
          {!showFailed && showOffline && (
            <button
              onClick={handleDismiss}
              className="text-bg-primary hover:opacity-70 transition-opacity p-1"
              aria-label="Dismiss offline notice"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {sheetOpen && <PendingSyncSheet onClose={() => setSheetOpen(false)} />}
    </>
  );
}
