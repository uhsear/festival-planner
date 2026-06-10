import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity, ActivityIndicator, Alert, Share } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFestivalDataStore } from '@festie/shared/stores';
import { usePicks, useFestival } from '@festie/shared/hooks';
import type { FestivalSet, Priority, Stage } from '@festie/shared/types';
import { artistDisplayName, getConflictingSetIds, buildPicksIcs } from '@festie/shared/utils';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { useTokens, makeStyles, typeStyle } from '../../hooks/useTokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { duration as motionDuration } from '@festie/shared/tokens';
import { safeStageColor } from '../../lib/stageColor';
import ScreenHeader from '../../components/ScreenHeader';
import EmptyState from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import SetCardMobile from '../../components/SetCardMobile';

/**
 * Priority ordering + display metadata, mirroring the web /picks route. Sets
 * are grouped by day, then split into these three priority buckets in this
 * order, and finally sorted by start time (then artist name) within a bucket.
 */
const PRIORITY_SECTIONS: readonly { value: Priority; label: string }[] = [
  { value: 'must', label: 'Must See' },
  { value: 'want-to-see', label: 'Want to See' },
  { value: 'maybe', label: 'Maybe' },
];

/** Maps a priority to its accent token (matches SetCardMobile). */
function priorityColor(t: ReturnType<typeof useTokens>, p: Priority): string {
  if (p === 'must') return t.colors.priority.must;
  if (p === 'want-to-see') return t.colors.priority.want;
  return t.colors.priority.maybe;
}

/**
 * A flattened list row: either a day header, a priority section header, or a
 * picked set. Keeping everything in one FlatList (rather than nested .map in a
 * ScrollView) preserves list virtualization across the whole picks plan.
 */
type Row =
  | { kind: 'day'; key: string; label: string; count: number }
  | { kind: 'section'; key: string; label: string; color: string; count: number }
  | { kind: 'set'; key: string; set: FestivalSet };

