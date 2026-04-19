/**
 * useHaptics: Simple haptic feedback wrapper using the Vibration API
 * Provides haptic patterns for common mobile interactions
 */

export interface UseHapticsReturn {
  tap: () => void;
  select: () => void;
  success: () => void;
  warning: () => void;
  isSupported: boolean;
}

/**
 * Haptic feedback hook using native Vibration API
 * Gracefully falls back to no-op on unsupported browsers (Safari/iOS)
 *
 * @returns Object with haptic feedback methods and support check
 *
 * @example
 * const { tap, select, success, isSupported } = useHaptics();
 * if (isSupported) {
 *   tap(); // Light 15ms vibration for button taps
 * }
 */
export function useHaptics(): UseHapticsReturn {
  const isSupported = 'vibrate' in navigator;

  const vibrate = (pattern: number | number[]) => {
    if (!isSupported) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Silently fail on unsupported browsers (Safari iOS ignores silently,
      // some Androids require prior user-gesture). Not observable to users.
    }
  };

  return {
    /**
     * Light tap feedback: 15ms vibration
     * Used for button presses and light interactions
     */
    tap: () => vibrate(15),

    /**
     * Selection feedback: 30ms vibration
     * Used for selection changes like priority toggles
     */
    select: () => vibrate(30),

    /**
     * Success feedback: 30ms → pause 50ms → 30ms pattern
     * Used for successful actions and confirmations
     */
    success: () => vibrate([30, 50, 30]),

    /**
     * Warning feedback: 50ms → 30ms → 50ms → 30ms → 50ms pattern
     * Used for conflicts and warnings
     */
    warning: () => vibrate([50, 30, 50, 30, 50]),

    isSupported,
  };
}
