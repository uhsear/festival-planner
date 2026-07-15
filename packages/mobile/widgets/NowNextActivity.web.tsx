/**
 * Web stub for the native iOS Live Activity + home-screen widget.
 *
 * `NowNextActivity.tsx` uses `expo-widgets` + `@expo/ui/swift-ui`, which have no
 * web implementation (they call `requireNativeViewManager`, crashing the web
 * bundle). Metro resolves this `.web.tsx` ahead of the `.tsx` on the web target,
 * so `useOngoingNotification` gets a harmless no-op — the app renders on web for
 * visual QA while native (iOS/Android) still loads the real widget module.
 *
 * Live Activities / home-screen widgets are iOS-only anyway, so a no-op on web
 * is the correct behaviour, not just a testing shim.
 */
type NowNextSnapshot = { title: string; subtitle: string };

export const NowNextWidgetInstance = {
  updateSnapshot: (_snapshot: NowNextSnapshot): void => {},
};

export default {};
