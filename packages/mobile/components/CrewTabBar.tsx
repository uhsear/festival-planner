import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { duration, easing } from '@festie/shared/tokens';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';

export type CrewTabKey = 'members' | 'plan' | 'logistics' | 'money';

// DC4: 'Find' owns the mid-festival "where is everyone / where do we meet"
// cluster (map, compass, live location, SOS, meeting points). Packing + Rides
// moved into 'Plan' (pre-festival planning), Money kept as-is. The `logistics`
// key is retained to avoid churning every consumer; only the label/icon changed.
const TABS: readonly { key: CrewTabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'members', label: 'Members', icon: 'people-outline' },
  { key: 'plan', label: 'Plan', icon: 'calendar-outline' },
  { key: 'logistics', label: 'Find', icon: 'location-outline' },
  { key: 'money', label: 'Money', icon: 'cash-outline' },
];

interface CrewTabBarProps {
  activeTab: CrewTabKey;
  onTabChange: (tab: CrewTabKey) => void;
  /**
   * Per-tab badge content rendered after the label. A number renders a small
   * count pill; `true` renders a dot indicator. Falsy values render nothing.
   */
  badges?: Partial<Record<CrewTabKey, number | boolean>>;
}

/**
 * P1-2 — segmented Crew tab bar (mobile mirror of web's CrewTabBar). Splits the
 * crew screen's many sections into Members / Plan / Logistics / Money tabs so
 * the screen reads as tabs instead of one long scroll. Horizontally scrollable
 * for narrow phones; each tab is a >=44pt touch target. Coral is reserved for
 * the badges (open polls / unsettled balance), matching the web pattern.
 *
 * R14: A 2px aqua sliding indicator bar sits above the active tab pill.
 * Reanimated withTiming (exponential ease-out, no spring overshoot) drives
 * translateX + width on the UI thread. Under reduce-motion both values jump
 * instantly (duration 0).
 * Tab x/width are measured via onLayout callbacks so the indicator is accurate
 * regardless of label length or badge presence.
 */
export default function CrewTabBar({ activeTab, onTabChange, badges }: CrewTabBarProps) {
  const t = useTokens();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();

  // Tab layout measurements: keyed by tab.key, populated via onLayout callbacks.
  const [tabLayouts, setTabLayouts] = useState<Record<string, { x: number; width: number }>>({});

  // Reanimated shared values for the indicator beam.
  const indicatorX = useSharedValue(-999); // off-screen until first measurement
  const indicatorW = useSharedValue(0);

  // Drive the indicator to the active tab whenever activeTab or layouts change.
  useEffect(() => {
    const layout = tabLayouts[activeTab];
    if (!layout) return;
    if (reduceMotion) {
      indicatorX.value = withTiming(layout.x, { duration: 0 });
      indicatorW.value = withTiming(layout.width, { duration: 0 });
    } else {
      const cfg = { duration: duration.med, easing: Easing.bezier(...easing.out.bezier) };
      indicatorX.value = withTiming(layout.x, cfg);
      indicatorW.value = withTiming(layout.width, cfg);
    }
  }, [activeTab, tabLayouts, reduceMotion, indicatorX, indicatorW]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
    width: indicatorW.value,
  }));

  return (
    <View style={styles.barOuter}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bar}
        accessibilityRole="tablist"
      >
        {/* R14: indicator track — absolute strip at the top of the SCROLL
            CONTENT (not the outer wrapper) so it stays registered over the
            measured tab frames when the bar is scrolled. pointerEvents "none"
            lets taps fall through to the tabs below. */}
        <View style={styles.indicatorTrack} pointerEvents="none">
          <Animated.View style={[styles.indicator, indicatorStyle]} />
        </View>
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          const badge = badges?.[tab.key];
          return (
            <TouchableOpacity
              key={tab.key}
              testID={`crew-tab-${tab.key}`}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => onTabChange(tab.key)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={
                typeof badge === 'number' && badge > 0
                  ? `${tab.label}, ${badge} open`
                  : badge === true
                    ? `${tab.label}, needs attention`
                    : tab.label
              }
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                setTabLayouts((prev) => ({ ...prev, [tab.key]: { x, width } }));
              }}
            >
              {/* DC25: 15 is off-grid; snap to iconSize.sm (16). */}
              <Ionicons name={tab.icon} size={16} color={active ? t.colors.accent.aqua : t.colors.text.secondary} />
              <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
              {typeof badge === 'number' && badge > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{badge}</Text>
                </View>
              ) : badge === true ? (
                <View style={styles.dotBadge} />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // Wrapper: pins bar to content height (same intent as the old flexGrow:0 on
  // the bare ScrollView) and provides the positioning context for the indicator.
  barOuter: {
    flexGrow: 0,
  },
  // R14: full-width absolute strip at the very top of the bar container.
  // The Animated.View indicator slides within it; zIndex:1 keeps it above the
  // tab pill borders but behind nothing interactive.
  indicatorTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    zIndex: 1,
  },
  // R14: the sliding 2px aqua beam. translateX + width are Reanimated-driven.
  // borderRadius:1 gives subtle capsule ends.
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: t.colors.accent.aqua,
  },
  bar: {
    flexDirection: 'row',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[2],
    // Fill the viewport when the four tabs fit (the common phone case) so the
    // bar has no dead horizontal scroll; it still scrolls on narrow screens.
    flexGrow: 1,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44, // WCAG 2.5.5 / Apple HIG minimum touch target
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  tabActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[12],
  },
  label: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  labelActive: {
    color: t.colors.accent.aqua,
  },
  countBadge: {
    minWidth: 18,
    paddingHorizontal: t.spacing[1],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    // Open-polls count is "attention, not alarm" — aqua per the accent rule
    // (coral is reserved for danger/SOS only).
    backgroundColor: t.colors.aquaAlpha[15],
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  dotBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.accent.coral,
  },
}));
