import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useCrewStore, useFestivalStore } from '@festie/shared/stores';
import { getSetTimeBounds, artistDisplayName, formatTime } from '@festie/shared/utils';
import type { CrewMeetingPoint, FestivalDay, FestivalSet, Priority, Profile } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import FreshnessChip from '../components/FreshnessChip';
import EmptyState from '../components/EmptyState';

// ── Pure digest assembly (offline-native, zero network) ────────────────────
// Reads ONLY the persisted stores already in memory: crewStore.meetingPoints /
// activeCrew, festivalDataStore.sets / allProfiles / days, and the shared
// getSetTimeBounds. No fetches — the whole screen renders from cache.

const PRIORITY_RANK: Record<Priority, number> = { must: 3, 'want-to-see': 2, maybe: 1 };
const PRIORITY_LABEL: Record<Priority, string> = { must: 'Must', 'want-to-see': 'Want', maybe: 'Maybe' };
const HOW_MANY_SLOTS = 3;

/** The soonest still-active meeting point with a future-or-now meet time. */
function pickActiveMeetingPoint(points: CrewMeetingPoint[], nowMs: number): CrewMeetingPoint | null {
  const future = points
    .filter((p) => p.active && p.meet_at)
    .map((p) => ({ p, ms: new Date(p.meet_at as string).getTime() }))
    .filter(({ ms }) => Number.isFinite(ms) && ms >= nowMs)
    .sort((a, b) => a.ms - b.ms);
  if (future.length > 0) return future[0]!.p;
  const untimed = points.filter((p) => p.active && !p.meet_at);
  return untimed[0] ?? null;
}

interface SlotPick {
  memberId: string;
  memberName: string;
  set: FestivalSet;
  priority: Priority;
}

interface Slot {
  startMs: number;
  startTime: string;
  picks: SlotPick[];
}

/**
 * Group future sets into the next `HOW_MANY_SLOTS` start-time slots and, for
 * each crew member, surface their single highest-priority pick in that slot.
 */
function buildSlots(sets: FestivalSet[], days: FestivalDay[], profiles: Profile[], nowMs: number): Slot[] {
  const timed = sets
    .map((set) => ({ set, bounds: getSetTimeBounds(set, days) }))
    .filter((x): x is { set: FestivalSet; bounds: { startMs: number; endMs: number } } => x.bounds != null)
    .filter((x) => x.bounds.endMs > nowMs);

  const startTimes = Array.from(new Set(timed.map((x) => x.bounds.startMs)))
    .sort((a, b) => a - b)
    .slice(0, HOW_MANY_SLOTS);

  return startTimes.map((startMs) => {
    const slotSets = timed.filter((x) => x.bounds.startMs === startMs).map((x) => x.set);
    const slotSetIds = new Set(slotSets.map((s) => s.id));
    const setsById = new Map(slotSets.map((s) => [s.id, s]));

    const picks: SlotPick[] = [];
    for (const profile of profiles) {
      let best: { setId: string; priority: Priority } | null = null;
      for (const [setId, priority] of Object.entries(profile.picks || {})) {
        if (!slotSetIds.has(setId)) continue;
        const p = priority as Priority;
        if (!best || PRIORITY_RANK[p] > PRIORITY_RANK[best.priority]) best = { setId, priority: p };
      }
      if (best) {
        picks.push({
          memberId: profile.id,
          memberName: profile.name || 'Crew member',
          set: setsById.get(best.setId)!,
          priority: best.priority,
        });
      }
    }
    picks.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);

    const sampleStart = slotSets[0]?.startTime ?? '';
    return { startMs, startTime: sampleStart, picks };
  });
}

