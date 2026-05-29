import { useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { duration, easing } from '@festie/shared/tokens';
import { makeStyles, typeStyle } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface SegmentProps<T extends string> {
  option: SegmentOption<T>;
  active: boolean;
  reduceMotion: boolean;
  onPress: (value: T) => void;
}

/**
 * A single tappable segment. Presses drive a subtle scale-down ("squish")
 * animation. When reduce-motion is on we never touch the shared value, so the
 * segment stays at scale 1 with no motion.
 */
function Segment<T extends string>({
  option,
  active,
  reduceMotion,
  onPress,
}: SegmentProps<T>) {
  const s = useStyles();
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.06 }],
  }));

  const handlePressIn = useCallback(() => {
    if (reduceMotion) return;
    pressed.value = withTiming(1, {
      duration: duration.fast,
      easing: Easing.bezier(...easing.out.bezier),
    });
  }, [reduceMotion, pressed]);

  const handlePressOut = useCallback(() => {
    if (reduceMotion) return;
    pressed.value = withTiming(0, {
      duration: duration.med,
      easing: Easing.bezier(...easing.spring.bezier),
    });
  }, [reduceMotion, pressed]);

  return (
    <AnimatedPressable
      style={[s.segment, active && s.segmentActive, animatedStyle]}
      onPress={() => onPress(option.value)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={option.label}
    >
      <Text style={[s.label, active && s.labelActive]}>{option.label}</Text>
    </AnimatedPressable>
  );
}

/**
 * A compact iOS-style segmented control built on the shared tokens. Used by
 * the Timeline tab to switch schedule view modes without adding bottom tabs.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const s = useStyles();
  const reduceMotion = useReduceMotion();
  return (
    <View
      style={s.track}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((opt) => (
        <Segment
          key={opt.value}
          option={opt}
          active={opt.value === value}
          reduceMotion={reduceMotion}
          onPress={onChange}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  track: {
    flexDirection: 'row',
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.pill,
    padding: t.spacing[1],
    gap: t.spacing[1],
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.pill,
    minHeight: 36,
  },
  segmentActive: {
    backgroundColor: t.colors.accent.aqua,
  },
  label: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  labelActive: {
    color: t.colors.text.onLightAccent,
  },
}));
