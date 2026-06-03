import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { artistDisplayName, getSetTimeBounds } from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import EmptyState from '../components/EmptyState';
import LiveDot from '../components/LiveDot';

// Countdown flips to coral when a set is <= this many minutes away.
const IMMINENT_MIN = 5;

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtCountdown(mins: number): string {
  if (mins < 1) return 'starting now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

interface TimedSet {
  set: FestivalSet;
  start: number;
  end: number;
  priority: Priority;
}

/**
 * Festival mode — the live "now / up next" view, a mobile mirror of the web
 * /festival-mode route. Filters the user's picked sets by wall-clock time into
 * what's playing now and the next five upcoming, refreshed on a 60s tick.
 */
export default function FestivalModeScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const sets = useFestivalDataStore((s) => s.sets) as FestivalSet[];
  const days = useFestivalDataStore((s) => s.days);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const { getStageName } = useFestival();

  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const picks = currentProfile?.picks;

  const { current, upcoming } = useMemo(() => {
    if (!picks || !sets.length || !days.length) {
      return { current: [] as TimedSet[], upcoming: [] as TimedSet[] };
    }
    const nowMs = now.getTime();
    const timed: TimedSet[] = [];
    for (const s of sets) {
      const priority = picks[s.id];
      if (!priority) continue;
      // Shared TZ-safe bounds (incl. post-midnight rollover); null = TBA.
      const bounds = getSetTimeBounds(s, days);
      if (!bounds) continue;
      timed.push({ set: s, start: bounds.startMs, end: bounds.endMs, priority });
    }
    return {
      current: timed.filter((x) => x.start <= nowMs && x.end > nowMs),
      upcoming: timed
        .filter((x) => x.start > nowMs)
        .sort((a, b) => a.start - b.start)
        .slice(0, 5),
    };
  }, [picks, sets, days, now]);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Festival Mode', headerShown: true }} />
      {!currentFestival ? (
        <EmptyState
          icon="calendar-outline"
          title="No festival loaded"
          message="Pick a festival to see what's playing now and next."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.headerRow}>
            <Text style={styles.festivalName} numberOfLines={1}>
              {currentFestival.name}
            </Text>
            <Text style={styles.clock}>{fmtClock(now)}</Text>
          </View>

          {/* NOW */}
          <View style={styles.sectionHead}>
            <LiveDot label="NOW" />
          </View>
          {current.length > 0 ? (
            current.map(({ set: s, end }) => {
              const stageName = getStageName(s.stageId) || '';
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.card, styles.nowCard]}
                  onPress={() => router.push(`/set/${s.id}`)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`${artistDisplayName(s, currentFestival.b2bSeparator)} playing now, open details`}
                >
                  <Text style={styles.artist}>{artistDisplayName(s, currentFestival.b2bSeparator)}</Text>
                  {stageName ? <Text style={styles.stage}>{stageName}</Text> : null}
                  <Text style={styles.untilText}>until {fmtClock(new Date(end))}</Text>
                </TouchableOpacity>
              );
            })
          ) : (
            <Text style={styles.empty}>Nothing playing right now — your next set will show up below.</Text>
          )}

          {/* UP NEXT */}
          <View style={styles.sectionHead}>
            <Ionicons name="play-skip-forward" size={14} color={t.colors.text.secondary} />
            <Text style={styles.sectionLabel}>UP NEXT</Text>
          </View>
          {upcoming.length > 0 ? (
            upcoming.map(({ set: s, start }) => {
              const stageName = getStageName(s.stageId) || '';
              const mins = Math.round((start - now.getTime()) / 60_000);
              const imminent = mins <= IMMINENT_MIN;
              return (
                <TouchableOpacity
                  key={s.id}
                  style={styles.card}
                  onPress={() => router.push(`/set/${s.id}`)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`${artistDisplayName(s, currentFestival.b2bSeparator)} ${fmtCountdown(mins)}, open details`}
                >
                  <Text style={styles.artist}>{artistDisplayName(s, currentFestival.b2bSeparator)}</Text>
                  <View style={styles.nextMeta}>
                    {stageName ? <Text style={styles.stage}>{stageName}</Text> : null}
                    <Text style={styles.startText}>{fmtClock(new Date(start))}</Text>
                    <Text style={[styles.countdown, imminent && styles.countdownImminent]}>{fmtCountdown(mins)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <Text style={styles.empty}>
              {picks && Object.keys(picks).length === 0
                ? 'No picks yet — browse the lineup and pick your must-see sets.'
                : "No more picks coming up — you've seen everything on your list."}
            </Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  content: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
    gap: t.spacing[2],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: t.spacing[3],
  },
  festivalName: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    flex: 1,
  },
  clock: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    marginTop: t.spacing[3],
    marginBottom: t.spacing[1],
  },
  sectionLabel: {
    ...typeStyle('caption'),
    fontWeight: '700',
    textTransform: 'uppercase',
    color: t.colors.text.secondary,
  },
  card: {
    paddingVertical: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    gap: t.spacing[1],
  },
  nowCard: {
    borderLeftWidth: 3,
    borderLeftColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  artist: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  stage: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  untilText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
    fontWeight: '600',
  },
  nextMeta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  startText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  countdown: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
    fontWeight: '600',
  },
  countdownImminent: {
    color: t.colors.accent.coral,
    fontWeight: '700',
  },
  empty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[2],
  },
}));
