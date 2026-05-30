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
import { useRouter } from 'expo-router';
import { useFestivalDataStore, useFestivalStore } from '@festie/shared/stores';
import { usePicks, useFestival } from '@festie/shared/hooks';
import {
  artistDisplayName,
  getSetHotness,
  getConflictingSetIds,
} from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import {
  timeToMinutes,
} from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle } from '../../hooks/useTokens';
import { useUI, type ViewMode } from '../../contexts/UIContext';
import { useNowIndicator, type TimeBounds } from '../../hooks/useNowIndicator';
import SegmentedControl from '../../components/SegmentedControl';
import LiveDot from '../../components/LiveDot';
import FestivalList from '../../components/FestivalList';
import SetCardMobile from '../../components/SetCardMobile';
import EmptyState from '../../components/EmptyState';
import TimelineView from '../../components/TimelineView';
import GridView from '../../components/GridView';
import TBASection from '../../components/TBASection';

const SLOT_MINUTES = 15;

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
  const router = useRouter();
  const { viewMode, setViewMode } = useUI();

  const festivals = useFestivalDataStore((s) => s.festivals);
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentFestivalId = useFestivalDataStore((s) => s.currentFestivalId);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);
  const selectFestival = useFestivalDataStore((s) => s.selectFestival);
  const isLoading = useFestivalDataStore((s) => s.isLoading);
  const stages = useFestivalDataStore((s) => s.stages);

  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const setSearchQuery = useFestivalStore((s) => s.setSearchQuery);
  const activeStages = useFestivalStore((s) => s.activeStages);

  const { getDays, getFilteredSets, getStageColor, getStageName } = useFestival();
  const { getMyPick, getOtherPicks, getMyNote, savePick } = usePicks();

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

  // Auto-restore the persisted festival on launch. festivalDataStore persists
  // only currentFestivalId (not the festival data), so after a cold start the
  // id is set but currentFestival is null — reload it so the app reopens to the
  // festival the user was on instead of dropping them on the picker. Guarded on
  // !isLoading so we don't re-enter while a selection is already in flight.
  useEffect(() => {
    if (currentFestivalId && !currentFestival && !isLoading) {
      selectFestival(currentFestivalId).catch(() => {});
    }
  }, [currentFestivalId, currentFestival, isLoading, selectFestival]);

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

  // Cards view: a flat hotness-sorted list of set rows.
  const rows = useMemo<ListRow[]>(
    () => filteredSets.map((set) => ({ kind: 'set', key: set.id, set })),
    [filteredSets],
  );

  // Timeline/Grid views consume the same day-filtered set list (filteredSets
  // already applies day + active-stage + search), split into timed vs. TBA and
  // bounded by the day's earliest start / latest end — mirroring the web
  // useTimelineFilters logic, adapted to mobile's stores.
  const timedSets = useMemo(
    () => filteredSets.filter((s) => s.startTime && s.endTime),
    [filteredSets],
  );

  const timelessSets = useMemo(
    () =>
      filteredSets
        .filter((s) => !s.startTime || !s.endTime)
        .sort((a, b) =>
          artistDisplayName(a, currentFestival?.b2bSeparator).localeCompare(
            artistDisplayName(b, currentFestival?.b2bSeparator),
            undefined,
            { sensitivity: 'base' },
          ),
        ),
    [filteredSets, currentFestival?.b2bSeparator],
  );

  const timeBounds = useMemo<TimeBounds | null>(() => {
    if (timedSets.length === 0) return null;
    let minMin = 24 * 60;
    let maxMin = 0;
    for (const s of timedSets) {
      const start = timeToMinutes(s.startTime);
      let end = timeToMinutes(s.endTime);
      if (end <= start) end += 24 * 60;
      if (start < minMin) minMin = start;
      if (end > maxMin) maxMin = end;
    }
    minMin = Math.floor(minMin / SLOT_MINUTES) * SLOT_MINUTES;
    maxMin = Math.ceil(maxMin / SLOT_MINUTES) * SLOT_MINUTES;
    return { minMin, maxMin, totalSlots: (maxMin - minMin) / SLOT_MINUTES };
  }, [timedSets]);

  // Active stages (all when none/empty), preserving the festival's stage order.
  const visibleStages = useMemo(() => {
    if (!activeStages || activeStages.length === 0) return stages;
    return stages.filter((st) => activeStages.includes(st.id));
  }, [stages, activeStages]);

  // ROW_HEIGHT here matches TimelineView's slot height so scroll-to-now lands
  // on the right offset.
  const { nowIndicator } = useNowIndicator(timeBounds, selectedDay, 22);

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
          friendProfiles={getOtherPicks(set.id)}
          hasConflict={conflictIds.has(set.id)}
          hasNote={!!getMyNote(set.id)}
          onPickChange={(priority) => handlePickChange(set.id, priority)}
          onPress={() => router.push(`/set/${set.id}`)}
        />
      );
    },
    [
      styles,
      getStageName,
      getStageColor,
      getMyPick,
      getOtherPicks,
      getMyNote,
      conflictIds,
      handlePickChange,
      router,
      t.colors.text.muted,
    ],
  );

  const keyExtractor = useCallback((item: ListRow) => item.key, []);

  // Stage color resolver that substitutes a real token for web's `var(...)`
  // fallback so the timeline/grid views never receive an unparseable color.
  const resolveStageColor = useCallback(
    (stageId: string) =>
      safeStageColor(getStageColor(stageId), t.colors.text.muted),
    [getStageColor, t.colors.text.muted],
  );

  const handleSetPress = useCallback(
    (set: FestivalSet) => router.push(`/set/${set.id}`),
    [router],
  );

  // Shared TBA section, reused as a footer across all three views.
  const tbaSection =
    timelessSets.length > 0 ? (
      <TBASection
        sets={timelessSets}
        stages={stages}
        currentProfile={currentProfile}
        currentFestival={currentFestival}
        getMyPick={getMyPick}
        getOtherPicks={getOtherPicks}
        getStageColor={resolveStageColor}
        onSavePick={handlePickChange}
        onOpenDetail={handleSetPress}
      />
    ) : null;

  const emptyScheduleState = (
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
  );

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
          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => router.push('/festival-mode')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Open festival mode"
          >
            <Ionicons name="flash" size={14} color={t.colors.accent.aqua} />
            <Text style={styles.switchText}>Live</Text>
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

      {/* Schedule body — view-mode specific. */}
      {viewMode === 'cards' ? (
        <FlatList
          data={rows}
          renderItem={renderRow}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListFooterComponent={tbaSection}
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
      ) : viewMode === 'timeline' ? (
        timeBounds && visibleStages.length > 0 ? (
          <View style={styles.viewBody}>
            <TimelineView
              visibleStages={visibleStages}
              timedSets={timedSets}
              timeBounds={timeBounds}
              selectedDay={selectedDay}
              conflictIds={conflictIds}
              b2bSeparator={currentFestival.b2bSeparator}
              getMyPick={getMyPick}
              getStageColor={resolveStageColor}
              onPickChange={handlePickChange}
              onSetPress={handleSetPress}
            />
            {tbaSection}
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.fallbackScroll}>
            {emptyScheduleState}
            {tbaSection}
          </ScrollView>
        )
      ) : timedSets.length > 0 ? (
        <GridView
          visibleStages={visibleStages}
          timedSets={timedSets}
          nowIndicator={nowIndicator}
          conflictIds={conflictIds}
          getMyPick={getMyPick}
          getMyNote={getMyNote}
          getStageColor={resolveStageColor}
          getStageName={getStageName}
          onPickChange={handlePickChange}
          onSetPress={handleSetPress}
          ListFooterComponent={tbaSection}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.fallbackScroll}>
          {emptyScheduleState}
          {tbaSection}
        </ScrollView>
      )}
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
  viewBody: {
    flex: 1,
  },
  fallbackScroll: {
    flexGrow: 1,
    paddingBottom: t.spacing[4],
  },
}));
