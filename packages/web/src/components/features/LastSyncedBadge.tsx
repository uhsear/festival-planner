import React, { useEffect, useState } from 'react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useFestivalDataStore } from '@festie/shared/stores/festivalDataStore';
import { formatLastSynced, offlineReadyLabel } from '@festie/shared/utils';
import { Check, WifiOff } from 'lucide-react';
import { cn } from '../../lib/utils';

type Surface = 'crew' | 'schedule';

interface LastSyncedBadgeProps {
  /**
   * Which cache timestamp drives the freshness label:
   *  - `crew`     → crewStore._cachedAt (crew surfaces)
   *  - `schedule` → festivalDataStore._festivalCachedAt (schedule surfaces)
   */
  surface: Surface;
  className?: string;
}

/**
 * Compact "Updated Xm ago" / "Offline-ready" badge — staleness made explicit so
 * users trust stale-but-present data over a spinner.
 *
 * The honest line comes from the SHARED `formatLastSynced` / `offlineReadyLabel`
 * helpers (single source of truth across web + mobile): online shows "Updated N
 * ago"; offline (uiStore.offlineMode) appends " · Offline-ready" once the surface
 * has actually been cached. The relative value advances from the device clock —
 * even on a cold offline launch — via a 30s tick.
 *
 * Renders nothing until the surface has been cached at least once (no timestamp →
 * no honest claim to make).
 */
export default function LastSyncedBadge({ surface, className }: LastSyncedBadgeProps) {
  const offlineMode = useUIStore((s) => s.offlineMode);
  const crewCachedAt = useCrewStore((s) => s._cachedAt);
  const festivalCachedAt = useFestivalDataStore((s) => s._festivalCachedAt);
  const cachedAt = surface === 'crew' ? crewCachedAt : festivalCachedAt;

  // Re-render on a 30s tick so "Updated N ago" keeps advancing from the device
  // clock without any network — the cardinal offline-honesty requirement.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (cachedAt == null) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [cachedAt]);

  const updated = formatLastSynced(cachedAt);
  if (!updated) return null;

  const offlineReady = offlineMode && offlineReadyLabel(cachedAt) === 'offline-ready';

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="last-synced-badge"
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
        offlineReady
          ? 'bg-accent-amber/15 text-accent-amber ring-1 ring-accent-amber/30'
          : 'bg-text-secondary/10 text-text-secondary',
        className,
      )}
    >
      {offlineReady ? (
        <WifiOff className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
      ) : (
        <Check className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
      )}
      <span>
        {updated}
        {offlineReady ? ' · Offline-ready' : ''}
      </span>
    </span>
  );
}
