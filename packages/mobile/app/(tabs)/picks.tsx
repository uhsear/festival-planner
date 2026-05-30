import { useCallback, useMemo } from 'react';
import { View, Text, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useFestivalDataStore } from '@festie/shared/stores';
import { usePicks, useFestival } from '@festie/shared/hooks';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { artistDisplayName, getConflictingSetIds } from '@festie/shared/utils';
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
function priorityColor(
  t: ReturnType<typeof useTokens>,
  p: Priority,
): string {
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
  const isLoading = useFestivalDataStore((s) => s.isLoading);

  const { getMyPick, savePick, removePick, getMyNote } = usePicks();
  const { getDays, getStageColor, getStageName } = useFestival();

  const days = useMemo(() => getDays(), [getDays]);

  // Conflict highlighting mirrors the web schedule: any two picked sets whose
  // times overlap are flagged. Computed across all picked sets, not per-day.
  const conflictIds = useMemo(
    () => getConflictingSetIds(sets, getMyPick),
    [sets, getMyPick],
  );

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
            return artistDisplayName(a, separator).localeCompare(
              artistDisplayName(b, separator),
              undefined,
              { sensitivity: 'base' },
            );
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
    [
      styles,
      getStageName,
      getStageColor,
      getMyPick,
      getMyNote,
      handlePickChange,
      conflictIds,
      router,
    ],
  );

  const keyExtractor = useCallback((item: Row) => item.key, []);

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
        ItemSeparatorComponent={Separator}
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
