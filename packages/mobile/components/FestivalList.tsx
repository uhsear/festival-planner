import { useCallback, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFestivalDataStore } from '@festie/shared/stores';
import type { Festival } from '@festie/shared/types';
import { formatFestivalDateRange, festivalStatus, type FestivalStatus } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { Skeleton } from './Skeleton';

// Status pill styling. The list endpoint now provides startDate/endDate, so a
// festival classifies as upcoming/ongoing/past. Returns null when undetermined.
function statusBadge(status: FestivalStatus | null): { label: string; bg: string; fg: string } | null {
  // F6: Live badge fg must be onLightAccent (#080810) not onAccent (white).
  // White (#fff) on aqua (#00e8d0) is only ~1.45:1 — fails WCAG AA.
  // onLightAccent is the token-documented AA-safe pair for aqua fills.
  switch (status) {
    case 'ongoing':
      return { label: 'Live', bg: 'aqua', fg: 'onLightAccent' };
    case 'upcoming':
      return { label: 'Upcoming', bg: 'secondary', fg: 'aqua' };
    case 'past':
      return { label: 'Past', bg: 'secondary', fg: 'muted' };
    default:
      return null;
  }
}

interface FestivalCardProps {
  festival: Festival;
  onPress: (id: string) => void;
  isSelecting: boolean;
}

// useStyles must be defined at module level (makeStyles caches the sheet).
const useStyles = makeStyles((t) => ({
  centered: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[6],
  },
  // F20: empty/error states are wrapped in a flexGrow ScrollView so the
  // RefreshControl gesture works even when there is no list content.
  scrollCentered: {
    flexGrow: 1,
    backgroundColor: t.colors.bg.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[6],
  },
  errorText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
    textAlign: 'center',
    marginTop: t.spacing[1],
  },
  retryButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing[2],
    backgroundColor: t.colors.accent.aqua,
    paddingHorizontal: t.spacing[5],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    marginTop: t.spacing[2],
  },
  // F6: retry icon and text use onLightAccent (dark ink) on aqua fill — AA safe.
  retryText: {
    ...typeStyle('label'),
    fontWeight: '600' as const,
    color: t.colors.text.onLightAccent,
  },
  emptyTitle: {
    // F7: festival name uses typeStyle('title') — Space Grotesk 600 brand face.
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  emptySubtitle: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  listContent: {
    padding: t.spacing[4],
  },
  separator: {
    height: t.spacing[3],
  },
  card: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: t.colors.bg.card,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
  },
  // Past festivals are de-emphasized structurally, not with a card-wide opacity.
  // opacity:0.55 dropped the text below AA and is invisible to screen readers;
  // a recessed background + lighter border (mirroring filterChipOff in
  // app/(tabs)/index.tsx) gives the same "recessed" cue while the existing "Past"
  // badge carries the explicit status.
  cardPast: {
    backgroundColor: t.colors.bg.primary,
    borderColor: t.colors.border.light,
  },
  skeletonCard: {
    backgroundColor: t.colors.bg.card,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    marginBottom: t.spacing[3],
  },
  skeletonBody: {
    gap: t.spacing[2],
  },
  cardContent: {
    flex: 1,
    gap: t.spacing[1],
  },
  titleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing[2],
  },
  festivalName: {
    flex: 1,
    // F7: typeStyle('title') resolves to Space Grotesk 600 — brand face.
    // Reserve lineHeight headroom so 600-weight glyphs (descenders/diacritics)
    // are not clipped when the OS bumps font scale on tablets/large-text settings.
    ...typeStyle('title'),
    lineHeight: Math.round(t.fontSize[24] * 1.3),
    color: t.colors.text.primary,
  },
  badge: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 2,
    borderRadius: t.radii.pill,
  },
  badgeText: {
    // F7: typeStyle('micro') gives Space Grotesk 600 uppercase — brand face.
    ...typeStyle('micro'),
  },
  metaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing[2],
  },
  metaText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
}));

