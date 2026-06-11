import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useCrewStore, useFestivalDataStore, useUIStore } from '@festie/shared/stores';
import { timeAgo } from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';

type Surface = 'crew' | 'schedule';

interface FreshnessChipProps {
  /**
   * Which cache timestamp drives the freshness label:
   *  - `crew`     → crewStore._cachedAt (crew surfaces)
   *  - `schedule` → festivalDataStore._festivalCachedAt (schedule surfaces)
   */
  surface: Surface;
}

/**
 * Offline-honest freshness chip. Renders "Synced N ago" when online or
 * "Showing offline data · synced N ago" when `uiStore.offlineMode` is set,
 * with a small "N queued" badge driven by `uiStore.pendingSync`.
 *
 * The relative-time label comes from the SHARED `timeAgo` util (single source
 * of truth across web + mobile). The "N ago" value advances from the device
 * clock — even on a cold offline launch — via a 30s tick.
 *
 * Renders nothing until the surface has been cached at least once.
 */
export default function FreshnessChip({ surface }: FreshnessChipProps) {
  const t = useTokens();
  const styles = useStyles();

  const offlineMode = useUIStore((s) => s.offlineMode);
  const pendingSync = useUIStore((s) => s.pendingSync);
  const crewCachedAt = useCrewStore((s) => s._cachedAt);
  const festivalCachedAt = useFestivalDataStore((s) => s._festivalCachedAt);
  const cachedAt = surface === 'crew' ? crewCachedAt : festivalCachedAt;

  // Re-render on a 30s tick so "synced N ago" keeps advancing from the device
  // clock without any network.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (cachedAt == null) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [cachedAt]);

  if (cachedAt == null) return null;

  const label = offlineMode ? `Showing offline data · synced ${timeAgo(cachedAt)}` : `Synced ${timeAgo(cachedAt)}`;

  const a11yLabel = pendingSync > 0 ? `${label}, ${pendingSync} change${pendingSync === 1 ? '' : 's'} queued` : label;

  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel={a11yLabel}>
      <View style={[styles.chip, offlineMode ? styles.chipOffline : styles.chipOnline]}>
        <View
          style={[styles.dot, { backgroundColor: offlineMode ? t.colors.accent.amber : t.colors.accent.aqua }]}
          accessible={false}
        />
        <Text style={[styles.chipText, offlineMode && styles.chipTextOffline]} numberOfLines={1}>
          {label}
        </Text>
      </View>

      {pendingSync > 0 ? (
        <View style={styles.queuedBadge} accessible={false}>
          <Text style={styles.queuedText}>{pendingSync} queued</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
  },
  chipOnline: {
    backgroundColor: t.colors.bg.secondary,
  },
  chipOffline: {
    backgroundColor: t.colors.amberAlpha[12],
    borderWidth: 1,
    borderColor: t.colors.accent.amber,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  chipTextOffline: {
    color: t.colors.accent.amber,
  },
  queuedBadge: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[15],
  },
  queuedText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
}));
