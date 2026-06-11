import { useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { duration, easing } from '@festie/shared/tokens';
import { makeStyles, typeStyle } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';

interface LiveDotProps {
  /** Optional label rendered next to the dot. Defaults to "NOW". */
  label?: string;
}

/**
 * A pulsing "live"/NOW indicator: a small coral dot that breathes in scale and
 * opacity to signal that something is happening right now (e.g. a set that is
 * currently on stage).
 *
 * Reduce-motion gating: when the OS "Reduce Motion" setting is on we cancel the
 * loop and pin the dot to a static, fully-visible resting state instead of
 * animating. RN has no `prefers-reduced-motion` media query, so the decision is
 * made imperatively via {@link useReduceMotion}.
 */
export default function LiveDot({ label = 'NOW' }: LiveDotProps) {
  const s = useStyles();
  const reduceMotion = useReduceMotion();

  // Single driver in [0, 1]; mapped to scale + opacity in the worklet below.
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(pulse);
      pulse.value = 0; // resting state == fully visible, scale 1
      return;
    }

    pulse.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: duration.slow,
          easing: Easing.bezier(...easing.standard.bezier),
        }),
        withTiming(0, {
          duration: duration.slow,
          easing: Easing.bezier(...easing.standard.bezier),
        }),
      ),
      -1, // repeat forever
      false,
    );

    return () => cancelAnimation(pulse);
  }, [reduceMotion, pulse]);

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.35 }],
    opacity: 1 - pulse.value * 0.45,
  }));

  return (
    <View style={s.row} accessibilityRole="text" accessibilityLabel={`${label}, live`}>
      <View style={s.halo}>
        <Animated.View style={[s.dot, dotStyle]} />
      </View>
      <Text style={s.label}>{label}</Text>
    </View>
  );
}

const DOT_SIZE = 8;

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  halo: {
    width: DOT_SIZE * 2,
    height: DOT_SIZE * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: t.colors.accent.aqua,
  },
  label: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
}));
