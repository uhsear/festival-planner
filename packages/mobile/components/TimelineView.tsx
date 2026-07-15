import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  FlatList,
  AppState,
  useWindowDimensions,
  type ListRenderItem,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FestivalDay, FestivalSet, Priority, Stage } from '@festie/shared/types';
import { timeToMinutes, formatTime, artistDisplayName, getSetTimeBounds } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { safeStageColor } from '../lib/stageColor';
import { useNowIndicator, type TimeBounds } from '../hooks/useNowIndicator';
import { useReduceMotion } from '../hooks/useReduceMotion';

const SLOT_MINUTES = 15;
/**
 * Px per 15-min slot. The web grid uses ~36px/15min; mobile narrows this so a
 * full festival day stays scrollable without feeling endless. 22px/slot ≈
 * 1.47 px/min, inside the spec's 1.4–1.6 px/min target.
 */
const ROW_HEIGHT = 22;
// DC11 — minimum rendered block height. 28px + the block's 8+8 vertical hitSlop
// reaches the 44pt WCAG touch-target floor; the px/min scale is preserved for
// any set ≥19 min (everything shorter snaps up to this floor).
const MIN_BLOCK_H = 28;
const GUTTER_W = 44;
const STAGE_HEADER_H = 40;

export interface TimelineViewProps {
  visibleStages: Stage[];
  timedSets: FestivalSet[];
  timeBounds: TimeBounds | null;
  selectedDay: number;
  conflictIds: Set<string>;
  b2bSeparator?: string;
  getMyPick: (setId: string) => Priority | null | undefined;
  getStageColor: (stageId: string) => string;
  onPickChange: (setId: string, priority: Priority | null) => void;
  onSetPress: (set: FestivalSet) => void;
  /**
   * Live mode inputs (optional so existing callers keep working): the festival
   * day records + the full set list power the "up next" countdown, which is
   * computed off the SHARED getSetTimeBounds. Omit them and the countdown
   * simply doesn't render. `days` is the screen's lightweight day shape
   * (`getDays()` → `{ index, date }`); getSetTimeBounds only reads `.date` by
   * dayIndex, so the minimal `{ date }` structure is all that's required.
   */
  days?: { date: string }[];
  allSets?: FestivalSet[];
  picks?: Record<string, Priority> | null;
}

function fmtHour(mins: number): string {
  const hh = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  const h = hh % 12 || 12;
  const suffix = hh < 12 ? 'a' : 'p';
  return mm === 0 ? `${h}${suffix}` : `${h}:${String(mm).padStart(2, '0')}${suffix}`;
}

interface StageColumnProps {
  stage: Stage;
  sets: FestivalSet[];
  timeBounds: TimeBounds;
  stageColor: string;
  nowIndicator: number | null;
  conflictIds: Set<string>;
  b2bSeparator?: string;
  getMyPick: (setId: string) => Priority | null | undefined;
  onSetPress: (set: FestivalSet) => void;
  columnWidth: number;
  /**
   * Callback ref: every column registers its vertical ScrollView so the parent
   * can keep the shared now-scroll target pointed at whichever stage page is
   * currently centered (not a fixed column 0, which goes off-screen after the
   * first swipe — leaving the Now FAB + auto-scroll dead).
   */
  registerScrollRef?: (node: ScrollView | null) => void;
  onUserScroll?: () => void;
}

/**
 * One swipeable stage viewport: a sticky stage header, a left time gutter, and
 * the stage's set blocks positioned absolutely by start/duration. Only the
 * first (currently-centered) column receives the shared scrollRef so the NOW
 * button + day-change auto-scroll have a target.
 */
