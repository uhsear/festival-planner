import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, radii } from '@festie/shared/tokens';
import { useFestivalDataStore } from '@festie/shared/stores';
import type { Festival } from '@festie/shared/types';

// The festivals LIST endpoint omits startDate/endDate (only the detail payload
// has them), so these can be undefined at runtime despite the Festival type.
// Return null on missing/unparseable dates so the row is hidden rather than
// rendering "Invalid Date" (Hermes is also stricter than V8 at parsing dates).
function formatDateRange(startDate?: string, endDate?: string): string | null {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', opts);
  const endStr = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

interface FestivalCardProps {
  festival: Festival;
  onPress: (id: string) => void;
  isSelecting: boolean;
}

function FestivalCard({ festival, onPress, isSelecting }: FestivalCardProps) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(festival.id)}
      activeOpacity={0.7}
      disabled={isSelecting}
    >
      <View style={styles.cardContent}>
        <Text style={styles.festivalName} numberOfLines={1}>
          {festival.name}
        </Text>
        {formatDateRange(festival.startDate, festival.endDate) ? (
          <View style={styles.metaRow}>
            <Ionicons
              name="calendar-outline"
              size={14}
              color={colors.text.secondary}
            />
            <Text style={styles.metaText}>
              {formatDateRange(festival.startDate, festival.endDate)}
            </Text>
          </View>
        ) : null}
        {festival.location ? (
          <View style={styles.metaRow}>
            <Ionicons
              name="location-outline"
              size={14}
              color={colors.text.secondary}
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
      />
    </TouchableOpacity>
  );
}

export default function FestivalList() {
  const festivals = useFestivalDataStore((s) => s.festivals);
  const isLoading = useFestivalDataStore((s) => s.isLoading);
  const error = useFestivalDataStore((s) => s.error);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);
  const selectFestival = useFestivalDataStore((s) => s.selectFestival);

  const handleRefresh = useCallback(() => {
    loadFestivals().catch(() => {});
  }, [loadFestivals]);

  const handleSelect = useCallback(
    (id: string) => {
      selectFestival(id).catch(() => {});
    },
    [selectFestival],
  );

  const renderItem = useCallback(
    ({ item }: { item: Festival }) => (
      <FestivalCard
        festival={item}
        onPress={handleSelect}
        isSelecting={isLoading}
      />
    ),
    [handleSelect, isLoading],
  );

  const keyExtractor = useCallback((item: Festival) => item.id, []);

  // Initial loading state (no data yet)
  if (isLoading && festivals.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accent.aqua} />
        <Text style={styles.loadingText}>Loading festivals...</Text>
      </View>
    );
  }

  // Error state with retry
  if (error && festivals.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons
          name="alert-circle-outline"
          size={48}
          color={colors.status.error}
        />
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
        <Ionicons
          name="musical-notes-outline"
          size={48}
          color={colors.text.muted}
        />
        <Text style={styles.emptyTitle}>No festivals available</Text>
        <Text style={styles.emptySubtitle}>
          Pull down to refresh
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={festivals}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
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
  loadingText: {
    fontSize: fontSize[16],
    color: colors.text.secondary,
    marginTop: spacing[2],
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
  cardContent: {
    flex: 1,
    gap: spacing[1],
  },
  festivalName: {
    fontSize: fontSize[18],
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: spacing[1],
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
