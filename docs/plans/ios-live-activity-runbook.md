# iOS Live Activity — implementation runbook

Status: **JS foundation shipped (OTA-safe no-op); native widget pending a build.**

The cross-platform model and the JS wiring are done:

- `@festie/shared` `buildOngoingNotificationModel` produces `{ active, title, body }`
  (drives the Android ongoing notification today).
- `packages/mobile/lib/liveActivity.ts` — JS bridge to an **optional** native
  module `FestieLiveActivity` (`startOrUpdate` / `end`). No-op when the module is
  absent, so it ships over-the-air and cannot crash a JS-only build.
- `packages/mobile/hooks/useOngoingNotification.ts` — already calls the bridge on
  iOS with the same model.

What remains is **native only** and requires an EAS build to validate (it cannot
be compiled or tested without Xcode / a build). This is the scoped follow-up.

## Why it needs a build (not an OTA)
ActivityKit is a Widget Extension target with its own Swift, Info.plist keys and
entitlements — all baked into the binary. OTA can only update JS. So this is a
`eas build -p ios` + TestFlight + on-device iteration loop (expect 2–3 build
iterations to get the layout/registration right). EAS build credit is limited —
get sign-off before starting the loop.

## Recommended approach: `@bacons/apple-targets` config plugin
Avoids hand-editing the Xcode project; declares the widget target in config.

### 1. Add deps + plugin
- `pnpm --filter @festie/mobile add @bacons/apple-targets` (dev/config plugin).
- In `app.json` → `expo.plugins`, add `"@bacons/apple-targets"`.
- Set the iOS deployment target ≥ 16.2 (Live Activities) — via
  `expo-build-properties` (`ios.deploymentTarget: "16.2"`).

### 2. Declare the widget target
Create `packages/mobile/targets/live-activity/expo-target.config.js`:
```js
module.exports = { type: 'widget', name: 'FestieLiveActivity' };
```
Add the Swift files below in that folder.

### 3. Info.plist + entitlements
- Main app `Info.plist`: `NSSupportsLiveActivities = true` (via
  `app.json` → `ios.infoPlist`).
- App Group (`group.us.festie.app`) on BOTH the app and the widget target so the
  RN side and the widget can share the activity id if needed.

### 4. ActivityAttributes (shared Swift)
```swift
import ActivityKit
struct FestieActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var title: String
    var body: String
    var endsAt: Date?
  }
  // static attributes (none needed beyond the app name)
}
```

### 5. SwiftUI widget (`FestieLiveActivityWidget.swift`)
- `ActivityConfiguration(for: FestieActivityAttributes.self)` with a Lock-Screen
  view (title + body + optional `Text(timerInterval:)` countdown to `endsAt`) and
  Dynamic Island leading/trailing/compact regions.
- Use the brand colors (dark bg `#080810`, aqua `#16E0C8`-ish accent — match
  `packages/shared/src/tokens/colors.ts`).

### 6. Native module `FestieLiveActivity` (Expo module, Swift)
Bridge the JS API in `lib/liveActivity.ts`:
```swift
import ExpoModulesCore
import ActivityKit

public class FestieLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FestieLiveActivity")
    Function("startOrUpdate") { (content: [String: Any?]) in
      guard #available(iOS 16.2, *) else { return }
      let state = FestieActivityAttributes.ContentState(
        title: content["title"] as? String ?? "",
        body: content["body"] as? String ?? "",
        endsAt: nil)
      if let activity = Activity<FestieActivityAttributes>.activities.first {
        Task { await activity.update(.init(state: state, staleDate: nil)) }
      } else {
        _ = try? Activity.request(
          attributes: FestieActivityAttributes(),
          content: .init(state: state, staleDate: nil))
      }
    }
    Function("end") {
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<FestieActivityAttributes>.activities {
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
      }
    }
  }
}
```
(The JS bridge already expects exactly `startOrUpdate({title, body, endsAt?})` and
`end()`. `liveActivitySupported` flips true automatically once this registers.)

### 7. Build + validate loop
1. `cd packages/mobile && eas build -p ios --profile production` (**ask first** —
   uses EAS credit).
2. TestFlight → on a real device, open a festival during a live window; confirm
   the Live Activity appears on the Lock Screen / Dynamic Island, updates as the
   set changes, and ends when the window closes.
3. Iterate on layout/registration as needed (most first attempts need 1–2 fixes:
   `NSSupportsLiveActivities`, deployment target, widget bundle registration).

## Optional later: remote updates
For updates while the app is fully backgrounded/killed, push to the activity's
push token via APNs (`apns-push-type: liveactivity`). The local-update path above
covers foreground/background-running, which is the 80% case. Defer remote updates.

## Home-screen widget (separate, smaller)
A static "next pick" home-screen widget is a second WidgetKit target in the same
extension — additive once the extension exists. Lower priority than the Live
Activity; do it in the same build cycle if time allows.
