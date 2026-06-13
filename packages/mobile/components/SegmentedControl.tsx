import { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { duration, easing } from '@festie/shared/tokens';
import { makeStyles, typeStyle } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useHaptics } from '../hooks/useHaptics';
import PressableScale from './PressableScale';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}

interface SegmentProps<T extends string> {
  option: SegmentOption<T>;
  active: boolean;
  onPress: (value: T) => void;
}

/**
 * A single tappable segment. The press-squish lives in {@link PressableScale};
 * the active aqua fill is rendered by the parent's sliding thumb, not here.
 */
function Segment<T extends string>({ option, active, onPress }: SegmentProps<T>) {
  const s = useStyles();
  return (
    <PressableScale
      testID={`segment-${option.value}`}
      style={s.segment}
      onPress={() => onPress(option.value)}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={option.label}
    >
      <Text style={[s.label, active && s.labelActive]}>{option.label}</Text>
    </PressableScale>
  );
}

/**
 * A compact iOS-style segmented control built on the shared tokens. Used by
 * the Timeline tab to switch schedule view modes without adding bottom tabs.
 *
 * The active aqua fill is an absolutely-positioned "thumb" that slides between
 * segments (DC20) — measured from each segment's onLayout. Under Reduce Motion
 * the thumb jumps instantly (withTiming(duration 0)).
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const s = useStyles();
  const reduceMotion = useReduceMotion();
  const haptics = useHaptics();
  // Per-segment measured frames (x + width), indexed to `options`.
  const [frames, setFrames] = useState<Record<number, { x: number; width: number }>>({});

  const thumbX = useSharedValue(0);
  const thumbW = useSharedValue(0);

  const activeIndex = options.findIndex((o) => o.value === value);

  const moveThumb = useCallback(
    (index: number, framesMap: Record<number, { x: number; width: number }>) => {
      const f = framesMap[index];
      if (!f) return;
      const config = { duration: reduceMotion ? 0 : duration.med, easing: Easing.bezier(...easing.standard.bezier) };
      // eslint-disable-next-line react-hooks/immutability -- Reanimated shared value
      thumbX.value = withTiming(f.x, config);
      // eslint-disable-next-line react-hooks/immutability -- Reanimated shared value
      thumbW.value = withTiming(f.width, config);
    },
    [reduceMotion, thumbX, thumbW],
  );

  const handleSegmentLayout = useCallback(
    (index: number) => (e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      setFrames((prev) => {
        const next = { ...prev, [index]: { x, width } };
        // Snap the thumb to the active segment the moment its frame is known.
        if (index === activeIndex) moveThumb(index, next);
        return next;
      });
    },
    [activeIndex, moveThumb],
  );

  const handleChange = useCallback(
    (next: T) => {
      if (next !== value) {
        haptics.select();
        moveThumb(
          options.findIndex((o) => o.value === next),
          frames,
        );
      }
      onChange(next);
    },
    [value, haptics, moveThumb, options, frames, onChange],
  );

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
    width: thumbW.value,
  }));

  return (
    <View style={s.track} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      <Animated.View pointerEvents="none" style={[s.thumb, thumbStyle]} />
      {options.map((opt, i) => (
        <View key={opt.value} style={s.segmentSlot} onLayout={handleSegmentLayout(i)}>
          <Segment option={opt} active={opt.value === value} onPress={handleChange} />
        </View>
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
    // Pin the height: on Android (New Arch) the track was measured at ~24dp
    // while its 44dp segments overflowed below it, leaving the thumb floating
    // above the labels. 44 (WCAG segment min) + the 4px padding each side.
    minHeight: 44 + t.spacing[1] * 2,
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  // The sliding aqua fill behind the active segment. RN positions absolute
  // children relative to the parent's border box, but the slots are laid out
  // inside the track's padding — inset the thumb by the same padding so it
  // registers exactly over the active slot instead of overhanging 4px on
  // every edge (the iOS "label half under the pill" misalignment).
  thumb: {
    position: 'absolute',
    top: t.spacing[1],
    bottom: t.spacing[1],
    left: 0,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.aqua,
  },
  segmentSlot: {
    flex: 1,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.pill,
    minHeight: 44, // WCAG 2.5.5 / Apple HIG minimum touch target
  },
  label: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  labelActive: {
    color: t.colors.text.onLightAccent,
  },
}));
