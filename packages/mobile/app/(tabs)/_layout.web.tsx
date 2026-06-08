import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing } from '@festie/shared/tokens';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

/**
 * Web fallback for the tab bar — NativeTabs (_layout.tsx) is native-only, but
 * `eas update` still bundles the mobile package for web, so web needs the JS
 * <Tabs>. Festie's shipped web app is the separate @festie/web SPA; this exists
 * purely to keep the mobile web bundle building.
 */
export default function TabLayoutWeb() {
  useRealtimeSync();
  const insets = useSafeAreaInsets();
  const tabBarBottomInset = Math.max(insets.bottom, spacing[1]);

  return (
    <Tabs
      screenOptions={{
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
        tabBarLabelStyle: { fontSize: fontSize[10], fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Schedule',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="picks"
        options={{
          title: 'Picks',
          tabBarIcon: ({ color, size }) => <Ionicons name="star-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="crew"
        options={{
          title: 'Crew',
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
