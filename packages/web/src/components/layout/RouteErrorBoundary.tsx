import { Component, useEffect, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { WifiOff, ServerCrash, FileQuestion, AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

/** Matches the `ApiClientError` shape from `@festie/shared/services/api`. */
interface ApiErrorLike {
  status: number;
  code?: string;
  isNetworkError?: boolean;
}

function isApiError(err: unknown): err is Error & ApiErrorLike {
  return (
    err instanceof Error &&
    typeof (err as unknown as ApiErrorLike).status === 'number'
  );
}

type ErrorKind = 'network' | 'not-found' | 'server' | 'generic';

function classifyError(error: Error): ErrorKind {
  // ApiClientError from shared/services/api
  if (isApiError(error)) {
    if (error.isNetworkError || error.status === 0) return 'network';
    if (error.status === 404) return 'not-found';
    if (error.status >= 500) return 'server';
  }

  // Raw fetch / network failures (no response received)
  if (
    error instanceof TypeError &&
    (error.message.includes('fetch') ||
      error.message.includes('network') ||
      error.message.includes('Failed to fetch') ||
      error.message.includes('NetworkError') ||
      error.message.includes('Load failed'))
  ) {
    return 'network';
  }

  return 'generic';
}

// ---------------------------------------------------------------------------
// Per-kind presentation data
// ---------------------------------------------------------------------------

interface ErrorPresentation {
  icon: ReactNode;
  heading: string;
  description: string;
  showBack: boolean;
}

function getPresentation(kind: ErrorKind, error: Error): ErrorPresentation {
  const errorId = isApiError(error) && error.code ? error.code : undefined;

  switch (kind) {
    case 'network':
      return {
        icon: <WifiOff className="size-8 text-[var(--accent-coral)]" aria-hidden="true" />,
        heading: 'You appear to be offline',
        description:
          'Check your internet connection and try again. Your data is safe—we’ll sync when you’re back online.',
        showBack: false,
      };
    case 'not-found':
      return {
        icon: <FileQuestion className="size-8 text-[var(--accent-coral)]" aria-hidden="true" />,
        heading: 'Page not found',
        description: 'The page you’re looking for doesn’t exist or may have been moved.',
        showBack: true,
      };
    case 'server':
      return {
        icon: <ServerCrash className="size-8 text-[var(--accent-coral)]" aria-hidden="true" />,
        heading: 'Server error',
        description: errorId
          ? `Something went wrong on our end (ref: ${errorId}). Please try again in a moment.`
          : 'Something went wrong on our end. Please try again in a moment.',
        showBack: false,
      };
    case 'generic':
    default:
      return {
        icon: <AlertTriangle className="size-8 text-[var(--accent-coral)]" aria-hidden="true" />,
        heading: 'Something went wrong',
        description: 'An unexpected error occurred. Try reloading the page.',
        showBack: false,
      };
  }
}

// ---------------------------------------------------------------------------
// RouteErrorBoundary — functional component for TanStack Router errorComponent
// ---------------------------------------------------------------------------

export interface RouteErrorBoundaryProps {
  error: Error;
  reset: () => void;
  /** Optional per-route message shown below the default description. */
  contextMessage?: string;
}

/**
 * Contextual error fallback for TanStack Router's `errorComponent` prop.
 *
 * Classifies the error (network / 404 / 5xx / generic) and shows an
 * appropriate icon, heading, description, and action buttons. Routes can
 * pass an optional `contextMessage` for additional guidance.
 */
export default function RouteErrorBoundary({
  error,
  reset,
  contextMessage,
}: RouteErrorBoundaryProps) {
  const navigate = useNavigate();
  const kind = classifyError(error);
  const { icon, heading, description, showBack } = getPresentation(kind, error);

  useEffect(() => {
    console.error('[route error]', error);
  }, [error]);

  return (
    <div className="no-festival" role="alert">
      <div className="mb-3 flex justify-center">{icon}</div>
      <h2 className="mt-0 text-lg">{heading}</h2>
      <p className="my-2 text-sm text-[var(--color-text-secondary)]">
        {description}
      </p>
      {contextMessage && (
        <p className="my-1 mb-3 text-sm text-[var(--color-text-secondary)] italic">
          {contextMessage}
        </p>
      )}
      <div className="mt-4 flex justify-center gap-2">
        {kind !== 'not-found' && (
          <button
            type="button"
            className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
            onClick={() => reset()}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Retry
          </button>
        )}
        {showBack && (
          <button
            type="button"
            className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
            onClick={() => navigate({ to: '/' })}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Go home
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    </div>
  );
}

/**
 * Factory that returns an `errorComponent` with a baked-in context message.
 * Use in individual route definitions:
 *
 * ```ts
 * const crewRoute = new Route({
 *   errorComponent: withContextMessage('Could not load your crew.'),
 *   ...
 * });
 * ```
 */
export function withContextMessage(
  contextMessage: string,
): (props: { error: Error; reset: () => void }) => ReactNode {
  return function ContextualErrorBoundary({ error, reset }) {
    return <RouteErrorBoundary error={error} reset={reset} contextMessage={contextMessage} />;
  };
}

/**
 * Class-based React error boundary for wrapping route component JSX.
 * Unlike the functional RouteErrorBoundary above (which is for TanStack
 * Router's `errorComponent` prop), this catches render-time throws from
 * child components and shows an inline recovery card.
 *
 * Usage: <RenderErrorBoundary name="timeline">...</RenderErrorBoundary>
 */
export class RenderErrorBoundary extends Component<
  { children: ReactNode; name: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.name}] render failed:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="no-festival" role="alert" aria-label={`${this.props.name} view error`}>
          <h2 className="mt-0 text-lg">Something went wrong</h2>
          <p className="my-2 mb-4 text-sm text-[var(--color-text-secondary)]">
            An unexpected error occurred while loading this view. Try reloading
            the page or switching festivals.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
