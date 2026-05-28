import { View, Text, Pressable } from 'react-native';
import { makeStyles, typeStyle } from '../hooks/useTokens';

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
  return (
    <View
      style={s.track}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            style={[s.segment, active && s.segmentActive]}
            onPress={() => onChange(opt.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            <Text style={[s.label, active && s.labelActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
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
