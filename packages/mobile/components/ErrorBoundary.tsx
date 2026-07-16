import { Component, type ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { typeStyle, useTokens, makeStyles } from '../hooks/useTokens';

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
  // Optional escape hatch for a deterministic render crash: reset() alone just
  // re-renders the same crashing tree (an unbreakable retry loop). The root
  // boundary passes a handler that navigates away before resetting.
  onEscape?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Functional fallback so the on-brand styling can pull from the design tokens
 * via the useTokens hook (class components can't call hooks directly).
 */
function ErrorFallback({ onReset, onEscape }: { onReset: () => void; onEscape?: () => void }) {
  const t = useTokens();
  const styles = useStyles();
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
            backgroundColor: t.colors.accent.aqua,
            borderRadius: t.radii.default,
            paddingVertical: t.spacing[3],
            paddingHorizontal: t.spacing[6],
            marginTop: t.spacing[5],
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Retry"
      >
        <Text style={[styles.buttonLabel, { color: t.colors.text.onLightAccent }]}>Retry</Text>
      </TouchableOpacity>
      {onEscape && (
        <TouchableOpacity
          onPress={onEscape}
          style={[
            styles.button,
            {
              backgroundColor: t.colors.bg.secondary,
              borderRadius: t.radii.default,
              paddingVertical: t.spacing[3],
              paddingHorizontal: t.spacing[6],
              marginTop: t.spacing[3],
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go to Schedule"
        >
          <Text style={[styles.buttonLabel, { color: t.colors.text.primary }]}>Go to Schedule</Text>
        </TouchableOpacity>
      )}
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

  // Navigate away (via the passed handler) THEN clear the error so the recovered
  // route — not the crashing tree — renders after escape.
  private escape = () => {
    this.props.onEscape?.();
    this.reset();
  };

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback onReset={this.reset} onEscape={this.props.onEscape ? this.escape : undefined} />
      );
    }
    return this.props.children;
  }
}

const useStyles = makeStyles((t) => ({
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
    marginTop: t.spacing[2],
    maxWidth: 320, // fallback copy is short; fixed cap keeps it centered without a token
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    ...typeStyle('label'),
  },
}));
