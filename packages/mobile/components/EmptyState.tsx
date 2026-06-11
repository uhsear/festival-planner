import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
      {/* R21: CTA button aqua pill per R3 spec. */}
      {action ? (
        <TouchableOpacity
          style={styles.action}
          onPress={action.onPress}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={styles.actionText}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
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
  // R21: Subtext explains the next step, max-width 280px.
  message: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  // R21: CTA button — aqua pill per R3 spec (canonical Button).
  // alignSelf + minWidth prevent the pill from collapsing narrower than its
  // label (fixes 'Sign' clipping to 'Sign in' defect).
  action: {
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.pill,
    paddingHorizontal: t.spacing[6],
    paddingVertical: t.spacing[3],
    marginTop: t.spacing[2],
    alignSelf: 'center',
    minWidth: 120,
  },
  // R21: Label on aqua fill uses dark ink (onLightAccent #080810) for AA contrast.
  actionText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
    fontWeight: '600',
  },
}));
