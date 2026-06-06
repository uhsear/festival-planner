import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing } from '@festie/shared/tokens';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useHaptics } from '../../hooks/useHaptics';

export default function TabLayout() {
  // Connect Socket.IO when user is on the main tabs (authenticated).
  // Events flow into shared Zustand stores automatically.
  useRealtimeSync();

  // Light selection haptic on tab switch — same vocabulary as the day/pick
  // toggles. Wired per-screen via the tabPress listener below.
  const haptics = useHaptics();
  const onTabPress = () => haptics.select();

  // The bottom inset is the iPhone home-indicator gap (and Android gesture-nav
  // bar). expo-router's Tabs does NOT auto-pad the bar for it on iOS, so the
  // labels would otherwise sit on top of the home indicator. Pad the bar by the
  // inset and grow its height to match so the tab content stays vertically
  // centered above the indicator. spacing[1] keeps a minimum cushion when the
  // device has no inset (older devices / Android with button nav).
  const insets = useSafeAreaInsets();
  const tabBarBottomInset = Math.max(insets.bottom, spacing[1]);

  return (
    <Tabs
      screenOptions={{
        // Hide the native Tabs nav header app-wide. Each tab screen owns its top
        // safe-area inset exactly once via a custom <ScreenHeader> (or an
        // explicit top inset). Showing the native header on top of those headers
        // double-counted the status-bar inset (empty band above titles); hiding
        // it makes ScreenHeader the single header. Bottom tabBar inset logic
        // below is unaffected.
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bg.secondary,
          borderTopColor: colors.border.default,
          borderTopWidth: 1,
          paddingTop: spacing[1],
          paddingBottom: tabBarBottomInset,
          height: 56 + spacing[2] + tabBarBottomInset,
        },
        tabBarActiveTintColor: colors.accent.aqua,
        tabBarInactiveTintColor: colors.text.muted,
        tabBarLabelStyle: {
          fontSize: fontSize[10],
          fontWeight: '600',
          // iOS renders the label tighter to the icon than Android; nudge it
          // down a touch (2px, half of spacing[1]) so the icon+label block stays
          // optically centered.
          marginBottom: Platform.OS === 'ios' ? 2 : spacing[1],
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Timeline',
          // Explicit a11y labels: iOS doesn't expose the tab title to the
          // accessibility tree by default, so VoiceOver (and UI automation)
          // couldn't identify the tabs. Naming them makes each tab announce
          // clearly and be reliably findable.
          tabBarAccessibilityLabel: 'Timeline',
          tabBarButtonTestID: 'tab-timeline',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} />,
        }}
        listeners={{ tabPress: onTabPress }}
      />
      <Tabs.Screen
        name="picks"
        options={{
          title: 'Picks',
          tabBarAccessibilityLabel: 'Picks',
          tabBarButtonTestID: 'tab-picks',
          tabBarIcon: ({ color, size }) => <Ionicons name="star-outline" size={size} color={color} />,
        }}
        listeners={{ tabPress: onTabPress }}
      />
      <Tabs.Screen
        name="crew"
        options={{
          title: 'Crew',
          tabBarAccessibilityLabel: 'Crew',
          tabBarButtonTestID: 'tab-crew',
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} />,
        }}
        listeners={{ tabPress: onTabPress }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarAccessibilityLabel: 'Account',
          tabBarButtonTestID: 'tab-account',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
        listeners={{ tabPress: onTabPress }}
      />
    </Tabs>
  );
}