export default function PicksScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  // Respect the iOS home indicator (~34pt on iPhone 12+/13+/14+) so the last
  // picks scroll clear of the tab bar / indicator with a little breathing room.
  // The static `listContent` style can't read `insets`, so layer it on inline.
  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) }],
    [styles.listContent, insets.bottom, t.spacing],
  );

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const sets = useFestivalDataStore((s) => s.sets);
  const stages = useFestivalDataStore((s) => s.stages);
  const isLoading = useFestivalDataStore((s) => s.isLoading);
  const error = useFestivalDataStore((s) => s.error);
  const selectFestival = useFestivalDataStore((s) => s.selectFestival);
  const bulkSavePicks = useFestivalDataStore((s) => s.bulkSavePicks);

  const [exportBusy, setExportBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPriority, setBulkPriority] = useState<Priority>('must');
  const [bulkBusyKey, setBulkBusyKey] = useState<string | null>(null);

  const { getMyPick, savePick, removePick, getMyNote } = usePicks();
  const { getDays, getStageColor, getStageName } = useFestival();

  const days = useMemo(() => getDays(), [getDays]);

  // Conflict highlighting mirrors the web schedule: any two picked sets whose
  // times overlap are flagged. Computed across all picked sets, not per-day.
  const conflictIds = useMemo(() => getConflictingSetIds(sets, getMyPick), [sets, getMyPick]);

  // Build the flattened row list: for each day (in order), for each priority
  // bucket (must → want → maybe), the picked sets sorted by start time then
  // artist name. Days/sections with no picks are skipped entirely.
  const rows = useMemo<Row[]>(() => {
    const separator = currentFestival?.b2bSeparator;
    const out: Row[] = [];

    days.forEach((day) => {
      const daySets = sets.filter((s) => s.dayIndex === day.index);

      const dayRows: Row[] = [];
      let dayCount = 0;

      PRIORITY_SECTIONS.forEach((section) => {
        const picked = daySets
          .filter((set) => getMyPick(set.id) === section.value)
          .sort((a, b) => {
            const timeA = a.startTime || '';
            const timeB = b.startTime || '';
            if (timeA && timeB) return timeA.localeCompare(timeB);
            if (timeA && !timeB) return -1;
            if (!timeA && timeB) return 1;
            return artistDisplayName(a, separator).localeCompare(artistDisplayName(b, separator), undefined, {
              sensitivity: 'base',
            });
          });

        if (picked.length === 0) return;

        dayCount += picked.length;
        dayRows.push({
          kind: 'section',
          key: `section-${day.index}-${section.value}`,
          label: section.label,
          color: priorityColor(t, section.value),
          count: picked.length,
        });
        picked.forEach((set) => {
          dayRows.push({ kind: 'set', key: `set-${set.id}`, set });
        });
      });

      if (dayCount === 0) return;

      out.push({
        kind: 'day',
        key: `day-${day.index}`,
        label: day.label || day.date,
        count: dayCount,
      });
      out.push(...dayRows);
    });

    return out;
  }, [days, sets, getMyPick, currentFestival?.b2bSeparator, t]);

  const handlePickChange = useCallback(
    (set: FestivalSet, priority: Priority | null) => {
      if (!currentFestival) return;
      if (priority === null) {
        removePick(currentFestival.id, set.id).catch(() => {});
      } else {
        savePick(currentFestival.id, set.id, priority).catch(() => {});
      }
    },
    [currentFestival, savePick, removePick],
  );

  // ── M2 bulk pick helpers ────────────────────────────────────────────────
  // Group the cached sets by stage and by artist genre so the user can add a
  // whole group ("all on Main Stage", "all techno") in ONE coalesced write via
  // festivalDataStore.bulkSavePicks (single PUT, offline-native + queued).
  // Computed purely from cached store data — no network reads.
  const stageGroups = useMemo(() => {
    const byStage = new Map<string, string[]>();
    for (const s of sets) {
      const arr = byStage.get(s.stageId);
      if (arr) arr.push(s.id);
      else byStage.set(s.stageId, [s.id]);
    }
    const order = new Map<string, number>();
    stages.forEach((st: Stage, i) => order.set(st.id, i));
    return [...byStage.entries()]
      .map(([stageId, setIds]) => ({ key: `stage-${stageId}`, label: getStageName(stageId) || 'Stage', setIds }))
      .sort((a, b) => (order.get(a.key.slice(6)) ?? 0) - (order.get(b.key.slice(6)) ?? 0));
  }, [sets, stages, getStageName]);

  const genreGroups = useMemo(() => {
    const byGenre = new Map<string, string[]>();
    // Lowercase only the dedupe KEY; keep the first-seen original casing for the
    // display label so genres like "drum and bass" / "UK garage" aren't mangled
    // by a textTransform:'capitalize'.
    const labelByKey = new Map<string, string>();
    for (const s of sets) {
      const seen = new Set<string>();
      for (const a of s.artists ?? []) {
        for (const g of a.genres ?? []) {
          const display = g.trim();
          const key = display.toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          if (!labelByKey.has(key)) labelByKey.set(key, display);
          const arr = byGenre.get(key);
          if (arr) arr.push(s.id);
          else byGenre.set(key, [s.id]);
        }
      }
    }
    return [...byGenre.entries()]
      .map(([key, setIds]) => ({ key: `genre-${key}`, label: labelByKey.get(key) ?? key, setIds }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sets]);

  const hasBulkGroups = stageGroups.length > 0 || genreGroups.length > 0;

  const handleBulkApply = useCallback(
    (key: string, label: string, setIds: string[]) => {
      if (setIds.length === 0 || bulkBusyKey) return;
      setBulkBusyKey(key);
      bulkSavePicks(setIds, bulkPriority)
        .then(() => {
          const pLabel =
            bulkPriority === 'must' ? 'Must See' : bulkPriority === 'want-to-see' ? 'Want to See' : 'Maybe';
          Alert.alert(
            'Picks added',
            `Added ${setIds.length} set${setIds.length === 1 ? '' : 's'} from ${label} to ${pLabel}.`,
          );
        })
        .catch((e) => {
          // bulkSavePicks already rolled back + set the store error.
          Alert.alert("Couldn't add picks", mapErrorToUserMessage(e, 'Try again.'));
        })
        .finally(() => setBulkBusyKey(null));
    },
    [bulkSavePicks, bulkPriority, bulkBusyKey],
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'day') {
        return (
          <View style={styles.dayHeader} accessibilityRole="header">
            <Text style={styles.dayLabel}>{item.label}</Text>
            <View style={styles.countPill}>
              <Text style={styles.countText}>{item.count}</Text>
            </View>
          </View>
        );
      }
      if (item.kind === 'section') {
        return (
          <View style={styles.sectionHeader} accessibilityRole="header">
            <View style={[styles.dot, { backgroundColor: item.color }]} />
            <Text style={styles.sectionLabel}>{item.label}</Text>
            <View style={styles.countPill}>
              <Text style={styles.countText}>{item.count}</Text>
            </View>
          </View>
        );
      }
      // DC8: picked rows fade/slide in and out and reflow with a layout
      // transition as picks are added/removed, instead of teleporting. Gated on
      // Reduce Motion (no entering/exiting/layout = instant) and behind the
      // FlatList's own virtualization.
      const card = (
        <SetCardMobile
          set={item.set}
          stageName={getStageName(item.set.stageId) || 'Unknown'}
          stageColor={safeStageColor(getStageColor(item.set.stageId), t.colors.text.muted)}
          myPick={getMyPick(item.set.id)}
          onPickChange={(priority) => handlePickChange(item.set, priority)}
          onPress={() => router.push(`/set/${item.set.id}`)}
          hasConflict={conflictIds.has(item.set.id)}
          hasNote={!!getMyNote(item.set.id)}
        />
      );
      if (reduceMotion) return card;
      return (
        <Animated.View
          entering={FadeIn.duration(motionDuration.med)}
          exiting={FadeOut.duration(motionDuration.fast)}
          layout={LinearTransition.duration(motionDuration.med)}
        >
          {card}
        </Animated.View>
      );
    },
    [styles, getStageName, getStageColor, getMyPick, getMyNote, handlePickChange, conflictIds, router, t, reduceMotion],
  );

  const keyExtractor = useCallback((item: Row) => item.key, []);

  const handleRefresh = useCallback(() => {
    if (currentFestival) selectFestival(currentFestival.id).catch(() => {});
  }, [currentFestival, selectFestival]);

  // Export the user's picks to a .ics the OS can import into any calendar app.
  // Built fully client-side from the already-loaded store data (no server call,
  // works offline) and shared via the OS sheet — same write/share flow as the
  // account data export.
  const handleExportCalendar = useCallback(async () => {
    if (!currentFestival || !currentProfile || exportBusy) return;
    setExportBusy(true);
    try {
      const ics = buildPicksIcs({
        festival: {
          id: currentFestival.id,
          name: currentFestival.name,
          location: currentFestival.location,
        },
        sets,
        stages,
        picks: currentProfile.picks,
        notes: currentProfile.notes,
      });
      const safeName = (currentFestival.name || 'festival').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      const file = new File(Paths.cache, `${safeName}_picks.ics`);
      file.create({ overwrite: true });
      file.write(ics);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/calendar',
          UTI: 'com.apple.ical.ics',
          dialogTitle: 'Add picks to calendar',
        });
      } else {
        Alert.alert('Sharing unavailable', 'Calendar sharing is not available on this device.');
      }
    } catch (e) {
      Alert.alert("Couldn't export picks", mapErrorToUserMessage(e, 'Try again.'));
    } finally {
      setExportBusy(false);
    }
  }, [currentFestival, currentProfile, sets, stages, exportBusy]);

  const calendarButton = (
    <TouchableOpacity
      style={styles.calendarButton}
      onPress={handleExportCalendar}
      disabled={exportBusy}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Add picks to calendar"
    >
      {exportBusy ? (
        <ActivityIndicator size="small" color={t.colors.accent.aqua} />
      ) : (
        <Ionicons name="calendar-outline" size={16} color={t.colors.accent.aqua} />
      )}
      <Text style={styles.calendarButtonText}>{exportBusy ? 'Exporting…' : 'Add to calendar'}</Text>
    </TouchableOpacity>
  );

  // Share a public, read-only link to my picks (server route GET /s/:profileId).
  const handleSharePicks = useCallback(() => {
    if (!currentProfile || !currentFestival) return;
    const url = `https://festie.us/s/${currentProfile.id}`;
    Share.share({ message: `My ${currentFestival.name} picks on Festie: ${url}`, url }).catch(() => {});
  }, [currentProfile, currentFestival]);

  const PRIORITY_CHOICES: readonly { value: Priority; label: string }[] = [
    { value: 'must', label: 'Must' },
    { value: 'want-to-see', label: 'Want' },
    { value: 'maybe', label: 'Maybe' },
  ];

  const bulkPanel = hasBulkGroups ? (
    <View style={styles.bulkPanel}>
      <TouchableOpacity
        style={styles.bulkHeader}
        onPress={() => setBulkOpen((v) => !v)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ expanded: bulkOpen }}
        accessibilityLabel="Bulk add picks"
      >
        <Ionicons name="sparkles-outline" size={16} color={t.colors.accent.aqua} />
        <Text style={styles.bulkHeaderText}>Bulk add picks</Text>
        <Ionicons
          name={bulkOpen ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={t.colors.text.muted}
          style={styles.bulkChevron}
        />
      </TouchableOpacity>

      {bulkOpen && (
        <View style={styles.bulkBody}>
          <View
            style={styles.bulkPriorityRow}
            accessibilityRole="radiogroup"
            accessibilityLabel="Priority for bulk add"
          >
            <Text style={styles.bulkSubLabel}>Add as</Text>
            {PRIORITY_CHOICES.map((p) => {
              const active = bulkPriority === p.value;
              return (
                <TouchableOpacity
                  key={p.value}
                  onPress={() => setBulkPriority(p.value)}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${p.label} priority${active ? ', selected' : ''}`}
                  style={[styles.bulkChip, active && styles.bulkChipActive]}
                >
                  <Text style={[styles.bulkChipText, active && styles.bulkChipTextActive]}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {stageGroups.length > 0 && (
            <View style={styles.bulkGroup}>
              <Text style={styles.bulkSubLabel}>By stage</Text>
              <View style={styles.bulkPillRow}>
                {stageGroups.map((g) => (
                  <BulkPill
                    key={g.key}
                    label={g.label}
                    count={g.setIds.length}
                    busy={bulkBusyKey === g.key}
                    disabled={!!bulkBusyKey}
                    onPress={() => handleBulkApply(g.key, g.label, g.setIds)}
                  />
                ))}
              </View>
            </View>
          )}

          {genreGroups.length > 0 && (
            <View style={styles.bulkGroup}>
              <Text style={styles.bulkSubLabel}>By genre</Text>
              <View style={styles.bulkPillRow}>
                {genreGroups.map((g) => (
                  <BulkPill
                    key={g.key}
                    label={g.label}
                    count={g.setIds.length}
                    busy={bulkBusyKey === g.key}
                    disabled={!!bulkBusyKey}
                    onPress={() => handleBulkApply(g.key, g.label, g.setIds)}
                  />
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  ) : null;

  const picksHeader = (
    <View>
      <View style={styles.headerActions}>
        {calendarButton}
        <TouchableOpacity
          style={styles.calendarButton}
          onPress={handleSharePicks}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Share my picks"
        >
          <Ionicons name="share-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.calendarButtonText}>Share picks</Text>
        </TouchableOpacity>
      </View>
      {bulkPanel}
    </View>
  );

  const refreshControl = (
    <RefreshControl
      refreshing={isLoading}
      onRefresh={handleRefresh}
      tintColor={t.colors.accent.aqua}
      colors={[t.colors.accent.aqua]}
      progressBackgroundColor={t.colors.bg.secondary}
    />
  );

  let body: React.ReactNode;
  if (!currentFestival) {
    body = (
      <EmptyState
        icon="calendar-outline"
        title="No festival selected"
        message="Choose a festival from the Schedule tab to start saving picks."
      />
    );
  } else if (!currentProfile) {
    body = (
      <EmptyState
        icon="person-add-outline"
        title="Join this festival first"
        message="Open the Schedule tab and join the festival to start saving picks."
      />
    );
  } else if (isLoading && rows.length === 0) {
    body = <PicksSkeleton />;
  } else if (error && rows.length === 0) {
    body = (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn’t load your picks"
        message={error}
        action={{ label: 'Try again', onPress: handleRefresh }}
      />
    );
  } else if (rows.length === 0) {
    // Zero picks is exactly when bulk-add helps most — surface the panel above
    // the empty state so a user can seed a whole stage/genre in one tap.
    body = (
      <FlatList
        data={[] as Row[]}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={listContentStyle}
        ListHeaderComponent={picksHeader}
        ListEmptyComponent={
          <EmptyState
            icon="star-outline"
            title="No picks yet"
            message="Browse artists and tap Must, Want, or Maybe — or use Bulk add above."
          />
        }
        refreshControl={refreshControl}
      />
    );
  } else {
    body = (
      <FlatList
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={listContentStyle}
        ListHeaderComponent={picksHeader}
        ItemSeparatorComponent={Separator}
        refreshControl={refreshControl}
      />
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="My Picks" icon="star" />
      <View style={styles.body}>{body}</View>
    </View>
  );
}

function Separator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

/**
 * Cold-load placeholder for the picks plan — a day header plus a few set-card
 * shaped rows so the layout matches what's about to render (no spinner, no jump).
 */
function PicksSkeleton() {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.listContent} accessibilityRole="progressbar" accessibilityLabel="Loading your picks">
      <Skeleton width="40%" height={20} radius={t.radii.xs} style={styles.skeletonDay} />
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonCardMain}>
            <Skeleton width="62%" height={16} radius={t.radii.xs} />
            <Skeleton width="38%" height={12} radius={t.radii.xs} />
          </View>
          <Skeleton width={72} height={28} radius={t.radii.pill} />
        </View>
      ))}
    </View>
  );
}

/** A tappable bulk-add pill ("Main Stage · 8") used in the bulk panel. */
function BulkPill({
  label,
  count,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  count: number;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={[styles.bulkActionPill, disabled && !busy && styles.bulkActionPillDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Add all ${count} ${label} sets`}
    >
      {busy ? (
        <ActivityIndicator size="small" color={t.colors.accent.aqua} />
      ) : (
        <>
          <Text style={styles.bulkActionPillText} numberOfLines={1}>
            {label}
          </Text>
          <View style={styles.bulkActionCount}>
            <Text style={styles.bulkActionCountText}>{count}</Text>
          </View>
        </>
      )}
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  body: {
    flex: 1,
  },
  listContent: {
    padding: t.spacing[4],
    paddingBottom: t.spacing[6],
  },
  headerActions: {
    flexDirection: 'row',
    gap: t.spacing[2],
    marginBottom: t.spacing[2],
  },
  calendarButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
  },
  calendarButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  separator: {
    height: t.spacing[2],
  },
  // ── Cold-load skeleton ────────────────────────────────────────────────────
  skeletonDay: {
    marginTop: t.spacing[4],
    marginBottom: t.spacing[3],
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    padding: t.spacing[4],
    minHeight: 72,
    marginBottom: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
  },
  skeletonCardMain: {
    flex: 1,
    gap: t.spacing[2],
  },
  // ── Bulk add panel ──────────────────────────────────────────────────────
  bulkPanel: {
    marginBottom: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
    overflow: 'hidden',
  },
  bulkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  bulkHeaderText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  bulkChevron: {
    marginLeft: 'auto',
  },
  bulkBody: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
    gap: t.spacing[3],
  },
  bulkPriorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  bulkGroup: {
    gap: t.spacing[2],
  },
  bulkSubLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  bulkChip: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  bulkChipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
  },
  bulkChipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  bulkChipTextActive: {
    color: t.colors.accent.aqua,
  },
  bulkPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  bulkActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
    minHeight: 34,
    maxWidth: '100%',
  },
  bulkActionPillDisabled: {
    opacity: 0.5,
  },
  bulkActionPillText: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    // No capitalize transform — it mangled multi-word/initialism genres
    // ("drum and bass", "UK garage"). Labels carry their original casing.
    flexShrink: 1,
  },
  bulkActionCount: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.card,
  },
  bulkActionCountText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    marginTop: t.spacing[4],
    marginBottom: t.spacing[2],
  },
  dayLabel: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    marginTop: t.spacing[3],
    marginBottom: t.spacing[1],
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  sectionLabel: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  countPill: {
    marginLeft: 'auto',
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.card,
  },
  countText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
}));
