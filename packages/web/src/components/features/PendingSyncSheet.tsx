import React from 'react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import type { FailedSyncItem } from '@festie/shared/stores/uiStore';
import { cn } from '../../lib/utils';

/**
 * Render a compact "N seconds/minutes ago" string from an epoch-ms timestamp.
 * Inlined (not shared) so this surface has no cross-platform dependency.
 */
function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0 || !Number.isFinite(diff)) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Re-enqueue a single failed mutation through the global web offline queue and
 * kick a drain, then drop it from the failed list. Feature-detects
 * window.__festieQueue so it's a no-op if the bridge isn't mounted yet.
 */
function retryItem(item: FailedSyncItem): void {
  const q = typeof window !== 'undefined' ? window.__festieQueue : undefined;
  if (q?.queueMutation) {
    Promise.resolve(
      q.queueMutation({
        type: 'api',
        url: item.url,
        method: item.method,
        body: item.body,
        clientId: item.clientId,
      }),
    )
      .then(() => q.processQueue?.())
      .catch(() => {
        /* a re-failure will re-add it to the list via processQueue */
      });
  }
  // Optimistically clear it; if the retry fails again the queue re-reports it.
  useUIStore.getState().dismissFailedSync(item.clientId);
}

interface PendingSyncSheetProps {
  onClose: () => void;
}

/**
 * A small modal panel listing offline writes that couldn't sync (uiStore
 * failedSync). Each row offers Retry (re-enqueue + drain) and Dismiss; the
 * footer offers Retry all / Dismiss all. Opened from OfflineBanner's failed
 * state — this is the user-facing half of the "no silent drops" contract.
 */
export default function PendingSyncSheet({ onClose }: PendingSyncSheetProps) {
  const failedSync = useUIStore((state) => state.failedSync);
  const dismissFailedSync = useUIStore((state) => state.dismissFailedSync);
  const clearFailedSync = useUIStore((state) => state.clearFailedSync);

  // If the list empties (e.g. user dismissed the last item), close the sheet.
  React.useEffect(() => {
    if (failedSync.length === 0) onClose();
  }, [failedSync.length, onClose]);

  const handleRetryAll = () => {
    // Snapshot before mutating the store as we iterate.
    [...failedSync].forEach(retryItem);
  };

  if (failedSync.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Changes that couldn't sync"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[80vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-bg-secondary border border-border-default shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default sticky top-0 bg-bg-secondary">
          <h2 className="text-sm font-bold text-text-primary">
            {failedSync.length} change{failedSync.length === 1 ? '' : 's'} couldn&apos;t sync
          </h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors p-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <ul className="divide-y divide-border-default">
          {failedSync.map((item) => (
            <li key={item.clientId} className="px-4 py-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary truncate">{item.label}</p>
                <p className="text-xs text-text-secondary mt-0.5">
                  <span className="text-accent-coral">{item.error}</span>
                  <span className="mx-1">·</span>
                  {timeAgo(item.at)}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => retryItem(item)}
                  className="text-xs font-bold px-2 py-1 rounded bg-accent-aqua/15 text-accent-aqua hover:bg-accent-aqua/25 min-h-[36px]"
                >
                  Retry
                </button>
                <button
                  onClick={() => dismissFailedSync(item.clientId)}
                  className="text-xs font-medium px-2 py-1 rounded text-text-secondary hover:text-text-primary min-h-[36px]"
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div
          className={cn(
            'flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default',
            'sticky bottom-0 bg-bg-secondary',
          )}
        >
          <button
            onClick={() => clearFailedSync()}
            className="text-xs font-medium px-3 py-2 rounded text-text-secondary hover:text-text-primary"
          >
            Dismiss all
          </button>
          <button
            onClick={handleRetryAll}
            className="text-xs font-bold px-3 py-2 rounded bg-accent-aqua/15 text-accent-aqua hover:bg-accent-aqua/25"
          >
            Retry all
          </button>
        </div>
      </div>
    </div>
  );
}
