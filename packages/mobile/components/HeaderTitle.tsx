import { Text } from 'react-native';
import { colors, fontSize } from '@festie/shared/tokens';
import { typeStyle } from '../hooks/useTokens';

/**
 * Shrink-to-fit title node for native (expo-router Stack) headers. A plain
 * string `title` renders as a single ellipsized line that iOS centers in a
 * notch-narrowed region, so long dynamic names (a crew or artist) clip to "…".
 * Passing this node as `headerTitle` lets the title auto-shrink to fit instead.
 * Matches the app's dark header type (see Stack screenOptions in app/_layout.tsx).
 *
 * Uses typeStyle('label', 600) to resolve SpaceGrotesk_600SemiBold rather than
 * a raw fontWeight:'600' — on Android a numeric weight on top of an already-loaded
 * weighted family triggers synthetic bold, widening glyphs and clipping the trailing
 * character.
 */
export default function HeaderTitle({ children }: { children: string }) {
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
      style={{
        color: colors.text.primary,
        fontSize: fontSize[18],
        // Resolve the SemiBold family cut instead of using a raw fontWeight.
        fontFamily: typeStyle('label', 600).fontFamily,
      }}
    >
      {children}
    </Text>
  );
}