function StageColumn({
  stage,
  sets,
  timeBounds,
  stageColor,
  nowIndicator,
  conflictIds,
  b2bSeparator,
  getMyPick,
  onSetPress,
  columnWidth,
  registerScrollRef,
  onUserScroll,
}: StageColumnProps) {
  const t = useTokens();
  const styles = useStyles();
  const totalHeight = timeBounds.totalSlots * ROW_HEIGHT;

  const timeLabels = useMemo(() => {
    const out: { key: string; top: number; label: string; hour: boolean }[] = [];
    for (let i = 0; i < timeBounds.totalSlots; i++) {
      const mins = timeBounds.minMin + i * SLOT_MINUTES;
      const mm = mins % 60;
      if (mm === 0 || mm === 30) {
        out.push({
          key: `tl-${i}`,
          top: i * ROW_HEIGHT,
          label: fmtHour(mins),
          hour: mm === 0,
        });
      }
    }
    return out;
  }, [timeBounds.minMin, timeBounds.totalSlots]);

  return (
    <View style={[styles.stageColumn, { width: columnWidth }]}>
      <View style={[styles.stageHeader, { borderBottomColor: stageColor }]}>
        <View style={[styles.stageDot, { backgroundColor: stageColor }]} />
        <Text style={[styles.stageHeaderText, { color: stageColor }]} numberOfLines={1}>
          {stage.name}
        </Text>
      </View>

      <ScrollView
        ref={registerScrollRef}
        style={styles.columnScroll}
        contentContainerStyle={{ height: totalHeight }}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={onUserScroll}
      >
        {/* Time gutter + slot gridlines */}
        {timeLabels.map((tl) => (
          <View
            key={tl.key}
            style={[
              styles.gridLine,
              {
                top: tl.top,
                borderTopColor: tl.hour ? t.colors.border.light : t.colors.border.default,
              },
            ]}
          >
            <Text style={styles.timeLabel}>{tl.label}</Text>
          </View>
        ))}

        {/* Set blocks */}
        {sets.map((s) => {
          const startMin = timeToMinutes(s.startTime);
          let endMin = timeToMinutes(s.endTime);
          if (endMin <= startMin) endMin += 24 * 60;
          const top = ((startMin - timeBounds.minMin) / SLOT_MINUTES) * ROW_HEIGHT;
          // DC11 — enforce a 28px visual floor so block (28) + hitSlop (8+8)
          // reaches the 44pt WCAG 2.5.5/2.5.8 touch target even for back-to-back
          // 15-min sets; the px/min time scale still holds for sets ≥19 min.
          const rawHeight = Math.max(ROW_HEIGHT, ((endMin - startMin) / SLOT_MINUTES) * ROW_HEIGHT);
          const height = Math.max(MIN_BLOCK_H, rawHeight - 4);
          const myPick = getMyPick(s.id);
          const conflict = conflictIds.has(s.id);
          const name = artistDisplayName(s, b2bSeparator);
          // F49 — express the priority tier on the block: thicken + tint the
          // left rail by must/want/maybe, mirroring web's P1-3. A conflict keeps
          // its distinct coral border (incl. the left rail) and the warning icon,
          // so it always wins visually over the priority tint.
          const pickColor = myPick ? t.colors.priority[myPick === 'want-to-see' ? 'want' : myPick] : null;
          return (
            <TouchableOpacity
              key={s.id}
              style={[
                styles.setBlock,
                {
                  top: top + 2,
                  height,
                  left: GUTTER_W + 2,
                  right: 2,
                  borderLeftColor: pickColor ?? stageColor,
                  borderLeftWidth: myPick ? 4 : 3,
                  backgroundColor: myPick ? t.colors.bg.hover : t.colors.bg.card,
                },
                conflict && { borderColor: t.colors.accent.coral, borderLeftColor: t.colors.accent.coral },
              ]}
              onPress={() => onSetPress(s)}
              activeOpacity={0.7}
              // Short slots render at the MIN_BLOCK_H floor (28px); the 8+8
              // vertical hitSlop lifts the effective target to 44pt (WCAG 2.5.5).
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${stage.name}, ${formatTime(s.startTime)} to ${formatTime(s.endTime)}`}
            >
              <Text style={styles.setArtist} numberOfLines={1}>
                {name}
              </Text>
              {height > ROW_HEIGHT * 1.5 ? (
                <Text style={styles.setTime} numberOfLines={1}>
                  {formatTime(s.startTime)}
                </Text>
              ) : null}
              {conflict ? (
                <Ionicons name="warning" size={t.iconSize.xs} color={t.colors.accent.coral} style={styles.conflictIcon} />
              ) : null}
            </TouchableOpacity>
          );
        })}

        {/* NOW line across this stage column */}
        {nowIndicator !== null ? (
          <View
            style={[
              styles.nowLine,
              {
                top: (nowIndicator / 100) * totalHeight,
                backgroundColor: t.colors.accent.coral,
              },
            ]}
            pointerEvents="none"
          >
            <View
              style={[
                styles.nowDot,
                {
                  backgroundColor: t.colors.accent.coral,
                  borderColor: t.colors.bg.primary,
                },
              ]}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * Touch-adapted timeline: a horizontally-paged carousel of stage columns, each
 * a vertical 15-min slotted timeline (mirroring the web grid's information per
 * stage). A coral NOW line tracks the current minute; the floating NOW button
 * scrolls the centered stage's timeline to it.
 */
export default function TimelineView({
  visibleStages,
  timedSets,
  timeBounds,
  selectedDay,
  conflictIds,
  b2bSeparator,
  getMyPick,
  getStageColor,
  onSetPress,
  days,
  allSets,
  picks,
}: TimelineViewProps) {
  const t = useTokens();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const { nowIndicator, scrollRef, scrollToNow } = useNowIndicator(timeBounds, selectedDay, ROW_HEIGHT);
  const reduceMotion = useReduceMotion();

  // --- Live mode ----------------------------------------------------------
  // 60s device-clock tick drives the "up next" countdown + the auto-scroll.
  // Offline-native: only cached sets + the local clock, never the network.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    // iOS suspends JS timers while backgrounded, so the tick stops and the
    // countdown/auto-scroll go stale. Snap to the real clock the moment the app
    // returns to the foreground, alongside the interval.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNowMs(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  // Next picked set across all days, via the SHARED getSetTimeBounds (TZ-safe,
  // post-midnight rollover) — never a local parseSetMs.
  const nextPick = useMemo(() => {
    if (!picks || !allSets || !days) return null;
    // getSetTimeBounds indexes days[dayIndex]?.date — only `.date` is read, so
    // the screen's lightweight `{ date }[]` is structurally sufficient. The cast
    // satisfies the FestivalDay[] param without dragging the full record through.
    const dayRecords = days as unknown as FestivalDay[];
    let best: { set: FestivalSet; startMs: number } | null = null;
    for (const s of allSets) {
      if (!picks[s.id]) continue;
      const bounds = getSetTimeBounds(s, dayRecords);
      if (!bounds || bounds.startMs <= nowMs) continue;
      if (!best || bounds.startMs < best.startMs) best = { set: s, startMs: bounds.startMs };
    }
    return best;
  }, [picks, allSets, days, nowMs]);

  const nextPickLabel = useMemo(() => {
    if (!nextPick) return null;
    const totalMin = Math.max(0, Math.round((nextPick.startMs - nowMs) / 60_000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const eta = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
    return { eta, name: artistDisplayName(nextPick.set, b2bSeparator) };
  }, [nextPick, nowMs, b2bSeparator]);

  // Don't fight active user scrolling: any drag arms the flag for 8s, during
  // which the tick-driven auto-scroll holds off.
  const recentlyScrolledRef = useRef(false);
  const scrollArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleUserScroll = useCallback(() => {
    recentlyScrolledRef.current = true;
    if (scrollArmTimerRef.current) clearTimeout(scrollArmTimerRef.current);
    scrollArmTimerRef.current = setTimeout(() => {
      recentlyScrolledRef.current = false;
    }, 8_000);
  }, []);
  useEffect(
    () => () => {
      if (scrollArmTimerRef.current) clearTimeout(scrollArmTimerRef.current);
    },
    [],
  );

  // Auto-scroll to now on each tick, unless the user is actively scrolling.
  useEffect(() => {
    if (nowIndicator === null || recentlyScrolledRef.current) return;
    const id = requestAnimationFrame(() => {
      if (!recentlyScrolledRef.current) scrollToNow();
    });
    return () => cancelAnimationFrame(id);
  }, [nowMs, nowIndicator, scrollToNow]);

  // Single-column-per-page on phones; a touch of peek so swipe is discoverable.
  const columnWidth = useMemo(() => Math.min(width - 24, 360), [width]);
  const pageStride = columnWidth + 8;

  // Which stage page is centered, for the position indicator + dot jumps. The
  // carousel reports scroll; we round to the nearest snapped page.
  const carouselRef = useRef<FlatList<Stage>>(null);
  const [activePage, setActivePage] = useState(0);
  const handleCarouselScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const page = Math.round(e.nativeEvent.contentOffset.x / pageStride);
      setActivePage((prev) => (prev === page ? prev : page));
    },
    [pageStride],
  );
  const jumpToStage = useCallback(
    (index: number) => {
      carouselRef.current?.scrollToOffset({ offset: index * pageStride, animated: !reduceMotion });
      setActivePage(index);
    },
    [pageStride, reduceMotion],
  );

  // --- Active-page scroll target ------------------------------------------
  // The Now FAB + the 60s auto-scroll drive ONE shared scrollRef (from
  // useNowIndicator). Keep it pointed at whichever stage column is currently
  // centered — NOT a fixed column 0. After the first swipe column 0 is
  // off-screen, so the old fixed binding left both the FAB and the tick dead
  // while the coral NOW line still rendered on the visible column. Each column
  // registers its vertical ScrollView here; we re-aim scrollRef on page change
  // and again whenever the active column (re)mounts under FlatList windowing.
  const columnRefs = useRef<Map<number, ScrollView | null>>(new Map());
  const activePageRef = useRef(activePage);
  useEffect(() => {
    activePageRef.current = activePage;
    scrollRef.current = columnRefs.current.get(activePage) ?? null;
  }, [activePage, scrollRef]);
  const registerColumnRef = useCallback(
    (index: number, node: ScrollView | null) => {
      if (node) columnRefs.current.set(index, node);
      else columnRefs.current.delete(index);
      if (index === activePageRef.current) scrollRef.current = node;
    },
    [scrollRef],
  );

  // Stage ids with a set on stage RIGHT NOW (for the live dot in the indicator).
  // Derived from the existing now-line position (nowIndicator %) mapped back to
  // an absolute minute, so it agrees exactly with the coral NOW line per column.
  const liveStageIds = useMemo(() => {
    const ids = new Set<string>();
    if (nowIndicator === null || !timeBounds) return ids;
    const nowMin = timeBounds.minMin + (nowIndicator / 100) * (timeBounds.maxMin - timeBounds.minMin);
    for (const s of timedSets) {
      const start = timeToMinutes(s.startTime);
      let end = timeToMinutes(s.endTime);
      if (end <= start) end += 24 * 60;
      if (start <= nowMin && nowMin < end) ids.add(s.stageId);
    }
    return ids;
  }, [nowIndicator, timeBounds, timedSets]);

  const setsByStage = useMemo(() => {
    const m = new Map<string, FestivalSet[]>();
    for (const s of timedSets) {
      const arr = m.get(s.stageId) || [];
      arr.push(s);
      m.set(s.stageId, arr);
    }
    return m;
  }, [timedSets]);

  const renderStage = useCallback<ListRenderItem<Stage>>(
    ({ item, index }) => (
      <StageColumn
        stage={item}
        sets={setsByStage.get(item.id) || []}
        timeBounds={timeBounds!}
        stageColor={safeStageColor(getStageColor(item.id), t.colors.text.muted)}
        nowIndicator={nowIndicator}
        conflictIds={conflictIds}
        b2bSeparator={b2bSeparator}
        getMyPick={getMyPick}
        onSetPress={onSetPress}
        columnWidth={columnWidth}
        // Every column registers its ScrollView; the shared now-scroll target is
        // kept pointed at the centered page (see registerColumnRef) so the Now
        // FAB + 60s auto-scroll always drive the visible stage. Any column's drag
        // arms the "user is scrolling" guard so the tick won't fight it.
        registerScrollRef={(node) => registerColumnRef(index, node)}
        onUserScroll={handleUserScroll}
      />
    ),
    [
      setsByStage,
      timeBounds,
      getStageColor,
      nowIndicator,
      conflictIds,
      b2bSeparator,
      getMyPick,
      onSetPress,
      columnWidth,
      registerColumnRef,
      handleUserScroll,
      t.colors.text.muted,
    ],
  );

  const keyExtractor = useCallback((s: Stage) => s.id, []);

  if (!timeBounds) return null;

  return (
    <View style={styles.root}>
      {/* Only meaningful with >1 stage — a single-stage festival can't swipe. */}
      {visibleStages.length > 1 ? (
        <View style={styles.hintRow}>
          <Ionicons name="swap-horizontal" size={12} color={t.colors.text.muted} />
          <Text style={styles.hintText}>Swipe to change stage</Text>
        </View>
      ) : null}

      {nextPickLabel ? (
        <View
          style={styles.countdownRow}
          accessibilityRole="text"
          accessibilityLabel={`Up next in ${nextPickLabel.eta}: ${nextPickLabel.name}`}
        >
          <Ionicons name="musical-notes" size={12} color={t.colors.accent.coral} />
          <Text style={styles.countdownText} numberOfLines={1}>
            Up next in <Text style={styles.countdownEta}>{nextPickLabel.eta}</Text> ·{' '}
            <Text style={styles.countdownName}>{nextPickLabel.name}</Text>
          </Text>
        </View>
      ) : null}

      <FlatList
        ref={carouselRef}
        data={visibleStages}
        renderItem={renderStage}
        keyExtractor={keyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={pageStride}
        decelerationRate="fast"
        onScroll={handleCarouselScroll}
        scrollEventThrottle={32}
        // flex:1 binds the carousel (and thus each stage column's flex:1 height)
        // to the parent's available height. Without it the list sizes to its
        // tall content and overflows the frame, which both breaks the per-column
        // vertical scroll and lets content paint over the tab bar.
        style={styles.carouselList}
        contentContainerStyle={styles.carousel}
      />

      {/* Stage position indicator. With ≤8 stages each gets a tappable dot
          (filled aqua = current page, coral = a set is live on that stage,
          tap to jump); beyond that a compact "i / N" label avoids a dot row
          that would itself need to scroll. */}
      {visibleStages.length > 1 ? (
        visibleStages.length <= 8 ? (
          <View style={styles.dotsRow} accessibilityRole="tablist" accessibilityLabel="Stages">
            {visibleStages.map((st, i) => {
              const active = i === activePage;
              const live = liveStageIds.has(st.id);
              return (
                <TouchableOpacity
                  key={st.id}
                  onPress={() => jumpToStage(i)}
                  hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${st.name}${live ? ', live now' : ''}`}
                >
                  <View
                    style={[
                      styles.dot,
                      active && styles.dotActive,
                      live && { backgroundColor: t.colors.accent.coral },
                      active && live && { backgroundColor: t.colors.accent.coral },
                    ]}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={styles.dotsRow} accessibilityRole="text" accessibilityLabel={`Stage ${activePage + 1} of ${visibleStages.length}`}>
            <Text style={styles.pageLabel}>
              {activePage + 1} / {visibleStages.length}
            </Text>
          </View>
        )
      ) : null}

      {nowIndicator !== null ? (
        <TouchableOpacity
          // DC19 — aqua per the accent rule (coral is reserved for danger/SOS);
          // jumping to now is a primary navigation action. Dark ink on the aqua
          // fill keeps AA contrast (text.onLightAccent).
          style={[styles.fab, { backgroundColor: t.colors.accent.aqua }]}
          onPress={scrollToNow}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Scroll to current time"
        >
          <Ionicons name="musical-notes" size={16} color={t.colors.text.onLightAccent} />
          <Text style={styles.fabText}>Now</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: {
    flex: 1,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[2],
  },
  hintText: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    paddingBottom: t.spacing[2],
    paddingHorizontal: t.spacing[3],
  },
  countdownText: {
    ...typeStyle('micro'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  // Re-spread at the heavier weight so the proper font cut loads (a bare
  // fontWeight over the weighted base family fake-bolds and clips on Android).
  countdownEta: {
    ...typeStyle('micro', 700),
    color: t.colors.accent.coral,
  },
  countdownName: {
    ...typeStyle('micro', 600),
    color: t.colors.text.primary,
  },
  carouselList: {
    flex: 1,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[2],
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.border.light,
  },
  dotActive: {
    backgroundColor: t.colors.accent.aqua,
    // A touch wider so the current page reads clearly even at a glance.
    width: 18,
  },
  pageLabel: {
    ...typeStyle('micro', 600),
    color: t.colors.text.muted,
  },
  carousel: {
    paddingHorizontal: t.spacing[3],
    gap: t.spacing[2],
  },
  stageColumn: {
    flex: 1,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.secondary,
    overflow: 'hidden',
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    height: STAGE_HEADER_H,
    paddingHorizontal: t.spacing[3],
    borderBottomWidth: 3,
    backgroundColor: t.colors.bg.sticky,
  },
  stageDot: {
    width: 8,
    height: 8,
    borderRadius: t.radii.pill,
  },
  stageHeaderText: {
    ...typeStyle('label'),
    flexShrink: 1,
  },
  columnScroll: {
    flex: 1,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    paddingLeft: t.spacing[1],
  },
  timeLabel: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
    width: GUTTER_W,
  },
  setBlock: {
    position: 'absolute',
    borderRadius: t.radii.sm,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderLeftWidth: 3,
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    overflow: 'hidden',
  },
  setArtist: {
    ...typeStyle('micro', 600),
    color: t.colors.text.primary,
  },
  setTime: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  conflictIcon: {
    position: 'absolute',
    top: 2,
    right: 2,
  },
  nowLine: {
    position: 'absolute',
    left: GUTTER_W,
    right: 0,
    height: 2,
    zIndex: 8,
  },
  nowDot: {
    position: 'absolute',
    left: -5,
    top: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  fab: {
    position: 'absolute',
    right: t.spacing[4],
    bottom: t.spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.pill,
    minHeight: 44,
  },
  fabText: {
    ...typeStyle('label', 700),
    color: t.colors.text.onLightAccent,
  },
}));
