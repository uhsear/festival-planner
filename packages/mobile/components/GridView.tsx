import { useCallback, useMemo, type ReactElement } from 'react';
import { View, Text, type ListRenderItem } from 'react-native';
import { FlatList } from 'react-native';
import type { FestivalSet, Priority, Stage } from '@festie/shared/types';
import { timeToMinutes } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import SetCardMobile, { type FriendProfile } from './SetCardMobile';

/** Compare set start times for ascending time order (TBA-less sets last). */
function byStartTime(a: FestivalSet, b: FestivalSet): number {
  const ta = a.startTime || '';
  const tb = b.startTime || '';
  if (ta && tb) return ta.localeCompare(tb);
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  return 0;
}

type GridRow =
  | {
      kind: 'stageHeader';
      key: string;
      stageName: string;
      stageColor: string;
      isNow: boolean;
    }
  | { kind: 'nowDivider'; key: string }
  | { kind: 'set'; key: string; set: FestivalSet };

export interface GridViewProps {
  visibleStages: Stage[];
  timedSets: FestivalSet[];
  /** Now position 0-100 within the day, or null when outside bounds. */
  nowIndicator: number | null;
  conflictIds: Set<string>;
  getMyPick: (setId: string) => Priority | null | undefined;
  /** Optional: returns the user's personal note for a set, for the note indicator. */
  getMyNote?: (setId: string) => string | undefined;
  /**
   * Optional: other crew members who picked a set (M1 crew-overlap). When
   * provided, each grid set card shows the crew avatar cluster, matching the
   * card list. Omit to hide the cluster.
   */
  getOtherPicks?: (setId: string) => FriendProfile[];
  getStageColor: (stageId: string) => string;
  getStageName: (stageId: string) => string | undefined;
  onPickChange: (setId: string, priority: Priority | null) => void;
  onSetPress: (set: FestivalSet) => void;
  /** Optional footer (e.g. the TBA section) rendered below the list. */
  ListFooterComponent?: ReactElement | null;
}

/**
 * Touch-adapted Grid: a single-column, stage-grouped, time-ordered list reusing
 * SetCardMobile for each set. The web Grid's 2D time-matrix is unreadable on a
 * phone, so we preserve its *information* (stage grouping + time order) in the
 * familiar single-scroll mobile layout. A coral "NOW" divider is injected
 * before the first set that starts at or after the current time.
 */
export default function GridView({
  visibleStages,
  timedSets,
  nowIndicator,
  conflictIds,
  getMyPick,
  getMyNote,
  getOtherPicks,
  getStageColor,
  getStageName,
  onPickChange,
  onSetPress,
  ListFooterComponent,
}: GridViewProps) {
  const t = useTokens();
  const styles = useStyles();

  // The current minute-of-day, used to place the NOW divider in the list. We
  // derive it from nowIndicator's presence (within bounds) + the clock so the
  // divider lands on the right set without threading timeBounds through.
  const nowMins = useMemo(() => {
    if (nowIndicator === null) return null;
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }, [nowIndicator]);

  const rows = useMemo<GridRow[]>(() => {
    const byStage = new Map<string, FestivalSet[]>();
    for (const s of timedSets) {
      const arr = byStage.get(s.stageId) || [];
      arr.push(s);
      byStage.set(s.stageId, arr);
    }

    const orderedStageIds = [
      ...visibleStages.map((s) => s.id).filter((id) => byStage.has(id)),
      ...[...byStage.keys()].filter((id) => !visibleStages.some((s) => s.id === id)),
    ];

    const out: GridRow[] = [];
    for (const stageId of orderedStageIds) {
      const stageSets = (byStage.get(stageId) || []).slice().sort(byStartTime);
      if (stageSets.length === 0) continue;

      // Mark this stage header "NOW" if a set is currently playing on it.
      const liveNow =
        nowMins !== null &&
        stageSets.some((s) => {
          if (!s.startTime || !s.endTime) return false;
          const start = timeToMinutes(s.startTime);
          const end = timeToMinutes(s.endTime);
          const adjEnd = end <= start ? end + 24 * 60 : end;
          return nowMins >= start && nowMins < adjEnd;
        });

      out.push({
        kind: 'stageHeader',
        key: `stage-${stageId}`,
        stageName: getStageName(stageId) || 'Unknown stage',
        stageColor: getStageColor(stageId),
        isNow: liveNow,
      });

      let dividerPlaced = false;
      for (const set of stageSets) {
        const start = set.startTime ? timeToMinutes(set.startTime) : null;
        if (!dividerPlaced && nowMins !== null && start !== null && start >= nowMins) {
          out.push({ kind: 'nowDivider', key: `now-${stageId}` });
          dividerPlaced = true;
        }
        out.push({ kind: 'set', key: set.id, set });
      }
    }
    return out;
  }, [timedSets, visibleStages, getStageName, getStageColor, nowMins]);

  const renderRow = useCallback<ListRenderItem<GridRow>>(
    ({ item }) => {
      if (item.kind === 'stageHeader') {
        return (
          <View style={styles.stageHeader}>
            <View style={[styles.stageDot, { backgroundColor: item.stageColor }]} />
            <Text style={styles.stageHeaderText} numberOfLines={1}>
              {item.stageName}
            </Text>
            {item.isNow ? (
              <View style={[styles.nowBadge, { backgroundColor: t.colors.accent.coral }]}>
                <Text style={styles.nowBadgeText}>NOW</Text>
              </View>
            ) : null}
          </View>
        );
      }
      if (item.kind === 'nowDivider') {
        return (
          <View style={styles.nowDividerRow}>
            <View style={[styles.nowDividerLine, { backgroundColor: t.colors.accent.coral }]} />
            <Text style={[styles.nowDividerText, { color: t.colors.accent.coral }]}>NOW</Text>
          </View>
        );
      }
      const set = item.set;
      return (
        <SetCardMobile
          set={set}
          stageName={getStageName(set.stageId) || 'Unknown'}
          stageColor={getStageColor(set.stageId)}
          myPick={getMyPick(set.id)}
          hasConflict={conflictIds.has(set.id)}
          hasNote={!!getMyNote?.(set.id)}
          friendProfiles={getOtherPicks?.(set.id)}
          onPickChange={(p) => onPickChange(set.id, p)}
          onPress={() => onSetPress(set)}
        />
      );
    },
    [
      styles,
      t.colors.accent.coral,
      getStageName,
      getStageColor,
      getMyPick,
      getMyNote,
      getOtherPicks,
      conflictIds,
      onPickChange,
      onSetPress,
    ],
  );

  const keyExtractor = useCallback((item: GridRow) => item.key, []);

  return (
    <FlatList
      data={rows}
      renderItem={renderRow}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListFooterComponent={ListFooterComponent}
      keyboardShouldPersistTaps="handled"
    />
  );
}

const useStyles = makeStyles((t) => ({
  listContent: {
    padding: t.spacing[4],
    paddingTop: t.spacing[2],
    flexGrow: 1,
  },
  separator: {
    height: t.spacing[3],
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
    flexShrink: 1,
  },
  nowBadge: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
  },
  nowBadgeText: {
    ...typeStyle('micro'),
    color: t.colors.text.onAccent,
    fontWeight: '700',
  },
  nowDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[1],
  },
  nowDividerLine: {
    flex: 1,
    height: 2,
    borderRadius: 1,
  },
  nowDividerText: {
    ...typeStyle('micro'),
    fontWeight: '700',
  },
}));
