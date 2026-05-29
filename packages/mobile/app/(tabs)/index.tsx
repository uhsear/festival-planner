import { useEffect, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  ScrollView,
  type ListRenderItem,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFestivalDataStore, useFestivalStore } from '@festie/shared/stores';
import { usePicks, useFestival } from '@festie/shared/hooks';
import {
  artistDisplayName,
  getSetHotness,
  getConflictingSetIds,
} from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../../hooks/useTokens';
import { useUI, type ViewMode } from '../../contexts/UIContext';
import SegmentedControl from '../../components/SegmentedControl';
import LiveDot from '../../components/LiveDot';
import FestivalList from '../../components/FestivalList';
import SetCardMobile from '../../components/SetCardMobile';
import EmptyState from '../../components/EmptyState';

const VIEW_OPTIONS: ReadonlyArray<{ value: ViewMode; label: string }> = [
  { value: 'timeline', label: 'Timeline' },
  { value: 'grid', label: 'Grid' },
  { value: 'cards', label: 'Cards' },
];

/**
 * Stage colors come from the API but the web fallback is a CSS custom property
 * (`var(--text-muted)`) that React Native can't parse. Guard against any
 * `var(...)` value and substitute a real token.
 */
function safeStageColor(color: string | undefined, fallback: string): string {
  if (!color || color.startsWith('var(')) return fallback;
  return color;
}

/** Compare set start times for ascending time order. */
function byStartTime(a: FestivalSet, b: FestivalSet): number {
  const ta = a.startTime || '';
  const tb = b.startTime || '';
  if (ta && tb) return ta.localeCompare(tb);
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  return 0;
}

type ListRow =
  | { kind: 'stageHeader'; key: string; stageName: string; stageColor: string }
  | { kind: 'set'; key: string; set: FestivalSet };

