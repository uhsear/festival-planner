# iOS Live Activity — validation runbook

Status: **implemented with Expo Widgets; native-device validation pending.**

Festie uses the Expo SDK 56 `expo-widgets` target configured in `app.json`:

- `buildOngoingNotificationModel` selects the current/next picked set.
- `useOngoingNotification` owns the lifecycle at the app root, so route changes
  do not end the glanceable surface.
- `lib/liveActivity.ios.ts` recovers, starts, updates, and ends the
  `NowNextLiveActivity` factory exported by `widgets/NowNextActivity.tsx`.
- the same hook updates the `NowNextActivity` home-screen widget snapshot.
- `endsAt` is the current set's end or the next set's start. SwiftUI renders it
  as a native timer, so the countdown continues while JavaScript is suspended.

The generic `lib/liveActivity.ts` is intentionally a no-op for Android and web;
Metro selects the `.ios.ts` implementation on iOS.

## Native-build boundary

Expo Go cannot load widget extensions. `expo-widgets` generates the extension,
Live Activity Info.plist keys, and deployment settings during prebuild. Validate
with the repository's macOS simulator workflow first, then a signed physical
device build. Do not use EAS build credit without owner sign-off.

## Validation matrix

1. Start inside the one-hour lead-in for a picked set. Confirm one Lock Screen
   activity appears and its deep link opens `festie://festival-mode`.
2. Navigate through Schedule, Picks, Crew, and Account. Confirm the activity
   remains present and does not duplicate.
3. For a next set, confirm the timer targets its start. During a current set,
   confirm it targets the end.
4. Background and lock the device. Confirm the native timer keeps moving.
5. Relaunch the app. Confirm the existing instance updates rather than stacking.
6. Switch festivals, remove the active profile, log out, and pass the festival
   window. Confirm stale activities end and the home widget becomes neutral.
7. Deny notification permission. Confirm the main app remains usable.

## Known limitation

Local JavaScript recomputes the next-to-now state every 60 seconds only while the
process can run. The native timer remains accurate while locked, but a guaranteed
background transition to a different set requires ActivityKit push updates or a
scheduled native timeline. Keep that as a separate server/APNs project.
