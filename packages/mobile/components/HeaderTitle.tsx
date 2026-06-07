import { Text } from 'react-native';
import { colors, fontSize } from '@festie/shared/tokens';

/**
 * Shrink-to-fit title node for native (expo-router Stack) headers. A plain
 * string `title` renders as a single ellipsized line that iOS centers in a
 * notch-narrowed region, so long dynamic names (a crew or artist) clip to "…".
 * Passing this node as `headerTitle` lets the title auto-shrink to fit instead.
 * Matches the app's dark header type (see Stack screenOptions in app/_layout.tsx).
 */
export default function HeaderTitle({ children }: { children: string }) {
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
      style={{ color: colors.text.primary, fontWeight: '600', fontSize: fontSize[18] }}
    >
      {children}
    </Text>
  );
}
