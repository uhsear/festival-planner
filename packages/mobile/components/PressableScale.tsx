import { useCallback } from 'react';
import { Pressable } from 'react-native';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { duration, easing } from '@festie/shared/tokens';
import { useReduceMotion } from '../hooks/useReduceMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Press-squish primitive for SMALL controls — chips, tab pills, priority/rating
 * buttons. Extracted from SegmentedControl's Segment so every small control
 * shares one tokenized scale animation (in: duration.fast/easing.out,
 * out: duration.med/easing.spring). When OS Reduce Motion is on we never touch
 * the shared value, so the control stays at scale 1 with no motion.
 *
 * RULE: squish-for-small-controls (PressableScale), fade/ripple-for-large-surfaces
 * (AppPressable). Cards keep the opacity/ripple feel; buttons/chips/pills squish.
 */
export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** How far to squish on press (0–1 of full scale). Default 0.06 → scale 0.94. */
  pressScale?: number;
}

export default function PressableScale({
  style,
  pressScale = 0.06,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * pressScale }],
  }));

  const handlePressIn = useCallback<NonNullable<PressableProps['onPressIn']>>(
    (e) => {
      if (!reduceMotion) {
        // eslint-disable-next-line react-hooks/immutability -- imperative Reanimated shared-value write in an event handler; .value mutation is the animation API and has no derived-state equivalent
        pressed.value = withTiming(1, {
          duration: duration.fast,
          easing: Easing.bezier(...easing.out.bezier),
        });
      }
      onPressIn?.(e);
    },
    [reduceMotion, pressed, onPressIn],
  );

  const handlePressOut = useCallback<NonNullable<PressableProps['onPressOut']>>(
    (e) => {
      if (!reduceMotion) {
        // eslint-disable-next-line react-hooks/immutability -- imperative Reanimated shared-value write in an event handler; .value mutation is the animation API and has no derived-state equivalent
        pressed.value = withTiming(0, {
          duration: duration.med,
          easing: Easing.bezier(...easing.spring.bezier),
        });
      }
      onPressOut?.(e);
    },
    [reduceMotion, pressed, onPressOut],
  );

  return (
    <AnimatedPressable style={[style, animatedStyle]} onPressIn={handlePressIn} onPressOut={handlePressOut} {...rest}>
      {children}
    </AnimatedPressable>
  );
}
