/**
 * useHaptics (mobile): haptic feedback mirroring the web hook's vocabulary
 * (tap/select/success/warning), built on React Native's core Vibration API so
 * it ships via OTA with no extra native dependency. Patterns match the web
 * hook for cross-platform parity. (A future native build can swap in
 * expo-haptics for richer iOS feedback without changing call sites.)
 */
import { Vibration, Platform } from 'react-native';

export interface UseHapticsReturn {
  tap: () => void;
  select: () => void;
  success: () => void;
  warning: () => void;
  isSupported: boolean;
}

// Android honors vibration durations/patterns; iOS Vibration ignores duration
// (single buzz) and patterns, so we treat Android as the "supported" surface.
const isSupported = Platform.OS === 'android';

function vibrate(pattern: number | number[]) {
  if (!isSupported) return;
  try {
    Vibration.vibrate(pattern);
  } catch {
    // Never let a missing/odd vibrator break a UI interaction.
  }
}

export function useHaptics(): UseHapticsReturn {
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
