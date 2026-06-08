import { useEffect, useMemo } from 'react';
import { View, Text, ScrollView, FlatList, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useAuthStore, useCrewStore, useFestivalStore } from '@festie/shared/stores';
import { useCrew, useFestival } from '@festie/shared/hooks';
import { artistDisplayName, formatTime } from '@festie/shared/utils';
import type { FestivalSet, Priority, Profile } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { safeStageColor } from '../lib/stageColor';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';

const ROW_HEADER_W = 168;
const CELL_W = 76;

const PRIORITY_LABEL: Record<Priority, string> = {
  must: 'Must',
  'want-to-see': 'Want',
  maybe: 'Maybe',
};

function byStartTime(a: FestivalSet, b: FestivalSet): number {
  const ta = a.startTime || '';
  const tb = b.startTime || '';
  if (ta && tb) return ta.localeCompare(tb);
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  return 0;
}

type Column = { id: string; name: string; isMe: boolean; avatarName?: string };

export default function CrewCompareScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const user = useAuthStore((s) => s.user);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewLoading = useCrewStore((s) => s.crewLoading);
  const error = useCrewStore((s) => s.error);
  const loadOverlap = useCrewStore((s) => s.loadOverlap);

  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const sets = useFestivalStore((s) => s.sets) as FestivalSet[];
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);

  const { getCrewScopedProfiles } = useCrew();
  const { getDays, getStageColor } = useFestival();

  // Refresh crew overlap once on mount (drives the "going" count + keeps the
  // crew picks fresh). The grid itself is derived from picks, not this call.
  useEffect(() => {
    const festivalId = activeCrew?.festivalId ?? currentFestival?.id;
    if (activeCrew?.id && festivalId) {
      loadOverlap(activeCrew.id, festivalId).catch(() => {});
    }
  }, [activeCrew?.id, activeCrew?.festivalId, currentFestival?.id, loadOverlap]);

  const days = useMemo(() => getDays(), [getDays]);

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const p of getCrewScopedProfiles()) map.set(p.id, p);
    if (currentProfile) map.set(currentProfile.id, currentProfile);
    return map;
  }, [getCrewScopedProfiles, currentProfile]);

  // Columns: you first, then the rest of the crew.
  const columns = useMemo<Column[]>(() => {
    const profiles = getCrewScopedProfiles();
    const others = profiles.filter((p) => p.id !== currentProfile?.id);
    const cols: Column[] = [];
    if (currentProfile) {
      cols.push({ id: currentProfile.id, name: 'You', isMe: true, avatarName: currentProfile.name });
    }
    for (const p of others) {
      cols.push({ id: p.id, name: p.name || 'Member', isMe: false, avatarName: p.name });
    }
    return cols;
  }, [getCrewScopedProfiles, currentProfile]);

  // Rows: this day's sets that at least one crew member picked, time-sorted.
  const rows = useMemo<FestivalSet[]>(() => {
    return sets
      .filter((s) => s.dayIndex === selectedDay)
      .filter((s) => columns.some((c) => profileById.get(c.id)?.picks?.[s.id]))
      .sort(byStartTime);
  }, [sets, selectedDay, columns, profileById]);

  const pickFor = (col: Column, setId: string): Priority | undefined => profileById.get(col.id)?.picks?.[setId];

  if (!user) {
    return (
      <Wrapper>
        <EmptyState icon="lock-closed" title="Sign in required" message="Log in to compare schedules." />
      </Wrapper>
    );
  }
  if (!activeCrew) {
    return (
      <Wrapper>
        <EmptyState icon="people-outline" title="No crew" message="Join or create a crew to compare schedules." />
      </Wrapper>
    );
  }
  if (columns.length <= 1) {
    return (
      <Wrapper>
        {crewLoading ? (
          <LoadingState label="Loading crew picks…" />
        ) : (
          <EmptyState
            icon="git-compare-outline"
            title="No crew picks yet"
            message="Once your crewmates save picks for this festival, their schedules show up here side by side."
          />
        )}
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Day selector */}
      {days.length > 1 ? (
        <View style={styles.daysWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysContent}>
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
                  <Text style={[styles.dayText, active && styles.dayTextActive]} numberOfLines={1}>
                    {day.label ?? day.date}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="No picks on this day yet"
          message="Switch days or have your crew add picks to see the overlap."
        />
      ) : (
        // flex:1 bounds the horizontal ScrollView's height to the screen so the
        // nested vertical FlatList below gets a real viewport (its rows scroll)
        // instead of expanding to full content height with lower rows
        // unreachable. The inner View stretches to that height by default, so
        // the column header stays put while rows scroll under it.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          style={styles.flex1}
          contentContainerStyle={styles.gridScroll}
        >
          <View>
            {/* Column headers */}
            <View style={styles.headerRow}>
              <View style={[styles.rowHeaderCell, styles.cornerCell]}>
                <Text style={styles.cornerText}>Set</Text>
              </View>
              {columns.map((col) => (
                <View key={col.id} style={styles.colHeader}>
                  <Avatar name={col.avatarName} size="xs" />
                  <Text style={styles.colHeaderText} numberOfLines={1}>
                    {col.name}
                  </Text>
                </View>
              ))}
            </View>

            <FlatList
              style={styles.flex1}
              data={rows}
              keyExtractor={(s) => s.id}
              contentContainerStyle={{
                paddingBottom: Math.max(t.spacing[4], insets.bottom + t.spacing[2]),
              }}
              renderItem={({ item: set }) => (
                <View style={styles.gridRow}>
                  <TouchableOpacity
                    style={styles.rowHeaderCell}
                    onPress={() => router.push(`/set/${set.id}`)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${artistDisplayName(set, currentFestival?.b2bSeparator)}`}
                  >
                    <View style={styles.rowHeaderInner}>
                      <View
                        style={[
                          styles.stageDot,
                          { backgroundColor: safeStageColor(getStageColor(set.stageId), t.colors.text.muted) },
                        ]}
                      />
                      <View style={styles.rowHeaderText}>
                        <Text style={styles.setArtist} numberOfLines={1}>
                          {artistDisplayName(set, currentFestival?.b2bSeparator)}
                        </Text>
                        {set.startTime ? <Text style={styles.setTime}>{formatTime(set.startTime)}</Text> : null}
                      </View>
                    </View>
                  </TouchableOpacity>
                  {columns.map((col) => {
                    const p = pickFor(col, set.id);
                    return (
                      <View
                        key={col.id}
                        style={styles.cell}
                        // Preserve the table relation (member × set → pick) for
                        // screen readers; without a label the cell reads as empty.
                        accessibilityLabel={`${col.name}: ${p ? PRIORITY_LABEL[p] : 'no pick'} for ${artistDisplayName(set, currentFestival?.b2bSeparator)}`}
                      >
                        {p ? (
                          <View
                            style={[
                              styles.pill,
                              {
                                backgroundColor:
                                  p === 'must'
                                    ? t.colors.priority.must
                                    : p === 'want-to-see'
                                      ? t.colors.priority.want
                                      : t.colors.priority.maybe,
                              },
                            ]}
                          >
                            <Text style={styles.pillText}>{PRIORITY_LABEL[p]}</Text>
                          </View>
                        ) : (
                          <Text style={styles.dash}>—</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            />
          </View>
        </ScrollView>
      )}
    </Wrapper>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: 'Compare schedules',
          presentation: 'modal',
          headerShown: true,
          headerStyle: { backgroundColor: t.colors.bg.secondary },
          headerTintColor: t.colors.text.primary,
        }}
      />
      {children}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  flex1: {
    flex: 1,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    textAlign: 'center',
    padding: t.spacing[3],
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
  gridScroll: {
    paddingHorizontal: t.spacing[4],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: t.spacing[2],
  },
  cornerCell: {
    justifyContent: 'flex-end',
  },
  cornerText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
  colHeader: {
    width: CELL_W,
    alignItems: 'center',
    gap: t.spacing[1],
  },
  colHeaderText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    maxWidth: CELL_W - 8,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: t.spacing[2],
  },
  rowHeaderCell: {
    width: ROW_HEADER_W,
    paddingRight: t.spacing[3],
  },
  rowHeaderInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  stageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowHeaderText: {
    flex: 1,
    gap: 2,
  },
  setArtist: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  setTime: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  cell: {
    width: CELL_W,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    minWidth: 52,
    alignItems: 'center',
  },
  pillText: {
    ...typeStyle('caption'),
    color: t.colors.text.onLightAccent,
    fontWeight: '700',
  },
  dash: {
    ...typeStyle('body'),
    color: t.colors.text.muted,
  },
}));
