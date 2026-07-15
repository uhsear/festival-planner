import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useCrewStore, useFestivalStore } from '@festie/shared/stores';
import { artistDisplayName, formatTime, pickActiveMeetingPoint, buildSlots } from '@festie/shared/utils';
import { PRIORITY_LABEL } from '@festie/shared/constants';
import type { FestivalDay, FestivalSet, Profile } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle, iconSize, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { useNow } from '../hooks/useNow';
import FreshnessChip from '../components/FreshnessChip';
import EmptyState from '../components/EmptyState';

// ── Pure digest assembly (offline-native, zero network) ────────────────────
// Reads ONLY the persisted stores already in memory: crewStore.meetingPoints /
// activeCrew, festivalDataStore.sets / allProfiles / days, and the shared
// getSetTimeBounds. No fetches — the whole screen renders from cache.

// Pure digest assembly (pickActiveMeetingPoint + buildSlots) lives in
// @festie/shared/utils so web + mobile share one implementation.

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

  const nowMs = useNow();
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
            {/* Aqua, not coral: "Meet up" is a neutral location/navigation
                feature. Coral is reserved for danger/SOS only (one-accent rule);
                the live map's equivalent meeting-point pin is neutral, so a coral
                icon here was an inconsistent accent misuse. */}
            <Ionicons name="location" size={iconSize.action} color={t.colors.accent.aqua} />
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
            <Ionicons name="home" size={iconSize.action} color={t.colors.accent.aqua} />
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
            <Ionicons name="time" size={iconSize.action} color={t.colors.accent.amber} />
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
                        <Text style={styles.priorityText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                          {PRIORITY_LABEL[p.priority]}
                        </Text>
                      </View>
                      <Text style={styles.pickMember} numberOfLines={1}>
                        {p.memberName}
                      </Text>
                      <Ionicons name="arrow-forward" size={iconSize.xs} color={t.colors.text.secondary} />
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
    paddingVertical: t.spacing[1],
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
