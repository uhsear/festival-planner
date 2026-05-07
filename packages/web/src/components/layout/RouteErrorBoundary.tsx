import { Component, useEffect, type ReactNode } from 'react';

/**
 * Generic error fallback for TanStack Router's `errorComponent` prop.
 * Catches render crashes per-route so a single broken page doesn't
 * produce a white screen. Logs the error for Sentry / console debugging.
 */
export default function RouteErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('[route error]', error);
  }, [error]);

  return (
    <div className="no-festival" role="alert">
      <h2 className="mt-0 text-lg">Something went wrong</h2>
      <p className="my-2 mb-4 text-sm text-[var(--color-text-secondary)]">
        An unexpected error occurred. Try reloading the page.
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => reset()}>
          Try again
        </button>
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    </div>
  );
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
