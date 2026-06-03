import React, { useEffect, useState } from 'react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useFestivalDataStore } from '@festie/shared/stores/festivalDataStore';
import { timeAgo } from '@festie/shared/utils';
import { cn } from '../../lib/utils';

type Surface = 'crew' | 'schedule';

interface FreshnessChipProps {
  /**
   * Which cache timestamp drives the freshness label:
   *  - `crew`     → crewStore._cachedAt (crew surfaces)
   *  - `schedule` → festivalDataStore._festivalCachedAt (schedule surfaces)
   */
  surface: Surface;
  className?: string;
}

/**
 * Offline-honest freshness chip. Renders "Synced N ago" when online or
 * "Showing offline data · synced N ago" when `uiStore.offlineMode` is set,
 * with a small "N queued" badge driven by `uiStore.pendingSync`.
 *
 * The relative-time label comes from the SHARED `timeAgo` util (single source
 * of truth across web + mobile) and the cache timestamp from the relevant
 * store. The "N ago" value advances from the device clock — even on a cold
 * offline launch — via a 30s tick that re-reads `timeAgo` against `Date.now()`.
 *
 * Renders nothing until the surface has been cached at least once (no
 * timestamp → no honest claim to make).
 */
export default function FreshnessChip({ surface, className }: FreshnessChipProps) {
  const offlineMode = useUIStore((s) => s.offlineMode);
  const pendingSync = useUIStore((s) => s.pendingSync);
  const crewCachedAt = useCrewStore((s) => s._cachedAt);
  const festivalCachedAt = useFestivalDataStore((s) => s._festivalCachedAt);
  const cachedAt = surface === 'crew' ? crewCachedAt : festivalCachedAt;

  // Re-render on a 30s tick so "synced N ago" keeps advancing from the device
  // clock without any network — the cardinal offline-honesty requirement.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (cachedAt == null) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [cachedAt]);

  if (cachedAt == null) return null;

  const label = offlineMode ? `Showing offline data · synced ${timeAgo(cachedAt)}` : `Synced ${timeAgo(cachedAt)}`;

  return (
    <div className={cn('flex items-center gap-2 text-xs', className)} role="status" aria-live="polite">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-medium',
          offlineMode
            ? 'bg-accent-amber/15 text-accent-amber ring-1 ring-accent-amber/30'
            : 'bg-text-secondary/10 text-text-secondary',
        )}
      >
        <span
          className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', offlineMode ? 'bg-accent-amber' : 'bg-accent-aqua')}
          aria-hidden="true"
        />
        {label}
      </span>

      {pendingSync > 0 && (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent-aqua/15 text-accent-aqua font-semibold"
          aria-label={`${pendingSync} change${pendingSync === 1 ? '' : 's'} queued`}
        >
          {pendingSync} queued
        </span>
      )}
    </div>
  );
}
