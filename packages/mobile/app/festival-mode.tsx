import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { artistDisplayName, fmtClock, fmtCountdown } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useOngoingNotification } from '../hooks/useOngoingNotification';
import { useNowNext } from '../hooks/useNowNext';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import SectionLabel from '../components/SectionLabel';
import LiveDot from '../components/LiveDot';
import UpdatedAgoBadge from '../components/UpdatedAgoBadge';
import { LowPowerToggle, LowPowerIndicator } from '../components/LowPowerControls';

// Countdown flips to coral when a set is <= this many minutes away.
const IMMINENT_MIN = 5;

/**
 * Now & Next — the live "now / up next" view (a.k.a. festival mode), a mobile
 * mirror of the web /festival-mode route. Splits the user's picked sets by
 * wall-clock time into what's playing now and the next five upcoming, refreshed
 * on a 60s tick (logic shared via useNowNext so the home-screen strip stays in
 * parity). "Live" is reserved for location; this surface is named "Now & Next".
 */
export default function FestivalModeScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const { getStageName } = useFestival();

  // M6: present the Android ongoing (sticky) notification with the current/next
  // set + active meeting point while this festival is active. Android-only;
  // on-device/offline. iOS equivalent (ActivityKit Live Activity) is DEFERRED —
  // a separate native widget-extension spike; see useOngoingNotification docblock.
  // Its own 'ongoing' channel + stable id keep it isolated from set reminders.
  useOngoingNotification();

  const picks = currentProfile?.picks;
  const { now, current, upcoming } = useNowNext(5);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Now & Next', headerShown: true }} />
      {!currentFestival ? (
        <EmptyState
          icon="calendar-outline"
          title="No festival loaded"
          message="Pick a festival to see what's playing now and next."
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(t.spacing[4], insets.bottom + t.spacing[2]) },
          ]}
        >
          <View style={styles.headerRow}>
            <Text style={styles.festivalName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {currentFestival.name}
            </Text>
            <Text style={styles.clock}>{fmtClock(now.getTime())}</Text>
          </View>

          {/* Offline-honest freshness for the live schedule surface, plus the
              low-power status chip so the user knows when polling is backed off. */}
          <View style={styles.metaRow}>
            <UpdatedAgoBadge surface="schedule" />
            <LowPowerIndicator />
          </View>

          {/* Festival low-power mode — pauses the battery-hungry features so the
              phone lasts the whole day. Persisted via the shared store flag. */}
          <LowPowerToggle />

          {/* NOW. R8's radial-glow approximation (two concentric flat circles —
              no expo-linear-gradient) rendered as hard-edged smudges on device,
              not a glow; removed. The web keeps the real CSS radial. */}
          <View style={glowStyles.nowGlowWrap}>
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
                    <Text style={styles.untilText}>until {fmtClock(end)}</Text>
                  </TouchableOpacity>
                );
              })
            ) : (
              <Text style={styles.empty}>Nothing playing right now — your next set will show up below.</Text>
            )}
          </View>

          {/* UP NEXT — extra top margin keeps NOW and UP NEXT sections balanced */}
          <View style={[styles.sectionHead, styles.upNextHead]}>
            <Ionicons name="play-skip-forward" size={14} color={t.colors.text.secondary} />
            <SectionLabel style={styles.sectionHeadLabel}>Up next</SectionLabel>
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
                    <Text style={styles.startText}>{fmtClock(start)}</Text>
                    <Text style={[styles.countdown, imminent && styles.countdownImminent]}>{fmtCountdown(mins)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <View style={styles.upNextEmpty}>
              <Ionicons
                name="musical-notes-outline"
                size={40}
                style={styles.upNextEmptyIcon}
                accessibilityElementsHidden
              />
              <Text style={styles.upNextEmptyTitle}>
                {picks && Object.keys(picks).length === 0 ? 'No picks yet' : 'All caught up'}
              </Text>
              <Text style={styles.upNextEmptyMessage}>
                {picks && Object.keys(picks).length === 0
                  ? 'Browse the lineup and pick your must-see sets.'
                  : "You've seen everything on your list."}
              </Text>
              {picks && Object.keys(picks).length === 0 ? (
                <Button
                  label="Browse lineup"
                  onPress={() => router.push('/schedule')}
                  style={styles.upNextEmptyAction}
                />
              ) : null}
            </View>
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
    marginBottom: t.spacing[2],
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
  // Clears SectionLabel's default bottom margin so it sits centered in the row.
  sectionHeadLabel: {
    marginBottom: 0,
  },
  // Extra top spacing above the UP NEXT section so NOW and UP NEXT feel balanced.
  upNextHead: {
    marginTop: t.spacing[4],
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
    borderLeftColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
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
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
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
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  countdownImminent: {
    // Re-spread at 700 so the Bold font cut loads — a bare fontWeight layered
    // on the weighted base family fake-bolds and clips on Android.
    ...typeStyle('caption', 700),
    color: t.colors.accent.coral,
  },
  empty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[2],
  },
  upNextEmpty: {
    alignItems: 'center',
    gap: t.spacing[3],
    paddingVertical: t.spacing[8],
    paddingHorizontal: t.spacing[6],
  },
  upNextEmptyIcon: {
    color: t.colors.accent.aqua,
  },
  upNextEmptyTitle: {
    ...typeStyle('title', 600),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  upNextEmptyMessage: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
    maxWidth: 260,
  },
  // CTA layout only — fill/ink/radius live in components/Button (F8).
  upNextEmptyAction: {
    paddingHorizontal: t.spacing[6],
    marginTop: t.spacing[2],
  },
}));

// Wrapper for the NOW section (kept for layout rhythm; the former R8 flat-circle
// "glow" layers were removed — they rendered as hard-edged smudges on device).
const glowStyles = StyleSheet.create({
  nowGlowWrap: {
    position: 'relative',
    borderRadius: 12,
    marginBottom: 8,
  },
});
