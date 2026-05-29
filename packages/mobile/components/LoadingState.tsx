import { View, Text, ActivityIndicator } from 'react-native';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

interface LoadingStateProps {
  /** Optional label rendered beneath the spinner. */
  label?: string;
}

/**
 * Centered loading state: an ActivityIndicator with an optional label. Use
 * while a screen or list is fetching its initial data.
 */
export default function LoadingState({ label }: LoadingStateProps) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Loading'}
    >
      <ActivityIndicator size="large" color={t.colors.accent.aqua} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
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
  label: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
}));