function FestivalCard({ festival, onPress, isSelecting }: FestivalCardProps) {
  const styles = useStyles();
  const t = useTokens();
  const dateRange = formatFestivalDateRange(festival.startDate, festival.endDate);
  const status = festivalStatus(festival);
  const badgeSpec = statusBadge(status);
  const isPast = status === 'past';

  // Resolve badge colors from tokens at render time.
  const badgeBgColor = badgeSpec?.bg === 'aqua' ? t.colors.accent.aqua : t.colors.bg.secondary;
  const badgeFgColor =
    badgeSpec?.fg === 'onLightAccent'
      ? t.colors.text.onLightAccent
      : badgeSpec?.fg === 'aqua'
        ? t.colors.accent.aqua
        : t.colors.text.muted;

  // Compose the card's pieces into one accessible name so a screen reader reads
  // "<name>, <status>, <dates>, <location>" as a single button instead of fragments.
  const a11yLabel = [festival.name, badgeSpec?.label, dateRange, festival.location].filter(Boolean).join(', ');

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
          {badgeSpec ? (
            <View style={[styles.badge, { backgroundColor: badgeBgColor }]}>
              <Text style={[styles.badgeText, { color: badgeFgColor }]}>{badgeSpec.label}</Text>
            </View>
          ) : null}
        </View>
        {dateRange ? (
          <View style={styles.metaRow}>
            <Ionicons
              name="calendar-outline"
              size={14}
              color={t.colors.text.secondary}
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
              color={t.colors.text.secondary}
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
        color={t.colors.text.muted}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </TouchableOpacity>
  );
}

// Stable separator component — avoids recreating on every render.
function ListSeparator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

export default function FestivalList() {
  const styles = useStyles();
  const t = useTokens();
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
      // Failure feedback comes from the store error state (rendered by the
      // schedule's error empty-state), so the rejection itself is non-fatal.
      selectFestival(id).catch(() => {});
    },
    [selectFestival],
  );

  const renderItem = useCallback(
    ({ item }: { item: Festival }) => <FestivalCard festival={item} onPress={handleSelect} isSelecting={isLoading} />,
    [handleSelect, isLoading],
  );

  const keyExtractor = useCallback((item: Festival) => item.id, []);

  const refreshControl = (
    <RefreshControl
      refreshing={isLoading}
      onRefresh={handleRefresh}
      tintColor={t.colors.accent.aqua}
      colors={[t.colors.accent.aqua]}
      progressBackgroundColor={t.colors.bg.secondary}
    />
  );

  // Initial loading state (no data yet) — skeleton cards matching the real list
  // geometry instead of a bare spinner.
  if (isLoading && festivals.length === 0) {
    return (
      <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel="Loading festivals">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.skeletonCard}>
            <View style={styles.skeletonBody}>
              <Skeleton width="64%" height={18} radius={t.radii.xs} />
              <Skeleton width="44%" height={14} radius={t.radii.xs} />
              <Skeleton width="52%" height={14} radius={t.radii.xs} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  // Error state with retry — wrapped in ScrollView so pull-to-refresh works.
  if (error && festivals.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.scrollCentered} refreshControl={refreshControl}>
        <Ionicons name="alert-circle-outline" size={48} color={t.colors.status.error} />
        <Text style={styles.errorText}>{error}</Text>
        {/* F6: retry icon uses onLightAccent (dark ink) on aqua fill — AA safe. */}
        <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
          <Ionicons name="refresh" size={18} color={t.colors.text.onLightAccent} />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Empty state — F20: wrap in ScrollView with RefreshControl so the
  // "Pull down to refresh" gesture actually works; the static View branch
  // had no RefreshControl, making the instruction impossible to follow.
  if (!isLoading && festivals.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.scrollCentered} refreshControl={refreshControl}>
        <Ionicons name="musical-notes-outline" size={48} color={t.colors.text.muted} />
        <Text style={styles.emptyTitle}>No festivals available</Text>
        <Text style={styles.emptySubtitle}>Pull down to refresh</Text>
      </ScrollView>
    );
  }

  return (
    <FlatList
      data={sortedFestivals}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={ListSeparator}
      refreshControl={refreshControl}
    />
  );
}
