import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from './Button';
import { makeStyles, typeStyle } from '../hooks/useTokens';

interface EmptyStateProps {
  /** Ionicons name for the centered glyph. */
  icon: keyof typeof Ionicons.glyphMap;
  /** Headline describing the empty/placeholder condition. */
  title: string;
  /** Optional supporting copy under the title. */
  message?: string;
  /** Optional call-to-action button. */
  action?: { label: string; onPress: () => void };
  /**
   * Set when the EmptyState fills a screen that has NO native header / nav bar
   * of its own (so the top safe-area inset — notch / Dynamic Island on iOS — is
   * unaccounted for). Adds top + bottom inset padding so the centered content
   * isn't pushed off-axis under the status bar or home indicator.
   *
   * Default (false) preserves the existing behavior: the component assumes the
   * parent screen already handles insets — e.g. a native Stack header (map.tsx,
   * compass.tsx) or an inset-aware scroll container — and centers within it.
   */
  headerless?: boolean;
}

/**
 * Centered empty/placeholder state: a large icon, a title, optional message,
 * and an optional action button. Use when a list or screen has no content.
 */
export default function EmptyState({ icon, title, message, action, headerless = false }: EmptyStateProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const insetStyle = headerless ? { paddingTop: insets.top, paddingBottom: insets.bottom } : null;
  return (
    <View style={[styles.container, insetStyle]}>
      {/* R21: Icon 48px in aqua tint, simple thematic per context. */}
      <Ionicons
        name={icon}
        size={48}
        style={styles.icon}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      {/* R21: Headline contextual not generic (e.g. "No crew yet" not "Empty"). */}
      <Text style={styles.title}>{title}</Text>
      {/* R21: Subtext explains next step, max-width 280px. */}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {/* R21: CTA button aqua pill per R3 spec (canonical Button primitive). */}
      {action ? <Button label={action.label} onPress={action.onPress} style={styles.action} /> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // R21: Empty state container with proper spacing and alignment.
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[4],
    paddingHorizontal: t.spacing[6],
  },
  // R21: Icon in aqua tint, 48px per spec.
  icon: {
    color: t.colors.accent.aqua,
  },
  // R21: Headline, Space Grotesk 18px weight 600, contextual not generic.
  title: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
    fontWeight: '600',
  },
  // R21: Subtext explains the next step. No fixed maxWidth — container
  // paddingHorizontal already constrains line length; a literal 280px cap
  // was causing the final wrapped line to be clipped on narrow screens.
  message: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  // R21: CTA layout only — fill/ink/radius live in components/Button (F8).
  // alignSelf + minWidth prevent the pill from collapsing narrower than its
  // label (fixes 'Sign' clipping to 'Sign in' defect).
  action: {
    paddingHorizontal: t.spacing[6],
    marginTop: t.spacing[2],
    alignSelf: 'center',
    minWidth: 120,
  },
}));
