import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Tracks the OS "Reduce Motion" accessibility setting.
 *
 * React Native has no CSS `prefers-reduced-motion` media query, so every
 * animated surface must consult this hook and disable / short-circuit its
 * motion when it returns `true`. We read the initial value via
 * `AccessibilityInfo.isReduceMotionEnabled()` and stay in sync by subscribing
 * to the `reduceMotionChanged` event for the lifetime of the component.
 *
 * Defaults to `false` (motion enabled) until the async initial read resolves.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {
        // If the query fails we keep the safe default (motion enabled).
      });

    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => setReduceMotion(enabled),
    );

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}
