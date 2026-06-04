/**
 * useHaptics (mobile): haptic feedback mirroring the web hook's vocabulary
 * (tap/select/success/warning).
 *
 * Platform split:
 *  - iOS uses expo-haptics (the Taptic Engine) for rich, native-feeling
 *    feedback. iOS's core RN Vibration API ignores durations/patterns (single
 *    dull buzz), so it was effectively unsupported before; expo-haptics unlocks
 *    proper light/selection/success/warning haptics.
 *  - Android keeps the core RN Vibration API so the existing, tuned millisecond
 *    patterns ship unchanged via OTA with no behavioral regression.
 *
 * Both surfaces are wrapped so a missing/odd vibrator (or unavailable Taptic
 * Engine) can never break a UI interaction.
 */
import { Vibration, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export interface UseHapticsReturn {
  tap: () => void;
  select: () => void;
  success: () => void;
  warning: () => void;
  isSupported: boolean;
}

// Android honors vibration durations/patterns; iOS gets the Taptic Engine via
// expo-haptics. Both are now first-class — older devices without a vibrator
// simply no-op inside the try/catch below.
const isIOS = Platform.OS === 'ios';
const isSupported = Platform.OS === 'android' || isIOS;

function safe(fn: () => void) {
  try {
    fn();
  } catch {
    // Never let a missing/odd vibrator or Taptic Engine break a UI interaction.
  }
}

function vibrate(pattern: number | number[]) {
  if (!isSupported) return;
  safe(() => Vibration.vibrate(pattern));
}

export function useHaptics(): UseHapticsReturn {
  if (isIOS) {
    return {
      /** Light tap for button presses. */
      tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
      /** Selection change like a priority toggle. */
      select: () => safe(() => Haptics.selectionAsync()),
      /** Success confirmation. */
      success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
      /** Warning, e.g. a schedule conflict. */
      warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
      isSupported,
    };
  }

  // Android: keep the existing tuned millisecond patterns.
  return {
    /** Light tap for button presses (15ms). */
    tap: () => vibrate(15),
    /** Selection change like a priority toggle (30ms). */
    select: () => vibrate(30),
    /** Success confirmation (30 / 50 / 30). */
    success: () => vibrate([0, 30, 50, 30]),
    /** Warning, e.g. a schedule conflict (50/30/50/30/50). */
    warning: () => vibrate([0, 50, 30, 50, 30, 50]),
    isSupported,
  };
}
