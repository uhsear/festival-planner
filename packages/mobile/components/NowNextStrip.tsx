import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { artistDisplayName } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useNowNext } from '../hooks/useNowNext';
import LiveDot from './LiveDot';

interface NowNextStripProps {
  /** Opens the full Now & Next surface (festival-mode screen). */
  onPress: () => void;
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtCountdown(mins: number): string {
  if (mins < 1) return 'now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
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

  const nowSet = current[0];
  const nextSet = upcoming[0];
  if (!nowSet && !nextSet) return null;

  const focus = nowSet ?? nextSet!;
  const isNow = !!nowSet;
  const name = artistDisplayName(focus.set, b2bSeparator);
  const stage = getStageName(focus.set.stageId) || '';
  const timing = isNow
    ? `until ${fmtClock(focus.end)}`
    : fmtCountdown(Math.round((focus.start - now.getTime()) / 60_000));

  const a11y = isNow
    ? `Now playing: ${name}${stage ? ` at ${stage}` : ''}, ${timing}. Open Now & Next.`
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
  },
  // Currently-playing: coral accent rail (matches festival-mode's nowCard).
  stripNow: {
    borderLeftWidth: 3,
    borderLeftColor: t.colors.accent.coral,
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
    ...typeStyle('caption'),
    fontWeight: '700',
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
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
    fontWeight: '600',
  },
  timingNow: {
    color: t.colors.accent.coral,
    fontWeight: '700',
  },
}));
