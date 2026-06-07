import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

export type CrewTabKey = 'members' | 'plan' | 'logistics' | 'money';

const TABS: readonly { key: CrewTabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'members', label: 'Members', icon: 'people-outline' },
  { key: 'plan', label: 'Plan', icon: 'calendar-outline' },
  { key: 'logistics', label: 'Logistics', icon: 'navigate-outline' },
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
 */
export default function CrewTabBar({ activeTab, onTabChange, badges }: CrewTabBarProps) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.barOuter}
      contentContainerStyle={styles.bar}
      accessibilityRole="tablist"
    >
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
            accessibilityLabel={tab.label}
          >
            <Ionicons name={tab.icon} size={15} color={active ? t.colors.accent.aqua : t.colors.text.secondary} />
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
            {typeof badge === 'number' && badge > 0 ? (
              <View style={styles.countBadge} accessibilityLabel={`${badge} open`}>
                <Text style={styles.countBadgeText}>{badge}</Text>
              </View>
            ) : badge === true ? (
              <View style={styles.dotBadge} accessibilityLabel="Needs attention" />
            ) : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  // Pin the bar to its content height. A horizontal ScrollView in a flex column
  // can otherwise grow on the vertical (main) axis to fill slack, which made the
  // tab pills look oversized on shorter panes; flexGrow:0 keeps it tab-height.
  barOuter: {
    flexGrow: 0,
  },
  bar: {
    flexDirection: 'row',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[2],
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
    backgroundColor: t.colors.ring.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    ...typeStyle('caption'),
    color: t.colors.accent.coral,
    fontWeight: '700',
  },
  dotBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.accent.coral,
  },
}));
