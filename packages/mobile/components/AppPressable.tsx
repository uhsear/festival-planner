import { useCallback } from 'react';
import { Pressable, Platform } from 'react-native';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import { useTokens } from '../hooks/useTokens';

/**
 * The press shared by all large touch surfaces (cards, list rows, tab pills).
 *
 * Why this exists: the app historically used raw `TouchableOpacity` everywhere,
 * which gives an iOS-style opacity fade on BOTH platforms. On Android the native
 * idiom is a bounded ripple originating at the touch point. This wrapper gives
 * each platform its convention from one call site:
 *   - Android: `android_ripple` (bounded, or `borderless` for round icon hits)
 *   - iOS / web: an `activeOpacity`-equivalent fade (style callback on `pressed`)
 *
 * RULE: prefer this over raw `TouchableOpacity` in new code. Use {@link PressableScale}
 * instead for small controls that should squish (chips, pills, priority/rating
 * buttons); use AppPressable for large surfaces (cards, rows) where a fade/ripple
 * reads better than a scale.
 */
export interface AppPressableProps extends Omit<PressableProps, 'style' | 'android_ripple'> {
  /** Static style for the surface. */
  style?: StyleProp<ViewStyle>;
  /** Opacity applied while pressed on iOS/web (Android uses the ripple instead). Default 0.8. */
  activeOpacity?: number;
  /**
   * Borderless ripple for round/icon-only hit targets (the ripple is unbounded
   * and centered). Ignored on iOS/web. Default false (bounded ripple).
   */
  borderless?: boolean;
  /** Override the ripple color (Android). Defaults to a subtle white overlay. */
  rippleColor?: string;
}

export default function AppPressable({
  style,
  activeOpacity = 0.8,
  borderless = false,
  rippleColor,
  children,
  ...rest
}: AppPressableProps) {
  const t = useTokens();
  const android_ripple =
    Platform.OS === 'android' ? { color: rippleColor ?? t.colors.overlay[4], borderless } : undefined;

  const styleFn = useCallback(
    ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => [
      style,
      // The ripple is the press feedback on Android; the opacity fade is for
      // iOS/web where there is no ripple.
      Platform.OS !== 'android' && pressed ? { opacity: activeOpacity } : null,
    ],
    [style, activeOpacity],
  );

  return (
    <Pressable style={styleFn} android_ripple={android_ripple} {...rest}>
      {children}
    </Pressable>
  );
}
