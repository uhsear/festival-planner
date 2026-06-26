import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { colors } from '@festie/shared/tokens';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

/**
 * Native bottom tabs (expo-router/unstable-native-tabs, SDK 55+). Replaces the
 * hand-rolled JS <Tabs> bar: gets the iOS 26 liquid-glass / Android Material 3
 * tab bar, native haptics, and AUTOMATIC bottom safe-area insets — so the
 * per-screen `tabBarBottomInset` math and the Schedule `overflow:'hidden'`
 * tab-bar-bleed workaround are no longer load-bearing.
 *
 * `tintColor` keeps the brand accent rule (aqua = primary/selection). Tab labels
 * are the canonical names (Schedule/Picks/Crew/Account). Web falls back to the JS
 * <Tabs> in _layout.web.tsx (NativeTabs is native-only; eas update still bundles
 * web for the mobile package).
 */
export default function TabLayout() {
  // Connect Socket.IO when the user is on the main tabs (authenticated). Events
  // flow into the shared Zustand stores automatically. Must stay mounted here.
  useRealtimeSync();

  // All four tabs stay visible for guests: the Account tab is the sign-in entry
  // (it routes a guest to /login), and Picks/Crew advertise the features +
  // gate via AuthGate (crew shows an in-place "Sign in required" state). Hiding
  // them for guests removed the only discoverable sign-in path, so they stay.

  return (
    <NativeTabs tintColor={colors.accent.aqua} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        {/* calendar has no plain `.fill` cut in SF Symbols, so the circle pair
            gives the same outline→fill selected feedback as the other tabs
            instead of an unchanged glyph on select. */}
        <NativeTabs.Trigger.Icon sf={{ default: 'calendar.circle', selected: 'calendar.circle.fill' }} md="event" />
        <NativeTabs.Trigger.Label>Schedule</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="picks">
        <NativeTabs.Trigger.Icon sf={{ default: 'star', selected: 'star.fill' }} md="star" />
        <NativeTabs.Trigger.Label>Picks</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="crew">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
        <NativeTabs.Trigger.Label>Crew</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          md="person"
        />
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
