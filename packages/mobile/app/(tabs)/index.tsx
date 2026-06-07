import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  ScrollView,
  RefreshControl,
  useWindowDimensions,
  type ListRenderItem,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFestivalDataStore, useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { usePicks, useFestival } from '@festie/shared/hooks';
import {
  artistDisplayName,
  getSetHotness,
  getConflictingSetIds,
  timeToMinutes,
  festivalPhase,
} from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../../hooks/useTokens';
import { safeStageColor } from '../../lib/stageColor';
import { useUI, type ViewMode } from '../../contexts/UIContext';
import type { TimeBounds } from '../../hooks/useNowIndicator';
import { useHaptics } from '../../hooks/useHaptics';
import SegmentedControl from '../../components/SegmentedControl';
import LiveDot from '../../components/LiveDot';
import NowNextStrip from '../../components/NowNextStrip';
import PhaseHomeActions from '../../components/PhaseHomeActions';
import FestivalList from '../../components/FestivalList';
import SetCardMobile from '../../components/SetCardMobile';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ScreenHeader from '../../components/ScreenHeader';
import TimelineView from '../../components/TimelineView';
import TBASection from '../../components/TBASection';

const SLOT_MINUTES = 15;

// Mobile schedule views: Timeline (single-axis, time-gutter + now line) and a
// flat Cards list. The dense 2D stage×time Grid is intentionally web/tablet-only
// (see UIContext ViewMode + routes/grid.tsx) — it doesn't fit a phone.
const VIEW_OPTIONS: readonly { value: ViewMode; label: string }[] = [
  { value: 'timeline', label: 'Timeline' },
  { value: 'cards', label: 'Cards' },
];

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
  const haptics = useHaptics();
  const { viewMode, setViewMode } = useUI();
  const { width } = useWindowDimensions();

  // Responsive horizontal gutter. Phones keep the standard spacing[4] (16px)
  // edge padding. On tablet-class widths a flat 16px gutter leaves the chrome
  // (search bar, day/filter chips, view switcher) stranded against huge empty
  // sidebars, so we widen the gutter and cap the content column — when the
  // window is wider than maxContentWidth the extra space is split evenly,
  // centering the content instead of stretching it edge-to-edge.
  const isTablet = width >= 700;
  const maxContentWidth = 760;
  const hPad = useMemo(() => {
    if (!isTablet) return t.spacing[4];
    const centered = (width - maxContentWidth) / 2;
    return Math.max(t.spacing[8], centered);
  }, [isTablet, width, t.spacing]);

  const festivals = useFestivalDataStore((s) => s.festivals);
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentFestivalId = useFestivalDataStore((s) => s.currentFestivalId);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);
  const selectFestival = useFestivalDataStore((s) => s.selectFestival);
  const loadProfiles = useFestivalDataStore((s) => s.loadProfiles);
  const user = useAuthStore((s) => s.user);
  const isLoading = useFestivalDataStore((s) => s.isLoading);
  const error = useFestivalDataStore((s) => s.error);
  const stages = useFestivalDataStore((s) => s.stages);
  const allSets = useFestivalDataStore((s) => s.sets);

  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const setSearchQuery = useFestivalStore((s) => s.setSearchQuery);
  const activeStages = useFestivalStore((s) => s.activeStages);
  const setActiveStages = useFestivalStore((s) => s.setActiveStages);

  const { getDays, getFilteredSets, getStageColor, getStageName } = useFestival();
  const { getMyPick, getOtherPicks, getMyNote, savePick } = usePicks();

  const [search, setSearch] = useState(searchQuery);
  // "My picks only" filter — on-site you mostly want to read your own day.
  const [onlyMine, setOnlyMine] = useState(false);
  const todayStr = useMemo(() => new Date().toLocaleDateString('en-CA'), []);

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

  // When a guest signs in while a festival is already selected, the profiles
  // weren't fetched (selectFestival skips them for guests). Load them now so
  // picks/notes light up without forcing a manual festival re-select.
  useEffect(() => {
    if (user && currentFestivalId && !currentProfile) {
      loadProfiles(currentFestivalId).catch(() => {});
    }
  }, [user, currentFestivalId, currentProfile, loadProfiles]);

  // Pull-to-refresh: re-fetch the selected festival's sets/stages/profile, or
  // the festival list when sitting on the picker. Mirrors FestivalList.
  const handleRefresh = useCallback(() => {
    if (currentFestival) {
      selectFestival(currentFestival.id).catch(() => {});
    } else {
      loadFestivals().catch(() => {});
    }
  }, [currentFestival, selectFestival, loadFestivals]);

  const refreshControl = (
    <RefreshControl
      refreshing={isLoading}
      onRefresh={handleRefresh}
      tintColor={t.colors.accent.aqua}
      colors={[t.colors.accent.aqua]}
      progressBackgroundColor={t.colors.bg.secondary}
    />
  );

  // Does this festival have any timed sets at all? A festival whose lineup is
  // published without set times (everything TBA) renders nothing in the
  // Timeline/Grid views — Cards is the only useful view for it.
  const festivalHasTimedSets = useMemo(() => allSets.some((s) => s.startTime && s.endTime), [allSets]);

  // Pick a sensible default view per festival: Timeline for festivals with a
  // timed schedule, Cards for all-TBA festivals (otherwise they'd open on an
  // empty Timeline). Runs once per festival load — after that the user's manual
  // view choice stands until they switch festivals.
  const defaultedFestivalRef = useRef<string | null>(null);
  useEffect(() => {
    const id = currentFestival?.id;
    if (!id || allSets.length === 0) return;
    if (defaultedFestivalRef.current === id) return;
    defaultedFestivalRef.current = id;
    setViewMode(festivalHasTimedSets ? 'timeline' : 'cards');
  }, [currentFestival?.id, allSets.length, festivalHasTimedSets, setViewMode]);

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

  // P1-5 — festival lifecycle phase (pre / live / post), derived from the
  // festival's date range vs now (shared `festivalPhase` → `festivalStatus`).
  // Drives the phase-aware home action band below; null when the festival has no
  // usable dates, in which case the band is hidden (phase-neutral fallback).
  const phase = useMemo(() => festivalPhase(currentFestival, days), [currentFestival, days]);

  // Day + active-stage + search filtering lives in the shared hook
  // (getFilteredSets mirrors cards.tsx's filteredSets). We then apply the same
  // hotness → time → name sort the web Cards view uses.
  const filteredSets = useMemo(() => {
    let filtered = [...getFilteredSets()];
    if (onlyMine) filtered = filtered.filter((s) => getMyPick(s.id));
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
  }, [getFilteredSets, currentFestival?.b2bSeparator, onlyMine, getMyPick]);

  // Conflict set IDs — same util the web Cards view uses.
  const conflictIds = useMemo(() => getConflictingSetIds(filteredSets, getMyPick), [filteredSets, getMyPick]);

  // Cards view: a flat hotness-sorted list of set rows.
  const rows = useMemo<ListRow[]>(() => filteredSets.map((set) => ({ kind: 'set', key: set.id, set })), [filteredSets]);

  // Timeline/Grid views consume the same day-filtered set list (filteredSets
  // already applies day + active-stage + search), split into timed vs. TBA and
  // bounded by the day's earliest start / latest end — mirroring the web
  // useTimelineFilters logic, adapted to mobile's stores.
  const timedSets = useMemo(() => filteredSets.filter((s) => s.startTime && s.endTime), [filteredSets]);

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

  // Stage filter chips — wires the previously-dead setActiveStages path. A stage
  // is "on" when it's in the effective set (all when activeStages is empty).
  const allStageIds = useMemo(() => stages.map((s) => s.id), [stages]);
  const effectiveStages = activeStages.length ? activeStages : allStageIds;
  const toggleStage = useCallback(
    (id: string) => {
      const sel = new Set(effectiveStages);
      if (sel.has(id)) sel.delete(id);
      else sel.add(id);
      const next = allStageIds.filter((sid) => sel.has(sid));
      // empty or all-selected both mean "show all" — store [] to keep it clean
      setActiveStages(next.length === 0 || next.length === allStageIds.length ? [] : next);
    },
    [effectiveStages, allStageIds, setActiveStages],
  );

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
            <View style={[styles.stageDot, { backgroundColor: item.stageColor }]} />
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
    (stageId: string) => safeStageColor(getStageColor(stageId), t.colors.text.muted),
    [getStageColor, t.colors.text.muted],
  );

  const handleSetPress = useCallback((set: FestivalSet) => router.push(`/set/${set.id}`), [router]);

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
        defaultExpanded={timedSets.length === 0}
      />
    ) : null;

  const emptyScheduleState = (
    <EmptyState
      icon={search.length > 0 ? 'search' : 'musical-notes'}
      title={
        search.length > 0
          ? 'No artists match your search'
          : timelessSets.length > 0
            ? 'Set times not announced yet'
            : 'No sets for this day'
      }
      message={
        search.length > 0
          ? 'Try a different spelling or clear the search to see the full lineup.'
          : timelessSets.length > 0
            ? 'This day’s set times haven’t been posted. Browse the full lineup in the TBA list below, or switch to Cards.'
            : 'Pick another day from the day selector to browse the schedule.'
      }
      action={
        search.length > 0
          ? { label: 'Clear search', onPress: () => handleSearch('') }
          : { label: 'Switch festival', onPress: clearSelection }
      }
    />
  );

  // No festival selected — show the festival selector, or a load/error state
  // when the festival list itself couldn't be fetched.
  if (!currentFestival) {
    return (
      // ScreenHeader owns the top safe-area inset (insets.top + spacing[4]) — the
      // native Tabs nav header is hidden (see (tabs)/_layout.tsx), so this is the
      // single top of the screen.
      <View style={styles.container}>
        <ScreenHeader title="Select a Festival" icon="musical-notes" />
        {festivals.length === 0 && isLoading ? (
          <LoadingState label="Loading festivals…" />
        ) : festivals.length === 0 && error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn’t load festivals"
            message={error}
            action={{ label: 'Try again', onPress: () => loadFestivals().catch(() => {}) }}
          />
        ) : (
          <FestivalList />
        )}
      </View>
    );
  }

  return (
    // ScreenHeader owns the top safe-area inset (insets.top + spacing[4]) — the
    // native Tabs nav header is hidden (see (tabs)/_layout.tsx), so this is the
    // single top of the screen, sitting above the live/view-switcher row.
    <View style={styles.container}>
      <ScreenHeader title={currentFestival.name} icon="calendar-outline" />
      <View style={[styles.viewSwitcher, { paddingHorizontal: hPad }]}>
        <View style={styles.liveRow}>
          <LiveDot />
          <TouchableOpacity
            style={styles.switchButton}
            onPress={clearSelection}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Switch festival"
          >
            <Ionicons name="swap-horizontal" size={14} color={t.colors.accent.aqua} />
            <Text style={styles.switchText}>Switch</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => router.push('/festival-mode')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Open Now and Next"
          >
            {/* Renamed from the ambiguous "Live" (P1-2): "Live" is reserved for
                location. The pulsing LiveDot above stays as the now indicator. */}
            <Ionicons name="flash" size={14} color={t.colors.accent.aqua} />
            <Text style={styles.switchText}>Now &amp; Next</Text>
          </TouchableOpacity>
        </View>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value={viewMode}
          onChange={setViewMode}
          accessibilityLabel="Schedule view"
        />
      </View>

      {/* Live-day Now & Next surface: shows the picked set playing now / up next
          inline, tapping through to the full Now & Next screen. Renders nothing
          when there's no current/upcoming pick. */}
      <View style={{ paddingHorizontal: hPad }}>
        <NowNextStrip onPress={() => router.push('/festival-mode')} />
      </View>

      {/* P1-5 — phase-aware home actions: re-prioritizes the crew's destinations
          (picks / crew / find / Now & Next / wrap) by festival phase. Hidden when
          the festival has no usable dates (phase === null). */}
      {phase ? (
        <View style={{ paddingHorizontal: hPad }}>
          <PhaseHomeActions phase={phase} />
        </View>
      ) : null}

      {/* Search */}
      <View style={[styles.searchRow, { marginHorizontal: hPad }]}>
        <Ionicons name="search" size={16} color={t.colors.text.placeholder} style={styles.searchIcon} />
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
            <Ionicons name="close-circle" size={18} color={t.colors.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Day selector */}
      {days.length > 1 ? (
        <View style={styles.daysWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.daysContent, { paddingHorizontal: hPad }]}
          >
            {days.map((day) => {
              const active = day.index === selectedDay;
              const isToday = day.date === todayStr;
              return (
                <TouchableOpacity
                  key={day.index}
                  style={[styles.dayChip, active && styles.dayChipActive]}
                  onPress={() => {
                    haptics.select();
                    setSelectedDay(day.index);
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Day: ${day.label ?? day.date}${isToday ? ' (today)' : ''}`}
                >
                  {isToday ? <View style={[styles.todayDot, active && styles.todayDotActive]} /> : null}
                  <Text style={[styles.dayText, active && styles.dayTextActive]} numberOfLines={1}>
                    {day.label ?? day.date}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* Stage + my-picks filters */}
      {currentProfile || stages.length > 1 ? (
        <View style={styles.filterRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.filterContent, { paddingHorizontal: hPad }]}
          >
            {currentProfile ? (
              <TouchableOpacity
                style={[styles.filterChip, onlyMine && styles.filterChipActive]}
                onPress={() => setOnlyMine((v) => !v)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: onlyMine }}
                accessibilityLabel="Show only my picks"
              >
                <Ionicons name="star" size={12} color={onlyMine ? t.colors.text.onLightAccent : t.colors.text.muted} />
                <Text style={[styles.filterChipText, onlyMine && styles.filterChipTextActive]}>My picks</Text>
              </TouchableOpacity>
            ) : null}
            {stages.length > 1
              ? stages.map((st) => {
                  const on = effectiveStages.includes(st.id);
                  return (
                    <TouchableOpacity
                      key={st.id}
                      style={[styles.filterChip, !on && styles.filterChipOff]}
                      onPress={() => toggleStage(st.id)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${on ? 'Hide' : 'Show'} ${st.name}`}
                    >
                      <View style={[styles.stageDotSmall, { backgroundColor: resolveStageColor(st.id) }]} />
                      <Text style={[styles.filterChipText, !on && styles.filterChipTextOff]} numberOfLines={1}>
                        {st.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              : null}
          </ScrollView>
        </View>
      ) : null}

      {/* Schedule body — view-mode specific. */}
      {viewMode === 'cards' ? (
        <FlatList
          data={rows}
          renderItem={renderRow}
          keyExtractor={keyExtractor}
          contentContainerStyle={[styles.listContent, { paddingHorizontal: hPad }]}
          refreshControl={refreshControl}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <EmptyState
              icon={search.length > 0 ? 'search' : 'musical-notes'}
              title={search.length > 0 ? 'No artists match your search' : 'No sets for this day'}
              message={
                search.length > 0
                  ? 'Try a different spelling or clear the search to see the full lineup.'
                  : 'Pick another day from the day selector to browse the schedule.'
              }
              action={
                search.length > 0
                  ? { label: 'Clear search', onPress: () => handleSearch('') }
                  : { label: 'Switch festival', onPress: clearSelection }
              }
            />
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      ) : timeBounds && visibleStages.length > 0 ? (
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
            days={days}
            allSets={allSets}
            picks={currentProfile?.picks ?? null}
          />
          {tbaSection}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.fallbackScroll} refreshControl={refreshControl}>
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
    // WCAG 2.5.5 / 2.5.8 minimum 44px touch target — these header chips were
    // ~24px tall; matches the day/filter chip floor.
    minHeight: 44,
    justifyContent: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    // WCAG 2.5.5 / 2.5.8 minimum 44x44px touch target (motor accessibility).
    minHeight: 44,
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
  todayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.colors.accent.aqua,
  },
  todayDotActive: {
    backgroundColor: t.colors.text.onLightAccent,
  },
  filterRow: {
    paddingBottom: t.spacing[2],
  },
  filterContent: {
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[2],
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    // WCAG 2.5.5 / 2.5.8 minimum 44x44px touch target (motor accessibility).
    minHeight: 44,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  filterChipActive: {
    backgroundColor: t.colors.accent.aqua,
    borderColor: t.colors.accent.aqua,
  },
  // Inactive (filtered-out) stage chip. A deselected chip is still interactive
  // (tap to re-enable), so it must NOT read as a disabled control. Instead of
  // opacity — which screen readers can't perceive and which dropped the muted
  // label below AA (~2.7:1) — we signal "off" structurally: a recessed
  // background + lighter border. The label keeps text.secondary (≥4.5:1) and
  // the stage dot stays full-opacity (3:1+), so contrast never regresses.
  filterChipOff: {
    backgroundColor: t.colors.bg.primary,
    borderColor: t.colors.border.light,
  },
  filterChipText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  filterChipTextActive: {
    color: t.colors.text.onLightAccent,
  },
  filterChipTextOff: {
    color: t.colors.text.secondary,
  },
  stageDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
