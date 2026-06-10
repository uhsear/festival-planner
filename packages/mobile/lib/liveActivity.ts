import { NativeModules, Platform } from 'react-native';

/**
 * iOS Live Activity bridge (foundation).
 *
 * The cross-platform "now / next set + meeting point" model already exists
 * (`buildOngoingNotificationModel` in @festie/shared) and drives the Android
 * ongoing notification. This is the iOS counterpart: a thin JS bridge to a
 * native ActivityKit module (`FestieLiveActivity`) that presents that same model
 * as a Lock-Screen / Dynamic-Island Live Activity.
 *
 * The native module is OPTIONAL. Until the Widget Extension + native module are
 * built into the app (a config-plugin + Swift spike — see
 * docs/plans/ios-live-activity-runbook.md), `NativeModules.FestieLiveActivity`
 * is undefined and every function here is a safe no-op. That keeps this file
 * shippable over-the-air today (it can never crash a JS-only build) while the
 * call sites (useOngoingNotification) are wired and ready for when the native
 * widget lands in a build.
 */
interface FestieLiveActivityNative {
  startOrUpdate(content: { title: string; body: string; endsAt?: string | null }): Promise<void> | void;
  end(): Promise<void> | void;
}

const Native: FestieLiveActivityNative | null =
  Platform.OS === 'ios' ? ((NativeModules.FestieLiveActivity as FestieLiveActivityNative) ?? null) : null;

/** True once the native ActivityKit widget is present in the running binary. */
export const liveActivitySupported = !!Native;

export interface LiveActivityContent {
  title: string;
  body: string;
  /** ISO end time so the native widget can render a live countdown (optional). */
  endsAt?: string | null;
}

/** Start the Live Activity, or update it in place if one is already running. */
export async function startOrUpdateLiveActivity(content: LiveActivityContent): Promise<void> {
  try {
    await Native?.startOrUpdate?.(content);
  } catch {
    // A Live Activity is a nicety — never let a native hiccup crash the screen.
  }
}

/** End any running Live Activity (festival window over, screen unmounted, etc.). */
export async function endLiveActivity(): Promise<void> {
  try {
    await Native?.end?.();
  } catch {
    /* no-op */
  }
}
