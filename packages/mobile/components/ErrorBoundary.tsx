import { Component, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { typeStyle, useTokens } from '../hooks/useTokens';

/**
 * App-wide render error boundary — the mobile analog of the web
 * RenderErrorBoundary (packages/web/src/components/layout/RouteErrorBoundary.tsx).
 *
 * Sentry.wrap() in app/_layout.tsx reports render throws but leaves a blank
 * native screen behind. This class boundary catches render-time throws from
 * any child screen, reports them to Sentry, and shows an on-brand recovery
 * fallback with a Retry button that resets the boundary so the user can keep
 * using the app instead of staring at a white screen.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Functional fallback so the on-brand styling can pull from the design tokens
 * via the useTokens hook (class components can't call hooks directly).
 */
function ErrorFallback({ onReset }: { onReset: () => void }) {
  const t = useTokens();
  return (
    <View
      style={[styles.container, { backgroundColor: t.colors.bg.primary, padding: t.spacing[12] }]}
      accessibilityRole="alert"
    >
      <Text style={[styles.heading, { color: t.colors.text.primary }]}>Something went wrong</Text>
      <Text style={[styles.description, { color: t.colors.text.secondary }]}>
        An unexpected error occurred. Tap retry to reload this screen.
      </Text>
      <TouchableOpacity
        onPress={onReset}
        style={[
          styles.button,
          {
            backgroundColor: t.colors.accent.coral,
            borderRadius: t.radii.default,
            paddingVertical: t.spacing[3],
            paddingHorizontal: t.spacing[6],
            marginTop: t.spacing[5],
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Retry"
      >
        <Text style={[styles.buttonLabel, { color: t.colors.text.onAccent }]}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Report to Sentry so a recovered crash still surfaces in dashboards.
    Sentry.captureException(error);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <ErrorFallback onReset={this.reset} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heading: {
    ...typeStyle('heading'),
    textAlign: 'center',
  },
  description: {
    ...typeStyle('body'),
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    ...typeStyle('label'),
  },
});
