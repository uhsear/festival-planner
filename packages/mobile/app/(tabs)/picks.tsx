import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity, ActivityIndicator, Alert, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import { useFestivalDataStore } from '@festie/shared/stores';
import { usePicks, useFestival } from '@festie/shared/hooks';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { artistDisplayName, getConflictingSetIds, buildPicksIcs } from '@festie/shared/utils';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { useTokens, makeStyles, typeStyle } from '../../hooks/useTokens';
import ScreenHeader from '../../components/ScreenHeader';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
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

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const sets = useFestivalDataStore((s) => s.sets);
  const stages = useFestivalDataStore((s) => s.stages);
  const isLoading = useFestivalDataStore((s) => s.isLoading);
  const error = useFestivalDataStore((s) => s.error);
  const selectFestival = useFestivalDataStore((s) => s.selectFestival);

  const [exportBusy, setExportBusy] = useState(false);

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
          <View style={styles.sectionHeader}>
            <View style={[styles.dot, { backgroundColor: item.color }]} />
            <Text style={styles.sectionLabel}>{item.label}</Text>
            <View style={styles.countPill}>
              <Text style={styles.countText}>{item.count}</Text>
            </View>
          </View>
        );
      }
      return (
        <SetCardMobile
          set={item.set}
          stageName={getStageName(item.set.stageId) || ''}
          stageColor={getStageColor(item.set.stageId)}
          myPick={getMyPick(item.set.id)}
          onPickChange={(priority) => handlePickChange(item.set, priority)}
          onPress={() => router.push(`/set/${item.set.id}`)}
          hasConflict={conflictIds.has(item.set.id)}
          hasNote={!!getMyNote(item.set.id)}
        />
      );
    },
    [styles, getStageName, getStageColor, getMyPick, getMyNote, handlePickChange, conflictIds, router],
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
      Alert.alert('Export failed', mapErrorToUserMessage(e, 'Could not export your picks.'));
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

  const picksHeader = (
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
    body = <LoadingState label="Loading your picks" />;
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
    body = (
      <EmptyState
        icon="star-outline"
        title="No picks yet"
        message="Browse artists and tap Must, Want, or Maybe to build your plan."
      />
    );
  } else {
    body = (
      <FlatList
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
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
