import { useCallback, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, radii } from '@festie/shared/tokens';
import { useFestivalDataStore } from '@festie/shared/stores';
import type { Festival } from '@festie/shared/types';
import { formatFestivalDateRange, festivalStatus, type FestivalStatus } from '@festie/shared/utils';
import { Skeleton } from './Skeleton';

// Status pill styling. The list endpoint now provides startDate/endDate, so a
// festival classifies as upcoming/ongoing/past. Returns null when undetermined.
function statusBadge(status: FestivalStatus | null): { label: string; bg: string; fg: string } | null {
  switch (status) {
    case 'ongoing':
      return { label: 'Live', bg: colors.accent.aqua, fg: colors.text.onAccent };
    case 'upcoming':
      return { label: 'Upcoming', bg: colors.bg.secondary, fg: colors.accent.aqua };
    case 'past':
      return { label: 'Past', bg: colors.bg.secondary, fg: colors.text.muted };
    default:
      return null;
  }
}

interface FestivalCardProps {
  festival: Festival;
  onPress: (id: string) => void;
  isSelecting: boolean;
}

function FestivalCard({ festival, onPress, isSelecting }: FestivalCardProps) {
  const dateRange = formatFestivalDateRange(festival.startDate, festival.endDate);
  const status = festivalStatus(festival);
  const badge = statusBadge(status);
  // Past festivals are kept (you can still open last year's), but de-emphasized
  // so the live/upcoming ones the user almost always wants read first.
  const isPast = status === 'past';
  // Compose the card's pieces into one accessible name so a screen reader reads
  // "<name>, <status>, <dates>, <location>" as a single button instead of fragments.
  const a11yLabel = [festival.name, badge?.label, dateRange, festival.location].filter(Boolean).join(', ');
  return (
    <TouchableOpacity
      testID={`festival-card-${festival.id}`}
      style={[styles.card, isPast && styles.cardPast]}
      onPress={() => onPress(festival.id)}
      activeOpacity={0.7}
      disabled={isSelecting}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ disabled: isSelecting }}
    >
      <View style={styles.cardContent}>
        <View style={styles.titleRow}>
          <Text style={styles.festivalName} numberOfLines={2} ellipsizeMode="tail">
            {festival.name}
          </Text>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
            </View>
          ) : null}
        </View>
        {dateRange ? (
          <View style={styles.metaRow}>
            <Ionicons
              name="calendar-outline"
              size={14}
              color={colors.text.secondary}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={styles.metaText}>{dateRange}</Text>
          </View>
        ) : null}
        {festival.location ? (
          <View style={styles.metaRow}>
            <Ionicons
              name="location-outline"
              size={14}
              color={colors.text.secondary}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={styles.metaText} numberOfLines={1}>
              {festival.location}
            </Text>
          </View>
        ) : null}
      </View>
      <Ionicons
        name="chevron-forward"
        size={20}
        color={colors.text.muted}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </TouchableOpacity>
  );
}

// Stable separator component — avoids recreating on every render.
function ListSeparator() {
  return <View style={styles.separator} />;
}

