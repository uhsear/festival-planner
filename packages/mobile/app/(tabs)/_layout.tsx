import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing } from '@festie/shared/tokens';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

export default function TabLayout() {
  // Connect Socket.IO when user is on the main tabs (authenticated).
  // Events flow into shared Zustand stores automatically.
  useRealtimeSync();

  return (
    <Tabs
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.bg.secondary,
        },
        headerTintColor: colors.text.primary,
        headerTitleStyle: {
          fontWeight: '600',
          fontSize: fontSize[18],
        },
        tabBarStyle: {
          backgroundColor: colors.bg.secondary,
          borderTopColor: colors.border.default,
          borderTopWidth: 1,
          paddingTop: spacing[1],
          height: 56 + spacing[2],
        },
        tabBarActiveTintColor: colors.accent.aqua,
        tabBarInactiveTintColor: colors.text.muted,
        tabBarLabelStyle: {
          fontSize: fontSize[10],
          fontWeight: '600',
          marginBottom: spacing[1],
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Timeline',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="picks"
        options={{
          title: 'Picks',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="star-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="crew"
        options={{
          title: 'Crew',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