export default function CrewPlanScreen() {
  const t = useTokens();
  const styles = useStyles();
  const bottomPad = useListBottomInset({ base: t.spacing[4] });

  const user = useAuthStore((s) => s.user);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const sets = useFestivalStore((s) => s.sets) as FestivalSet[];
  const days = useFestivalStore((s) => s.days) as FestivalDay[];
  const allProfiles = useFestivalStore((s) => s.allProfiles) as Profile[];

  const crewProfiles = useMemo(() => {
    const memberIds = new Set([
      ...crewMembers.map((m) => m.userId),
      ...(activeCrew?.members ?? []).map((m) => m.userId),
    ]);
    return allProfiles.filter((p) => memberIds.has(p.userId));
  }, [crewMembers, activeCrew, allProfiles]);

  const nowMs = Date.now();
  const meetingPoint = useMemo(() => pickActiveMeetingPoint(meetingPoints, nowMs), [meetingPoints, nowMs]);
  const slots = useMemo(() => buildSlots(sets, days, crewProfiles, nowMs), [sets, days, crewProfiles, nowMs]);
  const slotsWithPicks = slots.filter((s) => s.picks.length > 0);

  if (!user) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Crew plan', headerShown: true }} />
        <EmptyState icon="lock-closed" title="Sign in required" message="Log in to see your crew's plan." />
      </View>
    );
  }

  if (!activeCrew) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Crew plan', headerShown: true }} />
        <EmptyState
          icon="people-outline"
          title="No crew selected"
          message="Open the Crew tab and pick a crew to see its plan."
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `${activeCrew.name}'s plan`, headerShown: true }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
        <FreshnessChip surface="crew" />

        {/* Active meeting point */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="location" size={18} color={t.colors.accent.coral} />
            <Text style={styles.cardTitle}>Meet up</Text>
          </View>
          {meetingPoint ? (
            <View style={styles.cardBody}>
              <Text style={styles.primaryLine}>{meetingPoint.label}</Text>
              <Text style={styles.secondaryLine}>{meetingPoint.location}</Text>
              {meetingPoint.meet_at ? (
                <Text style={styles.accentLine}>
                  {new Date(meetingPoint.meet_at).toLocaleString([], {
                    weekday: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.emptyLine}>No active meeting point set.</Text>
          )}
        </View>

        {/* Crew home base */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="home" size={18} color={t.colors.accent.aqua} />
            <Text style={styles.cardTitle}>Home base</Text>
          </View>
          {activeCrew.homeBaseLocation || activeCrew.homeBaseTime ? (
            <View style={styles.cardBody}>
              {activeCrew.homeBaseLocation ? (
                <Text style={styles.primaryLine}>{activeCrew.homeBaseLocation}</Text>
              ) : null}
              {activeCrew.homeBaseTime ? <Text style={styles.secondaryLine}>{activeCrew.homeBaseTime}</Text> : null}
            </View>
          ) : (
            <Text style={styles.emptyLine}>No home base set.</Text>
          )}
        </View>

        {/* Who's seeing what next */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="time" size={18} color={t.colors.accent.amber} />
            <Text style={styles.cardTitle}>Up next</Text>
          </View>
          {slotsWithPicks.length === 0 ? (
            <Text style={styles.emptyLine}>No upcoming crew picks. Add sets to your schedule to fill this in.</Text>
          ) : (
            <View style={styles.slotList}>
              {slotsWithPicks.map((slot) => (
                <View key={slot.startMs} style={styles.slot}>
                  <Text style={styles.slotTime}>{slot.startTime ? formatTime(slot.startTime) : 'Soon'}</Text>
                  {slot.picks.map((p) => (
                    <View key={p.memberId} style={styles.pickRow}>
                      <View style={styles.priorityBadge}>
                        <Text style={styles.priorityText}>{PRIORITY_LABEL[p.priority]}</Text>
                      </View>
                      <Text style={styles.pickMember} numberOfLines={1}>
                        {p.memberName}
                      </Text>
                      <Ionicons name="arrow-forward" size={12} color={t.colors.text.secondary} />
                      <Text style={styles.pickSet} numberOfLines={1}>
                        {artistDisplayName(p.set)}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  content: {
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  card: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    padding: t.spacing[4],
    gap: t.spacing[2],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  cardTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  cardBody: {
    gap: t.spacing[1],
  },
  primaryLine: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  secondaryLine: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  accentLine: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  emptyLine: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  slotList: {
    gap: t.spacing[3],
  },
  slot: {
    gap: t.spacing[2],
  },
  slotTime: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  priorityBadge: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.amberAlpha[12],
  },
  priorityText: {
    ...typeStyle('caption', 700),
    // Self-consistent amber badge: dark ink on the amber fill (text.onLightAccent
    // #080810 passes AA on #ffb020). Was coral text on an amber fill, which both
    // mixed accents and read poorly.
    color: t.colors.text.onLightAccent,
  },
  pickMember: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  pickSet: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
}));
