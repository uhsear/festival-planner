import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useCrewStore, useFestivalDataStore, useUIStore } from '@festie/shared/stores';
import { formatLastSynced, offlineReadyLabel } from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';

type Surface = 'crew' | 'schedule';

interface UpdatedAgoBadgeProps {
  /**
   * Which cache timestamp drives the label:
   *  - `crew`     → crewStore._cachedAt
   *  - `schedule` → festivalDataStore._festivalCachedAt
   */
  surface: Surface;
}

/**
 * Compact "Updated Xm ago · offline-ready" badge. Unlike the richer
 * FreshnessChip, this is the minimal honest-freshness line composed entirely
 * from the SHARED helpers (`formatLastSynced` + `offlineReadyLabel`) — the
 * single source of truth web and mobile both render from — so the two stay in
 * parity. Use it on surfaces that don't already carry a FreshnessChip (e.g. the
 * Now & Next live schedule + the crew totem header).
 *
 * The "Updated N ago" value advances from the device clock — even on a cold
 * offline launch — via a 30s tick. The "· offline-ready" suffix only appears
 * once the surface has been cached at least once AND the device is offline.
 *
 * Renders nothing until the surface has been cached at least once.
 */
export default function UpdatedAgoBadge({ surface }: UpdatedAgoBadgeProps) {
  const t = useTokens();
  const styles = useStyles();

  const offlineMode = useUIStore((s) => s.offlineMode);
  const crewCachedAt = useCrewStore((s) => s._cachedAt);
  const festivalCachedAt = useFestivalDataStore((s) => s._festivalCachedAt);
  const cachedAt = surface === 'crew' ? crewCachedAt : festivalCachedAt;

  // Re-render on a 30s tick so the "Updated N ago" label keeps advancing from
  // the device clock with no network.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (cachedAt == null) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [cachedAt]);

  const updated = formatLastSynced(cachedAt);
  if (!updated) return null;

  // Only claim offline-ready when we're actually offline but have a cache to
  // stand on — otherwise the time alone is the honest line.
  const showOfflineReady = offlineMode && offlineReadyLabel(cachedAt) != null;
  const label = showOfflineReady ? `${updated} · offline-ready` : updated;

  return (
    <View style={styles.badge} accessibilityRole="text" accessibilityLabel={label}>
      <View
        style={[styles.dot, { backgroundColor: showOfflineReady ? t.colors.accent.amber : t.colors.text.muted }]}
        accessible={false}
      />
      <Text
        style={[styles.text, showOfflineReady && styles.textOffline]}
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.secondary,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  textOffline: {
    color: t.colors.accent.amber,
  },
}));
