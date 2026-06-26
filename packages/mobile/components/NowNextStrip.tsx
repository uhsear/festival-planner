import { useEffect, useRef } from 'react';
import { AccessibilityInfo, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { artistDisplayName, fmtClock, fmtCountdown } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useNowNext } from '../hooks/useNowNext';
import LiveDot from './LiveDot';

interface NowNextStripProps {
  /** Opens the full Now & Next surface (festival-mode screen). */
  onPress: () => void;
}

/**
 * P1-2 — compact, live-day "Now & Next" surface that brings the festival-mode
 * data out of the dedicated screen and onto the schedule. Shows the picked set
 * playing NOW (or the soonest UP NEXT pick + countdown) and taps through to the
 * full Now & Next view. Renders nothing when there's no current/upcoming pick,
 * so it stays out of the way pre-festival. Driven by the shared useNowNext hook
 * (same source as festival-mode + the Android ongoing notification).
 *
 * Walk time to the next set/meeting point is intentionally NOT shown here: it
 * needs a live device fix the schedule screen doesn't request — surfaced instead
 * via "Find each other" (compass/ETA). The "if available" walk-time hook stays
 * deferred to that GPS-aware flow.
 */
export default function NowNextStrip({ onPress }: NowNextStripProps) {
  const t = useTokens();
  const styles = useStyles();
  const { getStageName } = useFestival();
  const b2bSeparator = useFestivalDataStore((s) => s.currentFestival?.b2bSeparator);
  const { now, current, upcoming } = useNowNext(1);

  // DC26: announce "Now playing: <artist> at <stage>" exactly once when a
  // picked set transitions into current. Track the previous leading set id so
  // only a genuine up-next→now transition fires the announcement (not every
  // 60s re-render while the set is already current).
  const prevCurrentIdRef = useRef<string | null>(null);
  useEffect(() => {
    const leadingId = current[0]?.set.id ?? null;
    if (leadingId !== null && leadingId !== prevCurrentIdRef.current) {
      const set = current[0]!.set;
      const artist = artistDisplayName(set, b2bSeparator) || 'Your set';
      const stage = getStageName(set.stageId);
      const announcement = stage ? `Now playing: ${artist} at ${stage}` : `Now playing: ${artist}`;
      AccessibilityInfo.announceForAccessibility(announcement);
    }
    prevCurrentIdRef.current = leadingId;
  }, [current, b2bSeparator, getStageName]);

  const nowSet = current[0];
  const nextSet = upcoming[0];
  if (!nowSet && !nextSet) return null;

  const focus = nowSet ?? nextSet!;
  const isNow = !!nowSet;
  const name = artistDisplayName(focus.set, b2bSeparator);
  const stage = getStageName(focus.set.stageId) || '';
  // `upcoming` spans every festival day (not just today), so the soonest pick can
  // be tomorrow or later — a bare minutes countdown ("in 28h 30m") then hides the
  // day boundary. When the next set starts on a LATER calendar day, surface the
  // day + clock ("Tomorrow 14:00" / "Sat 14:00") instead so the wait reads
  // honestly; same-day picks keep the compact live countdown.
  const toMidnightMs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const startDate = new Date(focus.start);
  const dayDiff = isNow ? 0 : Math.round((toMidnightMs(startDate) - toMidnightMs(now)) / 86_400_000);
  const laterDay = dayDiff >= 1;
  const dayLabel = !laterDay
    ? ''
    : dayDiff === 1
      ? 'Tomorrow'
      : startDate.toLocaleDateString(undefined, { weekday: 'short' });
  const timing = isNow
    ? `until ${fmtClock(focus.end)}`
    : laterDay
      ? `${dayLabel} ${fmtClock(focus.start)}`
      : fmtCountdown(Math.round((focus.start - now.getTime()) / 60_000));

  // How far through the currently-playing pick we are (0–1), advancing on the
  // hook's 60s tick. Drives the thin progress rail along the strip's bottom edge
  // — a quiet "this set is in motion" cue that pairs with the coral NOW accent.
  const progressPct = isNow
    ? Math.max(0, Math.min(1, (now.getTime() - focus.start) / Math.max(1, focus.end - focus.start)))
    : 0;

  const a11y = isNow
    ? `Now playing: ${name}${stage ? ` at ${stage}` : ''}, ${timing}, ${Math.round(progressPct * 100)}% through. Open Now & Next.`
    : `Up next: ${name}${stage ? ` at ${stage}` : ''}, ${timing}. Open Now & Next.`;

  return (
    <TouchableOpacity
      testID="now-next-strip"
      style={[styles.strip, isNow && styles.stripNow]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <View style={styles.labelCol}>
        {isNow ? (
          <LiveDot label="NOW" />
        ) : (
          <View style={styles.nextLabelRow}>
            <Ionicons name="play-skip-forward" size={12} color={t.colors.text.secondary} />
            <Text style={styles.nextLabel}>UP NEXT</Text>
          </View>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.artist} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.metaRow}>
          {stage ? (
            <Text style={styles.stage} numberOfLines={1}>
              {stage}
            </Text>
          ) : null}
          <Text style={[styles.timing, isNow && styles.timingNow]}>{timing}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={t.colors.text.muted} />

      {/* Live scrubber along the strip's bottom edge. Static width (no
          animation needed — it re-renders on the hook's tick); clipped to the
          rounded card by the strip's overflow:hidden. */}
      {isNow ? (
        <View style={styles.progressTrack} pointerEvents="none" accessible={false}>
          <View style={[styles.progressFill, { width: `${progressPct * 100}%` }]} />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 56,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    // Clip the absolutely-positioned live scrubber to the rounded card edge.
    overflow: 'hidden',
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: t.colors.shade[3],
  },
  progressFill: {
    height: '100%',
    backgroundColor: t.colors.accent.coral,
  },
  // Currently-playing: coral accent rail (matches festival-mode's nowCard).
  stripNow: {
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  labelCol: {
    minWidth: 64,
  },
  nextLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  nextLabel: {
    ...typeStyle('caption', 700),
    textTransform: 'uppercase',
    color: t.colors.text.secondary,
  },
  info: {
    flex: 1,
    gap: t.spacing[1],
  },
  artist: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  stage: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  timing: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  timingNow: {
    // Re-spread at 700 so the Bold cut loads (bare fontWeight fake-bolds on
    // Android over the weighted base family).
    ...typeStyle('caption', 700),
    color: t.colors.accent.coral,
  },
}));
