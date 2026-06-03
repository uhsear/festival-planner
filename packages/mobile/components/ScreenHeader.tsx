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
      {icon ? <Ionicons name={icon} size={24} color={t.colors.accent.aqua} /> : null}
      <View style={styles.titleBlock}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
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
    paddingVertical: t.spacing[4],
  },
  titleBlock: {
    flex: 1,
    gap: t.spacing[1],
  },
  title: {
    ...typeStyle('heading'),
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
