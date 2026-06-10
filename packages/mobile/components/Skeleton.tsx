import { type DimensionValue, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { easing } from '@festie/shared/tokens';
import { useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';

/**
 * Ambient-loop half-cycle for shimmer pulses (Skeleton + LiveDot breathing).
 * Lives here until a `pulse` token lands in @festie/shared/tokens/motion — see
 * the F38 integration note. Kept as one named constant so both surfaces share a
 * single ambient cadence instead of re-typing 750ms inline.
 */
const PULSE_DURATION = 750;

interface SkeletonProps {
  /** Block width — number (px) or percentage string. Defaults to full width. */
  width?: DimensionValue;
  /** Block height in px. */
  height?: number;
  /** Corner radius (defaults to the standard token radius). */
  radius?: number;
  style?: ViewStyle | ViewStyle[];
}

/**
 * A single shimmering placeholder block. Pulses its opacity to signal "content
 * loading" and matches a real element's geometry so the layout doesn't jump when
 * data arrives. Honors the OS Reduce Motion setting (RN has no CSS
 * `prefers-reduced-motion`): when reduced, it renders a static dimmed block
 * instead of animating. Always hidden from the accessibility tree — a
 * screen-reader user hears the screen's `progressbar`/loading label, not the
 * decorative blocks.
 *
 * Uses Reanimated (withRepeat) to match the app's single animation system
 * (LiveDot, SegmentedControl, PressableScale) rather than the legacy Animated API.
 */
export function Skeleton({ width = '100%', height = 16, radius, style }: SkeletonProps) {
  const t = useTokens();
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(0.45);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(opacity);
      opacity.value = 0.6;
      return;
    }
    // Pulse 0.4 ↔ 0.9 forever; -1 repeats, `true` reverses each cycle.
    opacity.value = 0.4;
    opacity.value = withRepeat(
      withTiming(0.9, { duration: PULSE_DURATION, easing: Easing.bezier(...easing.standard.bezier) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [reduceMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: radius ?? t.radii.default,
          backgroundColor: t.colors.bg.secondary,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

export default Skeleton;
