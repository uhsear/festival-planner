import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
  TextInput,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFestivalDataStore } from '@festie/shared/stores';
import { usePicks, useFestival } from '@festie/shared/hooks';
import type { FestivalSet, Priority, Stage } from '@festie/shared/types';
import { artistDisplayName, getConflictingSetIds, buildPicksIcs, buildPicksShareUrl } from '@festie/shared/utils';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useHaptics } from '../../hooks/useHaptics';
import { duration as motionDuration } from '@festie/shared/tokens';
import { safeStageColor } from '../../lib/stageColor';
import { priorityColor } from '../../lib/priorityColor';
import ScreenHeader from '../../components/ScreenHeader';
import EmptyState from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import SetCardMobile from '../../components/SetCardMobile';
import ClashBanner from '../../components/ClashBanner';

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

const PRIORITY_CHOICES: readonly { value: Priority; label: string }[] = [
  { value: 'must', label: 'Must' },
  { value: 'want-to-see', label: 'Want' },
  { value: 'maybe', label: 'Maybe' },
];

/** How the picks plan is organized: by festival day, or by priority tier. */
type GroupMode = 'day' | 'priority';

/** The active focus filter applied on top of the chosen grouping. */
type PickFilter = 'all' | Priority | 'clashes';

/**
 * A flattened list row: a collapsible group header (day OR priority tier
 * depending on `groupMode`), a sub-group header, or a picked set. Keeping
 * everything in one FlatList (rather than nested .map in a ScrollView) preserves
 * list virtualization across the whole picks plan.
 */
type Row =
  | { kind: 'group'; key: string; groupId: string; label: string; count: number; color?: string; collapsed: boolean }
  | { kind: 'subgroup'; key: string; label: string; count: number; color?: string }
  | { kind: 'set'; key: string; set: FestivalSet };

const SCROLL_TOP_THRESHOLD = 520;

