import { View, Text } from 'react-native';
import type { SetStatus } from '@festie/shared/utils';
import { makeStyles, typeStyle } from '../hooks/useTokens';

interface LiveBadgeProps {
  status: SetStatus;
  label: string;
}

/**
 * Compact status pill for a set card, mirroring the web LiveBadge. Renders for
 * the time-sensitive states only (live / soon / upcoming); other statuses
 * return null since the card already shows the start–end time. The "live" dot
 * is static (no per-card animation) to stay light inside long scrolling lists.
 */
export default function LiveBadge({ status, label }: LiveBadgeProps) {
  const styles = useStyles();

  if (status === 'live') {
    return (
      <View style={[styles.pill, styles.livePill]} accessibilityRole="text" accessibilityLabel="Live">
        <View style={styles.liveDot} />
        <Text style={styles.liveText}>{label}</Text>
      </View>
    );
  }

  if (status === 'soon') {
    return (
      <View style={[styles.pill, styles.soonPill]} accessibilityRole="text" accessibilityLabel="Starting soon">
        <View style={styles.soonDot} />
        <Text style={styles.soonText}>{label}</Text>
      </View>
    );
  }

  if (status === 'upcoming') {
    return (
      <View style={[styles.pill, styles.upcomingPill]} accessibilityRole="text" accessibilityLabel={label}>
        <Text style={styles.upcomingText}>{label}</Text>
      </View>
    );
  }

  return null;
}

const useStyles = makeStyles((t) => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
  },
  livePill: {
    backgroundColor: t.colors.accent.coral,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: t.colors.text.onAccent,
  },
  liveText: {
    ...typeStyle('micro'),
    fontWeight: '800',
    textTransform: 'uppercase',
    color: t.colors.text.onAccent,
  },
  soonPill: {
    backgroundColor: t.colors.amberAlpha[20],
  },
  soonDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: t.colors.accent.amber,
  },
  soonText: {
    ...typeStyle('micro'),
    fontWeight: '700',
    color: t.colors.accent.amber,
  },
  upcomingPill: {
    backgroundColor: t.colors.ring.aqua,
  },
  upcomingText: {
    ...typeStyle('micro'),
    fontWeight: '700',
    color: t.colors.accent.aqua,
  },
}));
