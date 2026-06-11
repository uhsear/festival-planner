import type { ReactNode } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { makeStyles, typeStyle } from '../hooks/useTokens';

interface SectionLabelProps {
  children: ReactNode;
  /**
   * Color emphasis. `secondary` (default) is the AA-safe section divider color;
   * `muted` de-emphasizes (e.g. a "Past" group header).
   */
  tone?: 'secondary' | 'muted';
  /** Optional style override (e.g. to clear a default margin in a custom row). */
  style?: StyleProp<TextStyle>;
}

/**
 * The single mobile section-label convention: an uppercase, caps-tracked caption
 * used to title a group of rows/cards (e.g. "Polls", "Meeting points",
 * "Profile"). Previously every screen re-rolled its own (caption vs label vs
 * micro, muted vs secondary, uppercase or not); this centralizes the look so the
 * chrome reads consistently across screens.
 */
export default function SectionLabel({ children, tone = 'secondary', style }: SectionLabelProps) {
  const styles = useStyles();
  return <Text style={[styles.label, tone === 'muted' && styles.muted, style]}>{children}</Text>;
}

const useStyles = makeStyles((t) => ({
  label: {
    ...typeStyle('caption'),
    // Caps tracking (0.08em × 12px) gives the uppercase label its spaced look.
    letterSpacing: t.fontSize[12] * t.letterSpacing.caps,
    textTransform: 'uppercase',
    color: t.colors.text.secondary,
    marginTop: t.spacing[3],
    marginBottom: t.spacing[1],
  },
  muted: {
    color: t.colors.text.muted,
  },
}));
