import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  type ListRenderItem,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFestivalDataStore, useFestivalStore, useAuthStore, useCrewStore } from '@festie/shared/stores';
import { usePicks, useFestival } from '@festie/shared/hooks';
import {
  artistDisplayName,
  getSetHotness,
  getConflictingSetIds,
  timeToMinutes,
  festivalPhase,
  byStartTime,
} from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useListBottomInset } from '../../hooks/useListBottomInset';
import { safeStageColor } from '../../lib/stageColor';
import { useUI, type ViewMode } from '../../contexts/UIContext';
import type { TimeBounds } from '../../hooks/useNowIndicator';
import { useHaptics } from '../../hooks/useHaptics';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import SegmentedControl from '../../components/SegmentedControl';
import NowNextStrip from '../../components/NowNextStrip';
import PhaseHomeActions from '../../components/PhaseHomeActions';
import FestivalList from '../../components/FestivalList';
import FreshnessChip from '../../components/FreshnessChip';
import SetCardMobile from '../../components/SetCardMobile';
import EmptyState from '../../components/EmptyState';
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

type ListRow =
  | { kind: 'stageHeader'; key: string; stageName: string; stageColor: string }
  | { kind: 'set'; key: string; set: FestivalSet };

export default function TimelineScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const haptics = useHaptics();
  const reduceMotion = useReduceMotion();
  const { viewMode, setViewMode } = useUI();
  const { width, height } = useWindowDimensions();

  // Responsive horizontal gutter. Phones keep the standard spacing[4] (16px)
  // edge padding. On tablet-class widths a flat 16px gutter leaves the chrome
  // (search bar, day/filter chips, view switcher) stranded against huge empty
  // sidebars, so we widen the gutter and cap the content column — when the
  // window is wider than maxContentWidth the extra space is split evenly,
  // centering the content instead of stretching it edge-to-edge.
  // Cards now scroll as one page (chrome rides in the list header), so the list
  // owns the last-card cushion. This is a tab screen — the opaque tab bar already
  // absorbs the home-indicator inset, so just a visible cushion (no safe-area).
  const cardsBottomPad = useListBottomInset({ includeSafeArea: false });
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
  const activeCrew = useCrewStore((s) => s.activeCrew);
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
  // DC1 — search bar and the stage/my-picks + phase-action setup chrome fold
  // behind a compact icon row so the timeline owns the viewport on small
  // phones. Day chips stay always visible (the one mid-festival control). Both
  // panels auto-open when they carry active state (a live search / a stage or
  // my-picks filter) so a user can't lose track of a filter that's hiding rows.
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Cards view: a scroll-to-top affordance for long lineups. We track whether
  // the list is scrolled past a threshold and expose a ref to snap it back.
  const listRef = useRef<FlatList<ListRow>>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  // Recompute on every render (cheap) so the "today" dot updates at midnight
  // without needing an explicit timer. The component re-renders on store
  // updates, search keystrokes, etc., so this stays current in practice.
  const todayStr = new Date().toLocaleDateString('en-CA');

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

  // One-tap reset for every active schedule filter (search text, my-picks, stage
  // selection) — the recoverability companion to the results summary chip.
  const clearAllFilters = useCallback(() => {
    haptics.select();
    handleSearch('');
    setOnlyMine(false);
    setActiveStages([]);
  }, [haptics, handleSearch, setActiveStages]);

  // Cards scroll tracking: reveal the scroll-to-top FAB once the user is well
  // past the fold. Guarded so the setState only fires on an actual transition.
  const handleCardsScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    setShowScrollTop((prev) => {
      const next = y > 640;
      return prev === next ? prev : next;
    });
  }, []);

  const scrollCardsToTop = useCallback(() => {
    haptics.select();
    listRef.current?.scrollToOffset({ offset: 0, animated: !reduceMotion });
    setShowScrollTop(false);
  }, [haptics, reduceMotion]);

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

  // Stable separator so FlatList doesn't recreate it on every render.
  const cardsSeparator = useCallback(() => <View style={styles.separator} />, [styles.separator]);

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

  // F2 — when the selected festival failed to load (flaky wifi refresh, cold
  // restore, server 500) `sets` stays empty; surface the real error + a retry
  // instead of the misleading "No sets for this day" empty state. Mirrors the
  // Picks tab's error ladder. Only kicks in when we genuinely have no sets to
  // show — a populated cache still renders normally even if a refetch errored.
  const scheduleLoadError = error && allSets.length === 0 ? error : null;

  const errorScheduleState = (
    <EmptyState
      icon="cloud-offline-outline"
      title="Couldn’t load the schedule"
      message={scheduleLoadError ?? ''}
      action={{
        label: 'Try again',
        onPress: () => {
          if (currentFestival) selectFestival(currentFestival.id).catch(() => {});
        },
      }}
    />
  );

  // When "my picks only" filters the timed timeline (and the TBA list) down to
  // nothing, the day still HAS sets — they're just unpicked. Reuse the same
  // onlyMine-aware branch as cardsEmpty ("No picks… / Show all sets") instead of
  // the false "No sets for this day" / "Switch festival". The timeless-picks
  // hint still wins when the user does have TBA picks (timelessSets non-empty).
  const emptyScheduleState =
    onlyMine && search.length === 0 && timelessSets.length === 0 ? (
      <EmptyState
        icon="star-outline"
        title="No picks for this day yet"
        message="Tap a priority on any set to add it here, or browse the full lineup."
        action={{ label: 'Show all sets', onPress: () => setOnlyMine(false) }}
      />
    ) : (
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

  // Cards-view empty element. Layers three honest cases: a failed load (error +
  // retry), the "my picks only" filter resolving to nothing (nudge to pick or
  // show all), and the generic no-results / no-search states.
  const cardsEmpty = scheduleLoadError ? (
    errorScheduleState
  ) : onlyMine && search.length === 0 ? (
    <EmptyState
      icon="star-outline"
      title="No picks for this day yet"
      message="Tap a priority on any set to add it here, or browse the full lineup."
      action={{ label: 'Show all sets', onPress: () => setOnlyMine(false) }}
    />
  ) : (
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
  );

  // No festival selected — show the festival selector. FestivalList owns its own
  // loading (skeleton), error, and empty states (F21); the screen no longer
  // pre-empts them with a separate spinner/EmptyState, which produced two
  // different-looking treatments for the identical condition.
  if (!currentFestival) {
    return (
      // ScreenHeader owns the top safe-area inset (insets.top + spacing[4]) — the
      // native Tabs nav header is hidden (see (tabs)/_layout.tsx), so this is the
      // single top of the screen.
      <View style={styles.container}>
        <ScreenHeader title="Select a Festival" icon="musical-notes" />
        <FestivalList />
      </View>
    );
  }

  // DC1 — a filter is "active" when it's currently hiding/altering rows. The
  // search and filter panels stay forced-open while their state is active so a
  // user can always see (and clear) a filter that's shrinking the schedule,
  // even though both default to collapsed.
  const stageFilterActive = activeStages.length > 0;
  const filtersActive = onlyMine || stageFilterActive;
  const searchOpen = showSearch || search.length > 0;
  const filtersOpen = showFilters || filtersActive;
  // Any narrowing in effect (search OR my-picks OR a stage subset) — gates the
  // results-summary + Clear-all chip.
  const anyFilterActive = search.length > 0 || filtersActive;

  // Schedule controls (Now & Next, phase actions, search, day + stage filters).
  // In Cards view these ride in the FlatList's ListHeaderComponent so the WHOLE
  // page scrolls as one — the cards get full height instead of a small window
  // pinned under a tall fixed chrome stack. In Timeline view they stay fixed
  // above the bounded 2D timeline (which manages its own internal scroll).
  // Passed as an element (not an inline component) so the search TextInput keeps
  // focus across keystroke re-renders.
  const controls = (
    <>
      {/* Live-day Now & Next surface: shows the picked set playing now / up next
          inline, tapping through to the full Now & Next screen. Renders nothing
          when there's no current/upcoming pick. */}
      <View style={{ paddingHorizontal: hPad }}>
        <NowNextStrip onPress={() => router.push('/festival-mode')} />
      </View>

      {/* F19 — offline-honest freshness for the flagship schedule surface,
          matching the crew tab's chip. Driven by festivalDataStore's
          _festivalCachedAt; renders nothing until the schedule is cached once. */}
      <View style={[styles.freshnessRow, { paddingHorizontal: hPad }]}>
        <FreshnessChip surface="schedule" />
      </View>

      {/* DC1 — search and the stage / my-picks + phase-action setup chrome are
          folded behind the search/filter toggles in the control row above; only
          the day chips (the one mid-festival control) stay always visible. The
          panels expand inline here when toggled (or when they carry active
          state), so on small phones the timeline keeps ~70% of the viewport. */}
      {searchOpen ? (
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
            autoFocus={showSearch && search.length === 0}
            accessibilityLabel="Search the lineup"
            returnKeyType="search"
          />
          {search.length > 0 ? (
            <TouchableOpacity
              onPress={() => handleSearch('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={13}
            >
              <Ionicons name="close-circle" size={18} color={t.colors.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* P1-5 — phase-aware home actions: re-prioritizes the crew's destinations
          (picks / crew / find / Now & Next / wrap) by festival phase. Hidden when
          the festival has no usable dates (phase === null). Folds behind the
          filter toggle (DC1) — it's a setup action, not a mid-crowd one. */}
      {phase && filtersOpen ? (
        <View style={{ paddingHorizontal: hPad }}>
          <PhaseHomeActions phase={phase} />
        </View>
      ) : null}

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
                  style={styles.dayChip}
                  onPress={() => {
                    haptics.select();
                    setSelectedDay(day.index);
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Day: ${day.label ?? day.date}${isToday ? ' (today)' : ''}`}
                >
                  <View style={[styles.dayChipBg, active && styles.dayChipBgActive]} pointerEvents="none" />
                  {isToday ? <View style={[styles.todayDot, active && styles.todayDotActive]} /> : null}
                  <Text
                    style={[styles.dayText, active && styles.dayTextActive]}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    textBreakStrategy="simple"
                  >
                    {/* Trailing NBSP: the bg-sibling above stops the rounded pill
                        from clipping, but Fabric still self-under-measures this
                        single-line node and drops the last glyph ("Frida"). The
                        sacrificial space is dropped instead, leaving the word intact. */}
                    {(day.label ?? day.date) + ' '}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* Stage + my-picks filters — folded behind the filter toggle (DC1). */}
      {filtersOpen && (currentProfile || stages.length > 1) ? (
        <View style={styles.filterRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.filterContent, { paddingHorizontal: hPad }]}
            // Android-native right-edge fade — signals scrollable overflow without
            // requiring expo-linear-gradient. No-op on iOS (ignored silently).
            fadingEdgeLength={Platform.OS === 'android' ? 32 : 0}
          >
            {currentProfile ? (
              // R3 single-accent-fill-per-screen: the SegmentedControl already
              // holds the solid-aqua primary fill. The My picks chip uses the
              // outlined/tinted secondary variant (aqua border + aqua text on
              // transparent bg) so two solid aqua fills never appear together.
              <TouchableOpacity
                style={[styles.filterChip, onlyMine && styles.filterChipActiveTinted]}
                onPress={() => setOnlyMine((v) => !v)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: onlyMine }}
                accessibilityLabel="Show only my picks"
              >
                <Ionicons name="star" size={12} color={onlyMine ? t.colors.accent.aqua : t.colors.text.muted} />
                <Text
                  style={[styles.filterChipText, onlyMine && styles.filterChipTextTinted]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  My picks
                </Text>
              </TouchableOpacity>
            ) : null}
            {stages.length > 1
              ? stages.map((st) => {
                  const on = effectiveStages.includes(st.id);
                  // Stage dots keep their data-driven identity color (matching the
                  // timeline columns) — the accent rule governs UI accents, not the
                  // stage palette. Active chips stay neutral; a solid aqua fill per
                  // chip would flood the screen with accent fills (R3).
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
                      <Text
                        style={[styles.filterChipText, !on && styles.filterChipTextOff]}
                        numberOfLines={1}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                      >
                        {st.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              : null}
          </ScrollView>
        </View>
      ) : null}

      {/* Results summary + Clear-all. Surfaces honestly how many sets the active
          search/stage/my-picks filters resolve to, and gives a single recovery
          tap when a filter is hiding most of the lineup. Only shown while a
          filter is actually narrowing the list. */}
      {anyFilterActive ? (
        <View style={[styles.resultsRow, { paddingHorizontal: hPad }]}>
          <Text style={styles.resultsText} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {filteredSets.length} {filteredSets.length === 1 ? 'set' : 'sets'}
            {onlyMine ? ' · my picks' : ''}
            {stageFilterActive ? ` · ${activeStages.length} ${activeStages.length === 1 ? 'stage' : 'stages'}` : ''}
            {/* The count spans the whole filtered day, but in Timeline mode the
                timeline only plots timed sets — TBA sets live in the docked TBA
                list below. Qualify how many of the N are unscheduled so the
                number can't read as "missing" rows from the timeline. */}
            {viewMode === 'timeline' && timelessSets.length > 0 ? ` · ${timelessSets.length} TBA` : ''}
          </Text>
          <TouchableOpacity
            onPress={clearAllFilters}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
          >
            <Text style={styles.clearAllText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Clear all
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </>
  );

  // DC1 (Option C) — the Switch + Now&Next actions move into the header's
  // trailing slot, collapsing the former standalone live row. The pulsing
  // LiveDot stays in the control row below as the now indicator.
  const headerActions = (
    <View style={styles.headerActions}>
      {/* Manual refresh for ALL views — the RefreshControls only cover the Cards
          list + fallback scroll, leaving Timeline with no pull-to-refresh. */}
      <TouchableOpacity
        style={styles.headerIconButton}
        onPress={handleRefresh}
        disabled={isLoading}
        activeOpacity={0.7}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Refresh schedule"
        accessibilityState={{ busy: isLoading }}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={t.colors.accent.aqua} />
        ) : (
          <Ionicons name="refresh" size={t.iconSize.lg} color={t.colors.accent.aqua} />
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.headerIconButton}
        onPress={clearSelection}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Switch festival"
      >
        <Ionicons name="swap-horizontal" size={20} color={t.colors.accent.aqua} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.headerIconButton}
        onPress={() => router.push('/festival-mode')}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Open Now and Next"
      >
        {/* "Live" is reserved for location (P1-2); flash = Now & Next. */}
        <Ionicons name="flash" size={20} color={t.colors.accent.aqua} />
      </TouchableOpacity>
      {festivalHasTimedSets ? (
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => router.push('/grid')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Open the schedule grid"
        >
          {/* The dense 2D stage×time grid lives on its own full-screen route. */}
          <Ionicons name="grid-outline" size={20} color={t.colors.text.secondary} />
        </TouchableOpacity>
      ) : null}
      {activeCrew ? (
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => router.push('/find')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Find your crew"
        >
          {/* Secondary header icon — coral is reserved for danger/SOS, and the
              SOS affordance itself lives inside /find, not on this trigger. */}
          <Ionicons name="navigate-circle-outline" size={20} color={t.colors.text.secondary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );

  return (
    // ScreenHeader owns the top safe-area inset (insets.top + spacing[4]) — the
    // native Tabs nav header is hidden (see (tabs)/_layout.tsx), so this is the
    // single top of the screen, sitting above the consolidated control row.
    <View style={styles.container}>
      <ScreenHeader title={currentFestival.name} icon="calendar-outline" right={headerActions} />
      {/* DC1 — one consolidated control row: LiveDot now-indicator, the
          view switcher, and the search/filter toggles. The search bar and the
          stage/phase filters fold inline below (in `controls`) only when their
          toggle is on or they carry active state, reclaiming vertical space. */}
      <View style={[styles.viewSwitcher, { paddingHorizontal: hPad }]}>
        {/* No now-indicator here: it crowded the row and truncated the
            Timeline/Cards labels on narrow phones. The real now/next surface is
            NowNextStrip above (shown only when a pick is actually live). */}
        <View style={styles.switcherFlex}>
          <SegmentedControl
            options={VIEW_OPTIONS}
            value={viewMode}
            onChange={setViewMode}
            accessibilityLabel="Schedule view"
          />
        </View>
        <TouchableOpacity
          style={[styles.toggleButton, searchOpen && styles.toggleButtonActive]}
          // searchOpen stays true while a query is present (searchOpen = showSearch
          // || search.length > 0), so merely toggling showSearch can't close an
          // active search — the panel re-opens itself. Closing must also CLEAR the
          // query so the X reliably collapses the bar.
          onPress={() => {
            if (searchOpen) {
              handleSearch('');
              setShowSearch(false);
            } else {
              setShowSearch(true);
            }
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded: searchOpen }}
          accessibilityLabel={searchOpen ? 'Hide search' : 'Search the lineup'}
        >
          {/* When the search bar is open a search icon inside the field already
              serves as the affordance — switch the header trigger to a close icon
              so the two search icons don't appear simultaneously on screen. */}
          <Ionicons
            name={searchOpen ? 'close' : 'search'}
            size={18}
            color={searchOpen ? t.colors.accent.aqua : t.colors.text.secondary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, filtersOpen && styles.toggleButtonActive]}
          onPress={() => setShowFilters((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersOpen }}
          accessibilityLabel={filtersOpen ? 'Hide filters' : 'Show filters'}
        >
          <Ionicons
            name="options-outline"
            size={18}
            color={filtersOpen ? t.colors.accent.aqua : t.colors.text.secondary}
          />
          {filtersActive ? <View style={styles.toggleDot} /> : null}
        </TouchableOpacity>
      </View>

      {/* Schedule body — view-mode specific. In Cards view the `controls` ride
          in the FlatList's ListHeaderComponent so the WHOLE page scrolls as one
          (cards get full height); in Timeline view they stay fixed above the
          bounded 2D timeline. */}
      {viewMode === 'cards' ? (
        <>
          <FlatList
            ref={listRef}
            style={styles.scrollBody}
            data={rows}
            renderItem={renderRow}
            keyExtractor={keyExtractor}
            ListHeaderComponent={controls}
            contentContainerStyle={[styles.listContent, { paddingHorizontal: hPad, paddingBottom: cardsBottomPad }]}
            refreshControl={refreshControl}
            ItemSeparatorComponent={cardsSeparator}
            // F2 — a failed festival load surfaces the error + retry rather than a
            // misleading "No sets" empty state (see cardsEmpty).
            ListEmptyComponent={cardsEmpty}
            // Perf for big lineups: cap the initial + per-batch render window so a
            // 200-set day paints fast and scrolls without a long first frame.
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            windowSize={11}
            onScroll={handleCardsScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentInsetAdjustmentBehavior="automatic"
          />
          {showScrollTop ? (
            <TouchableOpacity
              style={[styles.scrollTopFab, { right: hPad }]}
              onPress={scrollCardsToTop}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Scroll to top of the lineup"
            >
              <Ionicons name="chevron-up" size={18} color={t.colors.text.onLightAccent} />
              <Text style={styles.scrollTopText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Top
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : timeBounds && visibleStages.length > 0 ? (
        <>
          {controls}
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
            {/* Dock the TBA list below the timeline in its own bounded scroll so
                it's always reachable. A ScrollView with a fixed maxHeight stays
                content-sized while the section is collapsed (just its header) and,
                once expanded, caps at ~40% of the screen and scrolls internally —
                instead of ballooning and pushing itself + the timeline past
                viewBody's clipped (overflow:hidden) bottom edge, which made the
                TBA cards unreachable. */}
            {tbaSection ? <ScrollView style={{ maxHeight: Math.round(height * 0.4) }}>{tbaSection}</ScrollView> : null}
          </View>
        </>
      ) : (
        <ScrollView
          style={styles.scrollBody}
          contentContainerStyle={styles.fallbackScroll}
          refreshControl={refreshControl}
          contentInsetAdjustmentBehavior="automatic"
        >
          {controls}
          {scheduleLoadError ? errorScheduleState : emptyScheduleState}
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
    // Clip to the screen frame. The schedule body's internal scroll views can
    // size to tall content; without this, on short screens (or large iOS notch
    // insets) that content overflows the frame's bottom edge and — because RN's
    // default overflow is 'visible' — paints AND intercepts touches over the
    // bottom tab bar, making tabs untappable. Clipping confines it to the body.
    overflow: 'hidden',
  },
  // DC1 — one horizontal control row: LiveDot · view switcher (flex) ·
  // search/filter toggles. Replaces the former two-line live row + switcher.
  // gap[1] (4px) instead of gap[2] (8px) recovers ~12px so both "Timeline" and
  // "Cards" labels fit without clipping on ~360dp phones (toggle targets are 44px
  // so they still comfortably meet WCAG 2.5.5 without the extra gap).
  viewSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  // minWidth:0 prevents the flex child from overflowing its flex allocation when
  // the SegmentedControl's natural content width exceeds the available space.
  switcherFlex: {
    flex: 1,
    minWidth: 0,
  },
  // DC1 (Option C) — Switch / Now&Next moved into ScreenHeader's trailing slot.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  headerIconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    // WCAG 2.5.5 / 2.5.8 minimum 44px touch target.
    minWidth: 44,
    minHeight: 44,
  },
  toggleButton: {
    alignItems: 'center',
    justifyContent: 'center',
    // WCAG 2.5.5 / 2.5.8 minimum 44px touch target.
    minWidth: 44,
    minHeight: 44,
    borderRadius: t.radii.default,
  },
  toggleButtonActive: {
    backgroundColor: t.colors.aquaAlpha[12],
  },
  // Active-filter affordance: a small aqua dot on the filter toggle so a
  // collapsed-but-active filter stays discoverable.
  toggleDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.colors.accent.aqua,
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
    // border.light (0.10 alpha) instead of border.default (0.06) so the field
    // reads as an interactive text input and is not confused with the card
    // surfaces (same #1a1a1a bg) that lack a distinguishing border.
    borderColor: t.colors.border.light,
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
  freshnessRow: {
    paddingTop: t.spacing[2],
  },
  // Results summary + Clear-all chip. Sits between the filter chrome and the
  // list; the count reads left, the recovery action right.
  resultsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[3],
    paddingTop: t.spacing[2],
    paddingBottom: t.spacing[1],
  },
  resultsText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  clearAllText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  // Scroll-to-top FAB (cards view, long lineups). Aqua pill with dark ink to
  // match the timeline's Now FAB; sits above the tab bar, right-aligned.
  scrollTopFab: {
    position: 'absolute',
    bottom: t.spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.aqua,
    minHeight: 44,
    // Lift the pill above the surface so it reads as floating over the list.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  scrollTopText: {
    ...typeStyle('label', 700),
    color: t.colors.text.onLightAccent,
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
    // spacing[6] (was [4]): enough horizontal room that the longest day labels
    // ("Saturday"/"Sunday") clear the pill's rounded edge comfortably — the
    // bg-sibling stops the clip, this keeps the trailing glyph off the edge.
    paddingHorizontal: t.spacing[6],
    paddingVertical: t.spacing[3],
    // WCAG 2.5.5 / 2.5.8 minimum 44x44px touch target (motor accessibility).
    minHeight: 44,
  },
  // Visual (bg/border/radius) lives on this absolutely-positioned sibling,
  // painted behind the label — not on dayChip itself. A Text that's a CHILD of
  // a bg+borderRadius View gets clipped to the rounded bounds on Android; as a
  // sibling it can't be (see SegmentedControl's thumb for the same pattern).
  dayChipBg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  dayChipBgActive: {
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
  // R3 outlined-secondary variant for the "My picks" chip. The SegmentedControl
  // already holds the solid-aqua primary fill; a second solid aqua fill (the
  // old filterChipActive) violates the single-accent-fill-per-screen rule.
  // Outlined tint (aqua border + tinted bg, no solid fill) is the correct
  // secondary treatment for a non-primary toggle alongside a primary control.
  filterChipActiveTinted: {
    backgroundColor: t.colors.aquaAlpha[12],
    borderColor: t.colors.aquaAlpha[70],
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
  // Companion text style for the outlined-tinted chip variant (My picks).
  filterChipTextTinted: {
    color: t.colors.accent.aqua,
  },
  filterChipTextOff: {
    color: t.colors.text.secondary,
  },
  stageDotSmall: {
    width: 10,
    height: 10,
    borderRadius: 5,
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
  // flex:1 binds the cards FlatList / fallback ScrollView to the (overflow-clipped)
  // container so they scroll internally up to the tab bar instead of sizing to
  // content and being clipped.
  scrollBody: {
    flex: 1,
  },
  viewBody: {
    flex: 1,
    // Bound the timeline to the body so its internal scroll never bleeds over
    // the tab bar (see container note).
    overflow: 'hidden',
  },
  fallbackScroll: {
    flexGrow: 1,
    paddingBottom: t.spacing[4],
  },
}));