export default function FestivalList() {
  const festivals = useFestivalDataStore((s) => s.festivals);
  const isLoading = useFestivalDataStore((s) => s.isLoading);
  const error = useFestivalDataStore((s) => s.error);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);
  const selectFestival = useFestivalDataStore((s) => s.selectFestival);

  // Order: live first, then upcoming (soonest first), then past (most recent
  // first), so the festivals a user is most likely choosing sit at the top.
  const sortedFestivals = useMemo(() => {
    // Pre-compute status + sort rank per festival ONCE, then sort by the cached
    // rank instead of re-deriving festivalStatus on every comparison (O(n) vs
    // O(n log n) calls).
    const ranked = festivals.map((f) => {
      const s = festivalStatus(f);
      const r = s === 'ongoing' ? 0 : s === 'past' ? 2 : 1;
      return { f, r, start: f.startDate || '' };
    });
    ranked.sort((a, b) => {
      if (a.r !== b.r) return a.r - b.r;
      // ISO date strings sort lexicographically. Past = most recent first.
      return a.r === 2 ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start);
    });
    return ranked.map(({ f }) => f);
  }, [festivals]);

  const handleRefresh = useCallback(() => {
    loadFestivals().catch(() => {});
  }, [loadFestivals]);

  const handleSelect = useCallback(
    (id: string) => {
      // [festie-diag] temporary instrumentation for the guest-selection E2E failure
      console.log('[festie-diag] festival card tapped', id);
      selectFestival(id).catch((e: unknown) => {
        console.log('[festie-diag] selectFestival rejected', e instanceof Error ? e.message : String(e));
      });
    },
    [selectFestival],
  );

  const renderItem = useCallback(
    ({ item }: { item: Festival }) => <FestivalCard festival={item} onPress={handleSelect} isSelecting={isLoading} />,
    [handleSelect, isLoading],
  );

  const keyExtractor = useCallback((item: Festival) => item.id, []);

  // Initial loading state (no data yet) — skeleton cards matching the real list
  // geometry instead of a bare spinner.
  if (isLoading && festivals.length === 0) {
    return (
      <View style={styles.listContent} accessibilityRole="progressbar" accessibilityLabel="Loading festivals">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.skeletonCard}>
            <View style={styles.skeletonBody}>
              <Skeleton width="64%" height={18} radius={radii.xs} />
              <Skeleton width="44%" height={14} radius={radii.xs} />
              <Skeleton width="52%" height={14} radius={radii.xs} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  // Error state with retry
  if (error && festivals.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.status.error} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
          <Ionicons name="refresh" size={18} color={colors.text.onAccent} />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Empty state
  if (!isLoading && festivals.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="musical-notes-outline" size={48} color={colors.text.muted} />
        <Text style={styles.emptyTitle}>No festivals available</Text>
        <Text style={styles.emptySubtitle}>Pull down to refresh</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={sortedFestivals}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={ListSeparator}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={handleRefresh}
          tintColor={colors.accent.aqua}
          colors={[colors.accent.aqua]}
          progressBackgroundColor={colors.bg.secondary}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: colors.bg.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[6],
  },
  errorText: {
    fontSize: fontSize[14],
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing[1],
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.accent.aqua,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: radii.default,
    marginTop: spacing[2],
  },
  retryText: {
    fontSize: fontSize[14],
    fontWeight: '600',
    color: colors.text.onAccent,
  },
  emptyTitle: {
    fontSize: fontSize[18],
    fontWeight: '600',
    color: colors.text.primary,
  },
  emptySubtitle: {
    fontSize: fontSize[14],
    color: colors.text.secondary,
  },
  listContent: {
    padding: spacing[4],
  },
  separator: {
    height: spacing[3],
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.card,
    borderRadius: radii.default,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing[4],
  },
  // Past festivals are de-emphasized structurally, not with a card-wide opacity.
  // opacity:0.55 dropped the text below AA and is invisible to screen readers;
  // a recessed background + lighter border (mirroring filterChipOff in
  // app/(tabs)/index.tsx) gives the same "recessed" cue while the existing "Past"
  // badge carries the explicit status.
  cardPast: {
    backgroundColor: colors.bg.primary,
    borderColor: colors.border.light,
  },
  skeletonCard: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.default,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  skeletonBody: {
    gap: spacing[2],
  },
  cardContent: {
    flex: 1,
    gap: spacing[1],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  festivalName: {
    flex: 1,
    fontSize: fontSize[18],
    // Reserve vertical headroom so the 700-weight glyphs (descenders/diacritics)
    // are not clipped when the OS bumps font scale on tablets/large-text settings.
    lineHeight: fontSize[24],
    fontWeight: '700',
    color: colors.text.primary,
  },
  badge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  badgeText: {
    fontSize: fontSize[12],
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  metaText: {
    fontSize: fontSize[14],
    color: colors.text.secondary,
  },
});
