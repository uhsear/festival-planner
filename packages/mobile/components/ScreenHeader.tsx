import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

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
 */
export default function ScreenHeader({ title, subtitle, right, icon }: ScreenHeaderProps) {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.row, { paddingTop: insets.top + t.spacing[4] }]}>
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
            width-bounded by titleBlock flex:1). */}
        <Text
          style={styles.title}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
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
