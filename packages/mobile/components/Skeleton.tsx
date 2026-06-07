import { useEffect, useRef } from 'react';
import { Animated, type DimensionValue, type ViewStyle } from 'react-native';
import { useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';

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
 */
export function Skeleton({ width = '100%', height = 16, radius, style }: SkeletonProps) {
  const t = useTokens();
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, opacity]);

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
          opacity,
        },
        style,
      ]}
    />
  );
}

export default Skeleton;
