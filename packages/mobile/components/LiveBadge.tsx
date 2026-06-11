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
 *
 * R6: 9999px radius, 3px/10px padding, 11px Space Grotesk 500, 0.04em tracking.
 * Color assignments:
 *   live     → coralStrong fill + onLightAccent ink (AA ~6.04:1, sole coral exception)
 *   soon     → aqua fill + onLightAccent dark ink (R6 NOW PLAYING, AA)
 *   upcoming → transparent + 1px aqua/40% border + aqua text (R6 UP NEXT)
 */
export default function LiveBadge({ status, label }: LiveBadgeProps) {
  const styles = useStyles();

  if (status === 'live') {
    return (
      <View style={[styles.pill, styles.livePill]} accessibilityRole="text" accessibilityLabel="Live">
        <View style={styles.liveDot} />
        <Text style={styles.liveText} maxFontSizeMultiplier={1.2}>
          {label}
        </Text>
      </View>
    );
  }

  if (status === 'soon') {
    return (
      <View style={[styles.pill, styles.soonPill]} accessibilityRole="text" accessibilityLabel="Starting soon">
        <View style={styles.soonDot} />
        <Text style={styles.soonText} maxFontSizeMultiplier={1.2}>
          {label}
        </Text>
      </View>
    );
  }

  if (status === 'upcoming') {
    return (
      <View style={[styles.pill, styles.upcomingPill]} accessibilityRole="text" accessibilityLabel={label}>
        <Text style={styles.upcomingText} maxFontSizeMultiplier={1.2}>
          {label}
        </Text>
      </View>
    );
  }

  return null;
}

// R6 shared text style: Space Grotesk 500, micro size, 0.04em tracking, uppercase.
// typeStyle('micro', 500) resolves to SpaceGrotesk_500Medium on native.
// letterSpacing is overridden to 0.04em (spec) from micro's default 0.08em (caps).
const _pillText = typeStyle('micro', 500);
const PILL_TEXT_BASE = {
  ..._pillText,
  textTransform: 'uppercase' as const,
  letterSpacing: (_pillText.fontSize ?? 10) * 0.04,
};

const useStyles = makeStyles((t) => ({
  // R6 base: 9999px radius, 3px vertical / 10px horizontal padding.
  pill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing[1],
    borderRadius: 9999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  // Live: coralStrong fill, onLightAccent (dark ink) text — AA ~6.04:1.
  // Deliberate danger-accent exception; not a CTA.
  livePill: {
    backgroundColor: t.colors.accent.coralStrong,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.colors.text.onLightAccent,
  },
  liveText: {
    ...PILL_TEXT_BASE,
    color: t.colors.text.onLightAccent,
  },
  // R6 NOW PLAYING (soon): aqua fill + onLightAccent dark ink. AA.
  soonPill: {
    backgroundColor: t.colors.accent.aqua,
  },
  soonDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.colors.text.onLightAccent,
  },
  soonText: {
    ...PILL_TEXT_BASE,
    color: t.colors.text.onLightAccent,
  },
  // R6 UP NEXT (upcoming): transparent + 1px aqua/40% border + aqua text.
  upcomingPill: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(0, 232, 208, 0.4)',
  },
  upcomingText: {
    ...PILL_TEXT_BASE,
    color: t.colors.accent.aqua,
  },
}));
