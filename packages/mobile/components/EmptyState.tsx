import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

interface EmptyStateProps {
  /** Ionicons name for the centered glyph. */
  icon: keyof typeof Ionicons.glyphMap;
  /** Headline describing the empty/placeholder condition. */
  title: string;
  /** Optional supporting copy under the title. */
  message?: string;
  /** Optional call-to-action button. */
  action?: { label: string; onPress: () => void };
}

/**
 * Centered empty/placeholder state: a large icon, a title, optional message,
 * and an optional action button. Use when a list or screen has no content.
 */
export default function EmptyState({
  icon,
  title,
  message,
  action,
}: EmptyStateProps) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={48} color={t.colors.text.muted} />
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
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
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[6],
  },
  title: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  message: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  action: {
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[5],
    paddingVertical: t.spacing[3],
    marginTop: t.spacing[2],
  },
  actionText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
}));