export default function TimelineScreen() {
  const t = useTokens();
  const styles = useStyles();
  const { viewMode, setViewMode } = useUI();

  const festivals = useFestivalDataStore((s) => s.festivals);
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);
  const stages = useFestivalDataStore((s) => s.stages);

  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const setSearchQuery = useFestivalStore((s) => s.setSearchQuery);

  const { getDays, getFilteredSets, getStageColor, getStageName } = useFestival();
  const { getMyPick, savePick } = usePicks();

  const [search, setSearch] = useState(searchQuery);

  const clearSelection = useCallback(() => {
    useFestivalDataStore.setState({
      currentFestivalId: null,
      currentFestival: null,
      currentProfile: null,
      sets: [],
      stages: [],
      days: [],
    });
  }, []);

  useEffect(() => {
    if (festivals.length === 0) {
      loadFestivals().catch(() => {});
    }
  }, [festivals.length, loadFestivals]);

  // Keep the local search box in sync with the shared store (debounce-free; the
  // store filter recomputes filteredSets on every keystroke, matching web).
  const handleSearch = useCallback(
    (text: string) => {
      setSearch(text);
      setSearchQuery(text);
    },
    [setSearchQuery],
  );

  const days = useMemo(() => getDays(), [getDays]);

  // Day + active-stage + search filtering lives in the shared hook
  // (getFilteredSets mirrors cards.tsx's filteredSets). We then apply the same
  // hotness → time → name sort the web Cards view uses.
  const filteredSets = useMemo(() => {
    const filtered = [...getFilteredSets()];
    return filtered.sort((a, b) => {
      const hotA = getSetHotness(a);
      const hotB = getSetHotness(b);
      if (hotA > 0 || hotB > 0) return hotB - hotA;

      const byTime = byStartTime(a, b);
      if (byTime !== 0) return byTime;

      return artistDisplayName(a, currentFestival?.b2bSeparator).localeCompare(
        artistDisplayName(b, currentFestival?.b2bSeparator),
        undefined,
        { sensitivity: 'base' },
      );
    });
    // getFilteredSets is recreated when day/stage/search/sets change.
  }, [getFilteredSets, currentFestival?.b2bSeparator]);

  // Conflict set IDs — same util the web Cards view uses.
  const conflictIds = useMemo(
    () => getConflictingSetIds(filteredSets, getMyPick),
    [filteredSets, getMyPick],
  );

  // Timeline/Grid (v1): a clean stage-grouped, time-ordered list. Cards: a flat
  // hotness-sorted list. Both share data + conflict info.
  const rows = useMemo<ListRow[]>(() => {
    if (viewMode === 'cards') {
      return filteredSets.map((set) => ({ kind: 'set', key: set.id, set }));
    }

    // Group by stage (stage order follows the festival's stage list), each
    // group time-ordered. This mirrors the *information* of the web timeline/
    // grid (stages × time) in a single-column mobile layout.
    const byStage = new Map<string, FestivalSet[]>();
    for (const set of filteredSets) {
      const arr = byStage.get(set.stageId) || [];
      arr.push(set);
      byStage.set(set.stageId, arr);
    }

    const orderedStageIds = [
      ...stages.map((s) => s.id).filter((id) => byStage.has(id)),
      // Any stage present in sets but missing from the stage list (defensive).
      ...[...byStage.keys()].filter((id) => !stages.some((s) => s.id === id)),
    ];

    const out: ListRow[] = [];
    for (const stageId of orderedStageIds) {
      const stageSets = (byStage.get(stageId) || []).sort(byStartTime);
      if (stageSets.length === 0) continue;
      out.push({
        kind: 'stageHeader',
        key: `stage-${stageId}`,
        stageName: getStageName(stageId) || 'Unknown stage',
        stageColor: safeStageColor(getStageColor(stageId), t.colors.text.muted),
      });
      for (const set of stageSets) {
        out.push({ kind: 'set', key: set.id, set });
      }
    }
    return out;
  }, [viewMode, filteredSets, stages, getStageName, getStageColor, t.colors.text.muted]);

  const handlePickChange = useCallback(
    (setId: string, priority: Priority | null) => {
      if (!currentFestival) return;
      savePick(currentFestival.id, setId, priority).catch(() => {});
    },
    [currentFestival, savePick],
  );

  const renderRow = useCallback<ListRenderItem<ListRow>>(
    ({ item }) => {
      if (item.kind === 'stageHeader') {
        return (
          <View style={styles.stageHeader}>
            <View
              style={[styles.stageDot, { backgroundColor: item.stageColor }]}
            />
            <Text style={styles.stageHeaderText} numberOfLines={1}>
              {item.stageName}
            </Text>
          </View>
        );
      }
      const set = item.set;
      return (
        <SetCardMobile
          set={set}
          stageName={getStageName(set.stageId) || 'Unknown'}
          stageColor={safeStageColor(getStageColor(set.stageId), t.colors.text.muted)}
          myPick={getMyPick(set.id)}
          hasConflict={conflictIds.has(set.id)}
          onPickChange={(priority) => handlePickChange(set.id, priority)}
          onPress={() => {
            // No detail screen exists on mobile yet — open-detail is a no-op.
            // GAP: wire to a set-detail route/drawer when one is added.
          }}
        />
      );
    },
    [
      styles,
      getStageName,
      getStageColor,
      getMyPick,
      conflictIds,
      handlePickChange,
      t.colors.text.muted,
    ],
  );

  const keyExtractor = useCallback((item: ListRow) => item.key, []);

  // No festival selected — show the festival selector.
  if (!currentFestival) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="musical-notes" size={24} color={t.colors.accent.aqua} />
          <Text style={styles.headerTitle}>Select a Festival</Text>
        </View>
        <FestivalList />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.viewSwitcher}>
        <View style={styles.liveRow}>
          <LiveDot />
          <TouchableOpacity
            style={styles.switchButton}
            onPress={clearSelection}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Switch festival"
          >
            <Ionicons
              name="swap-horizontal"
              size={14}
              color={t.colors.accent.aqua}
            />
            <Text style={styles.switchText}>Switch</Text>
          </TouchableOpacity>
        </View>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value={viewMode}
          onChange={setViewMode}
          accessibilityLabel="Schedule view"
        />
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Ionicons
          name="search"
          size={16}
          color={t.colors.text.placeholder}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={handleSearch}
          placeholder="Search artists or stages"
          placeholderTextColor={t.colors.text.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search the lineup"
          returnKeyType="search"
        />
        {search.length > 0 ? (
          <TouchableOpacity
            onPress={() => handleSearch('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
          >
            <Ionicons
              name="close-circle"
              size={18}
              color={t.colors.text.muted}
            />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Day selector */}
      {days.length > 1 ? (
        <View style={styles.daysWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.daysContent}
          >
            {days.map((day) => {
              const active = day.index === selectedDay;
              return (
                <TouchableOpacity
                  key={day.index}
                  style={[styles.dayChip, active && styles.dayChipActive]}
                  onPress={() => setSelectedDay(day.index)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Day: ${day.label ?? day.date}`}
                >
                  <Text
                    style={[styles.dayText, active && styles.dayTextActive]}
                    numberOfLines={1}
                  >
                    {day.label ?? day.date}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* Schedule list */}
      <FlatList
        data={rows}
        renderItem={renderRow}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <EmptyState
            icon={search.length > 0 ? 'search' : 'musical-notes'}
            title={
              search.length > 0
                ? 'No artists match your search'
                : 'No sets for this day'
            }
            message={
              search.length > 0
                ? 'Try a different spelling or clear the search to see the full lineup.'
                : 'Pick another day from the day selector to browse the schedule.'
            }
          />
        }
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  headerTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  viewSwitcher: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    gap: t.spacing[3],
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
  },
  switchText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    marginHorizontal: t.spacing[4],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  searchIcon: {
    marginRight: 0,
  },
  searchInput: {
    flex: 1,
    ...typeStyle('body'),
    color: t.colors.text.primary,
    padding: 0,
  },
  daysWrap: {
    paddingVertical: t.spacing[3],
  },
  daysContent: {
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[2],
  },
  dayChip: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  dayChipActive: {
    backgroundColor: t.colors.accent.aqua,
    borderColor: t.colors.accent.aqua,
  },
  dayText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  dayTextActive: {
    color: t.colors.text.onLightAccent,
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingTop: t.spacing[2],
    paddingBottom: t.spacing[1],
  },
  stageDot: {
    width: 10,
    height: 10,
    borderRadius: t.radii.pill,
  },
  stageHeaderText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  listContent: {
    padding: t.spacing[4],
    paddingTop: t.spacing[2],
    flexGrow: 1,
  },
  separator: {
    height: t.spacing[3],
  },
}));
