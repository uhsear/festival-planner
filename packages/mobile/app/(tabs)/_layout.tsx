import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { colors } from '@festie/shared/tokens';
import { useAuthStore } from '@festie/shared/stores';
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

  // Guests may only browse the Schedule. Picks / Crew / Account expose
  // per-user data and were previously visible to guests, who tapped in and got
  // bounced to /login a frame later (the AuthGate rAF redirect) — a one-frame
  // flash + bounce. Hiding those triggers for guests removes the dead-end taps
  // entirely; the AuthGate redirect stays as the deep-link backstop.
  const signedIn = useAuthStore((s) => !!s.user);

  return (
    <NativeTabs tintColor={colors.accent.aqua} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        {/* calendar has no plain `.fill` cut in SF Symbols, so the circle pair
            gives the same outline→fill selected feedback as the other tabs
            instead of an unchanged glyph on select. */}
        <NativeTabs.Trigger.Icon sf={{ default: 'calendar.circle', selected: 'calendar.circle.fill' }} md="event" />
        <NativeTabs.Trigger.Label>Schedule</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="picks" hidden={!signedIn}>
        <NativeTabs.Trigger.Icon sf={{ default: 'star', selected: 'star.fill' }} md="star" />
        <NativeTabs.Trigger.Label>Picks</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="crew" hidden={!signedIn}>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
        <NativeTabs.Trigger.Label>Crew</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account" hidden={!signedIn}>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          md="person"
        />
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
