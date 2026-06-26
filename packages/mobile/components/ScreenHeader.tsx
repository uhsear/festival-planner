import { createContext, useContext, type ReactNode } from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';

/**
 * Signals whether a full-width chrome banner (OfflineBanner) is currently
 * mounted IN FLOW above the navigator and is therefore already consuming the
 * top safe-area inset (it paints behind the status bar via `paddingTop:
 * insets.top`). When true, ScreenHeader must NOT add `insets.top` again — doing
 * so double-applies the notch inset and leaves a ~insets.top (≈47px) dead gap
 * between the banner and the title.
 *
 * Defaults to `false`, so a ScreenHeader rendered with no provider (the common
 * case, and every pre-existing call site) behaves exactly as before: it owns
 * the top inset itself. The provider lives in `app/_layout.tsx`, fed by the
 * banner's live visibility.
 */
export const TopBannerContext = createContext(false);

interface ScreenHeaderProps {
  /** Primary heading text. */
  title: string;
  /** Optional secondary line under the title. */
  subtitle?: string;
  /** Optional node rendered on the trailing edge (e.g. a button). */
  right?: ReactNode;
  /** Optional Ionicons name rendered before the title. */
  icon?: keyof typeof Ionicons.glyphMap;
}

/**
 * Standard screen header: optional leading icon, a title with optional
 * subtitle, and an optional trailing slot. Purely presentational.
 *
 * ## Adoption rule
 * Use ScreenHeader on **tab-root screens only** (Schedule, Picks, Crew,
 * Account). Pushed non-sheet screens (map, compass, find, plan-share,
 * crew-compare, festival-mode, wrap, crew-plan, privacy) use the native Stack
 * header (`Stack.Screen options={{ headerShown: true, title: '...' }}`) so the
 * platform back chevron is always visible — the root Stack in `_layout.tsx`
 * already styles those headers dark to match the app.
 *
 * ## Documented exceptions (do NOT migrate these to ScreenHeader)
 * - **Auth hero screens** (`(auth)/login`, `register`, `forgot-password`,
 *   `reset-password`): full-bleed hero layout with branding; the inset is
 *   consumed inline alongside the auth illustration — no back affordance is
 *   needed because auth screens are never pushed onto a stack.
 * - **`set/[setId]` formSheet**: rendered as a native form sheet
 *   (`presentation: 'formSheet'`) with a real grabber + detents; safe-area
 *   geometry is different from a card push and the sheet is dismissed by
 *   swipe-down, not a back chevron.
 */
export default function ScreenHeader({ title, subtitle, right, icon }: ScreenHeaderProps) {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  // When an in-flow chrome banner already cleared the notch above us, drop our
  // own top inset so the title doesn't sit below a second insets.top dead gap.
  const bannerActive = useContext(TopBannerContext);
  return (
    <View style={[styles.row, { paddingTop: (bannerActive ? 0 : insets.top) + t.spacing[4] }]}>
      {icon ? (
        <Ionicons
          name={icon}
          size={24}
          color={t.colors.accent.aqua}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
      <View style={styles.titleBlock}>
        {/* Shrink-to-fit instead of truncating: the brand heading is a wide
            24px Syncopate display face, so medium/long festival & crew names
            (e.g. "North Coast Festival 2026") used to clip to "…". Single-line
            + adjustsFontSizeToFit is the reliable RN path (the title column is
            width-bounded by titleBlock flex:1).
            maxFontSizeMultiplier caps Dynamic Type at 1.4× so the heading
            doesn't overflow the header row at AX sizes; body/notes text in
            the screen body is left uncapped to scale fully (F12). */}
        <Text
          style={styles.title}
          numberOfLines={1}
          adjustsFontSizeToFit
          // Floor the shrink at 70% so very long names stay legible instead of
          // collapsing to an unreadable size (pairs with adjustsFontSizeToFit).
          minimumFontScale={0.7}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityRole="header"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    // Top padding is supplied inline as `insets.top + spacing[4]` (the header
    // owns the screen's top safe-area inset exactly once). Only the bottom is
    // declared here so the symmetric value doesn't read as a double-applied top.
    paddingBottom: t.spacing[4],
  },
  titleBlock: {
    flex: 1,
    gap: t.spacing[1],
  },
  title: {
    ...typeStyle('heading'),
    // Drop the baked lineHeight so that when adjustsFontSizeToFit shrinks the
    // glyphs they re-center vertically (a fixed lineHeight clips descenders of
    // the smaller text on Android).
    lineHeight: undefined,
    color: t.colors.text.primary,
  },
  subtitle: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  right: {
    flexShrink: 0,
  },
}));
