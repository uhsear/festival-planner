import { Platform } from 'react-native';

/**
 * iOS Live Activity bridge (SDK 56 expo-widgets).
 *
 * Drives the "Now & Next" Live Activity (widgets/NowNextActivity.tsx) from the
 * SAME on-device model that powers the Android ongoing notification
 * (`buildOngoingNotificationModel`). iOS-only: on Android every call is a no-op.
 *
 * The widget module imports @expo/ui/swift-ui (iOS-only), so it is lazy-required
 * behind a Platform.OS === 'ios' guard — it never enters the Android bundle's
 * executed path. expo-widgets still extracts the widget's SwiftUI at build time
 * from source (independent of runtime import). Live Activities require iOS 16.2+;
 * start() simply no-ops/throws (caught) on older iOS, so this degrades safely.
 */
export interface LiveActivityContent {
  title: string;
  body: string;
  endsAt?: string | null;
}

type LiveActivityInstance = {
  update: (props: Record<string, unknown>) => void;
  end: (dismissalPolicy?: string, props?: Record<string, unknown>, contentDate?: Date) => void;
};

let instance: LiveActivityInstance | null = null;

/** True on the platform that can present a Live Activity (iOS). */
export const liveActivitySupported = Platform.OS === 'ios';

function loadWidget(): { start: (props: Record<string, unknown>, url?: string) => LiveActivityInstance } | null {
  if (Platform.OS !== 'ios') return null;
  try {
    // Lazy require so @expo/ui/swift-ui never resolves in the Android bundle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../widgets/NowNextActivity').default;
  } catch {
    return null;
  }
}

/** Start the Live Activity, or update it in place if one is already running. */
export function startOrUpdateLiveActivity(content: LiveActivityContent): void {
  if (Platform.OS !== 'ios') return;
  const props = { title: content.title, subtitle: content.body };
  try {
    if (instance) {
      instance.update(props);
      return;
    }
    const widget = loadWidget();
    instance = widget ? widget.start(props) : null;
  } catch {
    // A Live Activity is a nicety — never let a native hiccup crash the screen.
    instance = null;
  }
}

/** End any running Live Activity (festival window over, screen unmounted, etc.). */
export function endLiveActivity(): void {
  try {
    instance?.end('immediate');
  } catch {
    /* no-op */
  } finally {
    instance = null;
  }
}