export default function PicksScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const haptics = useHaptics();

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

  // ── Organize / focus controls ───────────────────────────────────────────
  const [groupMode, setGroupMode] = useState<GroupMode>('day');
  const [filter, setFilter] = useState<PickFilter>('all');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // Collapsed group ids (e.g. `day-2`, `prio-must`) — lets a long multi-day plan
  // fold to its headers and scan fast. In-memory for the screen's lifetime.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showScrollTop, setShowScrollTop] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);

  const { getMyPick, savePick, removePick, getMyNote } = usePicks();
  const { getDays, getStageColor, getStageName } = useFestival();

  const days = useMemo(() => getDays(), [getDays]);

  // Conflict highlighting mirrors the web schedule: any two picked sets whose
  // times overlap are flagged. Computed across all picked sets, not per-day.
  const conflictIds = useMemo(() => getConflictingSetIds(sets, getMyPick), [sets, getMyPick]);

  // ── At-a-glance summary across ALL picks (independent of the active filter,
  // so the counts stay a stable overview the user can navigate by). ──────────
  const stats = useMemo(() => {
    let must = 0;
    let want = 0;
    let maybe = 0;
    for (const s of sets) {
      const p = getMyPick(s.id);
      if (p === 'must') must += 1;
      else if (p === 'want-to-see') want += 1;
      else if (p === 'maybe') maybe += 1;
    }
    return { must, want, maybe, total: must + want + maybe, clashes: conflictIds.size };
  }, [sets, getMyPick, conflictIds]);

  // If the user is focused on clashes and then resolves the last one, don't
  // strand them on an empty "no clashes" view — fall the view back to the full
  // plan without mutating the stored filter (derive instead of setState-in-effect).
  const effectiveFilter: PickFilter = filter === 'clashes' && stats.clashes === 0 ? 'all' : filter;

  // Stable start-time-then-name comparator for sets within a bucket.
  const compareSets = useMemo(() => {
    const separator = currentFestival?.b2bSeparator;
    return (a: FestivalSet, b: FestivalSet) => {
      const timeA = a.startTime || '';
      const timeB = b.startTime || '';
      if (timeA && timeB) return timeA.localeCompare(timeB);
      if (timeA && !timeB) return -1;
      if (!timeA && timeB) return 1;
      return artistDisplayName(a, separator).localeCompare(artistDisplayName(b, separator), undefined, {
        sensitivity: 'base',
      });
    };
  }, [currentFestival?.b2bSeparator]);

  // Build the flattened row list. In `day` mode the outer header is the festival
  // day and the inner sub-group is the priority tier (must → want → maybe); in
  // `priority` mode that nesting inverts (tier outer, day inner). Search + the
  // focus filter prune the eligible sets first; collapsed groups emit only their
  // header. Days / tiers with no surviving picks are skipped entirely.
  const rows = useMemo<Row[]>(() => {
    const separator = currentFestival?.b2bSeparator;
    const q = search.trim().toLowerCase();
    const matchesSearch = (s: FestivalSet) => {
      if (!q) return true;
      const name = artistDisplayName(s, separator).toLowerCase();
      const stage = (getStageName(s.stageId) || '').toLowerCase();
      return name.includes(q) || stage.includes(q);
    };

    const eligible = sets.filter((s) => {
      const p = getMyPick(s.id);
      if (!p) return false;
      if (!matchesSearch(s)) return false;
      if (effectiveFilter === 'clashes') return conflictIds.has(s.id);
      if (effectiveFilter !== 'all' && p !== effectiveFilter) return false;
      return true;
    });

    const out: Row[] = [];

    if (groupMode === 'day') {
      days.forEach((day) => {
        const daySets = eligible.filter((s) => s.dayIndex === day.index);
        if (daySets.length === 0) return;
        const groupId = `day-${day.index}`;
        const isCollapsed = collapsed.has(groupId);
        out.push({
          kind: 'group',
          key: `g-${groupId}`,
          groupId,
          label: day.label || day.date,
          count: daySets.length,
          collapsed: isCollapsed,
        });
        if (isCollapsed) return;
        PRIORITY_SECTIONS.forEach((section) => {
          const picked = daySets.filter((s) => getMyPick(s.id) === section.value).sort(compareSets);
          if (picked.length === 0) return;
          out.push({
            kind: 'subgroup',
            key: `sg-${day.index}-${section.value}`,
            label: section.label,
            color: priorityColor(t, section.value),
            count: picked.length,
          });
          picked.forEach((set) => out.push({ kind: 'set', key: `set-${set.id}`, set }));
        });
      });
    } else {
      PRIORITY_SECTIONS.forEach((section) => {
        const tierSets = eligible.filter((s) => getMyPick(s.id) === section.value);
        if (tierSets.length === 0) return;
        const groupId = `prio-${section.value}`;
        const isCollapsed = collapsed.has(groupId);
        out.push({
          kind: 'group',
          key: `g-${groupId}`,
          groupId,
          label: section.label,
          count: tierSets.length,
          color: priorityColor(t, section.value),
          collapsed: isCollapsed,
        });
        if (isCollapsed) return;
        days.forEach((day) => {
          const daySets = tierSets.filter((s) => s.dayIndex === day.index).sort(compareSets);
          if (daySets.length === 0) return;
          out.push({
            kind: 'subgroup',
            key: `sg-${section.value}-${day.index}`,
            label: day.label || day.date,
            count: daySets.length,
          });
          daySets.forEach((set) => out.push({ kind: 'set', key: `set-${set.id}`, set }));
        });
      });
    }

    return out;
  }, [
    days,
    sets,
    getMyPick,
    getStageName,
    currentFestival?.b2bSeparator,
    t,
    groupMode,
    effectiveFilter,
    search,
    conflictIds,
    collapsed,
    compareSets,
  ]);

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

  const toggleCollapse = useCallback(
    (groupId: string) => {
      haptics.tap();
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        return next;
      });
    },
    [haptics],
  );

  const setFocusFilter = useCallback(
    (next: PickFilter) => {
      haptics.select();
      // Tap an active chip to clear it (back to the whole plan).
      setFilter((prev) => (prev === next ? 'all' : next));
    },
    [haptics],
  );

  const setGroupModeHaptic = useCallback(
    (mode: GroupMode) => {
      haptics.select();
      setGroupMode(mode);
    },
    [haptics],
  );

  const clearFilters = useCallback(() => {
    haptics.tap();
    setFilter('all');
    setSearch('');
    setSearchOpen(false);
  }, [haptics]);

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
      .map(([stageId, setIds]) => ({
        key: `stage-${stageId}`,
        stageId,
        label: getStageName(stageId) || 'Stage',
        setIds,
      }))
      .sort((a, b) => (order.get(a.stageId) ?? 0) - (order.get(b.stageId) ?? 0));
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
          haptics.success();
          const pLabel =
            bulkPriority === 'must' ? 'Must See' : bulkPriority === 'want-to-see' ? 'Want to See' : 'Maybe';
          Alert.alert(
            'Picks added',
            `Added ${setIds.length} set${setIds.length === 1 ? '' : 's'} from ${label} to ${pLabel}.`,
          );
        })
        .catch((e) => {
          // bulkSavePicks already rolled back + set the store error.
          haptics.warning();
          Alert.alert("Couldn't add picks", mapErrorToUserMessage(e, 'Try again.'));
        })
        .finally(() => setBulkBusyKey(null));
    },
    [bulkSavePicks, bulkPriority, bulkBusyKey, haptics],
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'group') {
        return (
          <TouchableOpacity
            style={styles.dayHeader}
            onPress={() => toggleCollapse(item.groupId)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: !item.collapsed }}
            accessibilityLabel={`${item.label}, ${item.count} pick${item.count === 1 ? '' : 's'}, ${
              item.collapsed ? 'collapsed, double tap to expand' : 'expanded, double tap to collapse'
            }`}
          >
            {item.color ? <View style={[styles.dot, { backgroundColor: item.color }]} /> : null}
            <Text style={styles.dayLabel} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
              {item.label}
            </Text>
            <View style={styles.countPill}>
              <Text style={styles.countText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {item.count}
              </Text>
            </View>
            <Ionicons
              name={item.collapsed ? 'chevron-down' : 'chevron-up'}
              size={t.iconSize.sm}
              color={t.colors.text.muted}
            />
          </TouchableOpacity>
        );
      }
      if (item.kind === 'subgroup') {
        return (
          <View style={styles.sectionHeader} accessibilityRole="header">
            {item.color ? <View style={[styles.dot, { backgroundColor: item.color }]} /> : null}
            <Text style={styles.sectionLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {item.label}
            </Text>
            <View style={styles.countPill}>
              <Text style={styles.countText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {item.count}
              </Text>
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
    [
      styles,
      getStageName,
      getStageColor,
      getMyPick,
      getMyNote,
      handlePickChange,
      conflictIds,
      router,
      t,
      reduceMotion,
      toggleCollapse,
    ],
  );

  const keyExtractor = useCallback((item: Row) => item.key, []);

  const handleRefresh = useCallback(() => {
    if (currentFestival) {
      haptics.tap();
      selectFestival(currentFestival.id).catch(() => {});
    }
  }, [currentFestival, selectFestival, haptics]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setShowScrollTop((prev) => {
      const next = y > SCROLL_TOP_THRESHOLD;
      return prev === next ? prev : next;
    });
  }, []);

  const scrollToTop = useCallback(() => {
    haptics.tap();
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [haptics]);

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
        haptics.success();
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/calendar',
          UTI: 'com.apple.ical.ics',
          dialogTitle: 'Add picks to calendar',
        });
      } else {
        Alert.alert('Sharing unavailable', 'Calendar sharing is not available on this device.');
      }
    } catch (e) {
      haptics.warning();
      Alert.alert("Couldn't export picks", mapErrorToUserMessage(e, 'Try again.'));
    } finally {
      setExportBusy(false);
    }
  }, [currentFestival, currentProfile, sets, stages, exportBusy, haptics]);

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
      <Text style={styles.calendarButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
        {exportBusy ? 'Exporting…' : 'Add to calendar'}
      </Text>
    </TouchableOpacity>
  );

  // Share a public, read-only link to my picks (server route GET /s/:profileId).
  const handleSharePicks = useCallback(() => {
    if (!currentProfile || !currentFestival) return;
    haptics.tap();
    const url = buildPicksShareUrl(currentProfile.id);
    Share.share({ message: `My ${currentFestival.name} picks on Festie: ${url}`, url }).catch(() => {});
  }, [currentProfile, currentFestival, haptics]);

  // ── At-a-glance summary + focus filter chips ─────────────────────────────
  const summaryRow =
    stats.total > 0 ? (
      <View style={styles.summaryRow}>
        <StatChip
          label="All"
          count={stats.total}
          active={effectiveFilter === 'all'}
          onPress={() => setFocusFilter('all')}
        />
        {stats.must > 0 ? (
          <StatChip
            label="Must"
            count={stats.must}
            color={t.colors.priority.must}
            active={effectiveFilter === 'must'}
            onPress={() => setFocusFilter('must')}
          />
        ) : null}
        {stats.want > 0 ? (
          <StatChip
            label="Want"
            count={stats.want}
            color={t.colors.priority.want}
            active={effectiveFilter === 'want-to-see'}
            onPress={() => setFocusFilter('want-to-see')}
          />
        ) : null}
        {stats.maybe > 0 ? (
          <StatChip
            label="Maybe"
            count={stats.maybe}
            color={t.colors.priority.maybe}
            active={effectiveFilter === 'maybe'}
            onPress={() => setFocusFilter('maybe')}
          />
        ) : null}
        {stats.clashes > 0 ? (
          <StatChip
            label="Clashes"
            count={stats.clashes}
            icon="warning"
            color={t.colors.accent.coral}
            danger
            active={effectiveFilter === 'clashes'}
            onPress={() => setFocusFilter('clashes')}
          />
        ) : null}
      </View>
    ) : null;

  const controlsRow =
    stats.total > 0 ? (
      <View style={styles.controlsRow}>
        <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Group picks by">
          {(['day', 'priority'] as const).map((mode) => {
            const activeMode = groupMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.segmentBtn, activeMode && styles.segmentBtnActive]}
                onPress={() => setGroupModeHaptic(mode)}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityState={{ selected: activeMode }}
                accessibilityLabel={mode === 'day' ? 'Group by day' : 'Group by priority'}
              >
                <Ionicons
                  name={mode === 'day' ? 'calendar-clear-outline' : 'flag-outline'}
                  size={t.iconSize.xs}
                  color={activeMode ? t.colors.accent.aqua : t.colors.text.muted}
                />
                <Text
                  style={[styles.segmentText, activeMode && styles.segmentTextActive]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  {mode === 'day' ? 'By day' : 'By priority'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.iconControl, (searchOpen || search.length > 0) && styles.iconControlActive]}
          onPress={() => {
            haptics.tap();
            setSearchOpen((v) => !v);
          }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ expanded: searchOpen }}
          accessibilityLabel={searchOpen ? 'Hide search' : 'Search my picks'}
        >
          <Ionicons
            name="search"
            size={t.iconSize.sm}
            color={searchOpen || search.length > 0 ? t.colors.accent.aqua : t.colors.text.muted}
          />
        </TouchableOpacity>
      </View>
    ) : null;

  const searchField =
    stats.total > 0 && searchOpen ? (
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={t.colors.text.placeholder} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Filter picks by artist or stage"
          placeholderTextColor={t.colors.text.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={search.length === 0}
          returnKeyType="search"
          accessibilityLabel="Filter my picks"
        />
        {search.length > 0 ? (
          <TouchableOpacity
            onPress={() => setSearch('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={18} color={t.colors.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
    ) : null;

  const bulkPanel = hasBulkGroups ? (
    <View style={styles.bulkPanel}>
      <TouchableOpacity
        style={styles.bulkHeader}
        onPress={() => {
          haptics.tap();
          setBulkOpen((v) => !v);
        }}
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
                  onPress={() => {
                    haptics.select();
                    setBulkPriority(p.value);
                  }}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${p.label} priority${active ? ', selected' : ''}`}
                  style={[styles.bulkChip, active && styles.bulkChipActive]}
                >
                  <View style={[styles.bulkChipDot, { backgroundColor: priorityColor(t, p.value) }]} />
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
          <Text style={styles.calendarButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
            Share picks
          </Text>
        </TouchableOpacity>
      </View>
      {summaryRow}
      {controlsRow}
      {searchField}
      <ClashBanner />
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

  // Distinguish "you have no picks at all" from "your filter/search hid them" so
  // the empty state is honest and offers the right next action.
  const filtersActive = effectiveFilter !== 'all' || search.trim().length > 0;
  const emptyComponent =
    stats.total === 0 ? (
      <EmptyState
        icon="star-outline"
        title="No picks yet"
        message="Browse artists and tap Must, Want, or Maybe — or use Bulk add above."
      />
    ) : effectiveFilter === 'clashes' ? (
      <EmptyState
        icon="checkmark-circle-outline"
        title="No clashes"
        message="Nothing on your plan overlaps — you're all set."
        action={{ label: 'Show all picks', onPress: clearFilters }}
      />
    ) : (
      <EmptyState
        icon="search-outline"
        title="No matching picks"
        message={search.trim() ? `Nothing matches “${search.trim()}”.` : 'No picks in this view.'}
        action={filtersActive ? { label: 'Clear filters', onPress: clearFilters } : undefined}
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
        icon="musical-note-outline"
        title="Join this festival first"
        message="Open the Schedule tab and join the festival to start saving picks."
        action={{ label: 'Go to Schedule', onPress: () => router.navigate('/(tabs)/') }}
      />
    );
  } else if (isLoading && stats.total === 0 && rows.length === 0) {
    body = <PicksSkeleton />;
  } else if (error && stats.total === 0) {
    body = (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn’t load your picks"
        message={error}
        action={{ label: 'Try again', onPress: handleRefresh }}
      />
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={listContentStyle}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={picksHeader}
        ListEmptyComponent={emptyComponent}
        ItemSeparatorComponent={Separator}
        refreshControl={refreshControl}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={false}
      />
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="My Picks" icon="star" />
      <View style={styles.body}>{body}</View>
      {showScrollTop ? (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(motionDuration.fast)}
          exiting={reduceMotion ? undefined : FadeOut.duration(motionDuration.fast)}
          style={[styles.fab, { bottom: insets.bottom + t.spacing[4] }]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={styles.fabButton}
            onPress={scrollToTop}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Scroll to top"
          >
            <Ionicons name="arrow-up" size={t.iconSize.md} color={t.colors.text.onLightAccent} />
          </TouchableOpacity>
        </Animated.View>
      ) : null}
    </View>
  );
}

function Separator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

/** A summary + focus-filter chip ("Must · 8"). Tapping toggles the filter. */
function StatChip({
  label,
  count,
  color,
  icon,
  active,
  danger,
  onPress,
}: {
  label: string;
  count: number;
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const t = useTokens();
  const styles = useStyles();
  const accent = danger ? t.colors.accent.coral : t.colors.accent.aqua;
  return (
    <TouchableOpacity
      style={[styles.statChip, active && (danger ? styles.statChipActiveDanger : styles.statChipActive)]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${count}${active ? ', filtering' : ''}`}
    >
      {icon ? (
        <Ionicons name={icon} size={t.iconSize.xs} color={color ?? t.colors.text.muted} />
      ) : color ? (
        <View style={[styles.statDot, { backgroundColor: color }]} />
      ) : null}
      <Text
        style={[styles.statLabel, active && { color: accent }]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        style={[styles.statCount, active && { color: accent }]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        numberOfLines={1}
      >
        {count}
      </Text>
    </TouchableOpacity>
  );
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
    flexShrink: 1,
  },
  separator: {
    height: t.spacing[2],
  },
  // ── Summary / focus-filter chips ─────────────────────────────────────────
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: t.spacing[2],
    marginBottom: t.spacing[2],
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.card,
    minHeight: 34,
  },
  statChipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  statChipActiveDanger: {
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  statCount: {
    ...typeStyle('caption', 700),
    color: t.colors.text.primary,
  },
  // ── Organize controls (group toggle + search) ────────────────────────────
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    marginBottom: t.spacing[2],
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    gap: t.spacing[1],
    padding: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.sm,
    minHeight: 36,
  },
  segmentBtnActive: {
    backgroundColor: t.colors.aquaAlpha[12],
  },
  segmentText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  segmentTextActive: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  iconControl: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  iconControlActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    marginBottom: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  searchInput: {
    flex: 1,
    ...typeStyle('body'),
    color: t.colors.text.primary,
    padding: 0,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  bulkChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
    flexShrink: 1,
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
  // ── Scroll-to-top FAB ─────────────────────────────────────────────────────
  fab: {
    position: 'absolute',
    right: t.spacing[4],
  },
  fabButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.aqua,
    // Soft elevation so the FAB floats above the list on both platforms.
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
}));
