import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RouteErrorBoundary, {
  RenderErrorBoundary,
  withContextMessage,
} from './RouteErrorBoundary';

// --- Mocks ---

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

// ---------------------------------------------------------------------------
// Helpers to construct typed errors matching ApiClientError's shape
// ---------------------------------------------------------------------------

function makeApiError(
  message: string,
  status: number,
  opts: { code?: string; isNetworkError?: boolean } = {},
): Error & { status: number; code?: string; isNetworkError?: boolean } {
  const err = new Error(message) as Error & {
    status: number;
    code?: string;
    isNetworkError?: boolean;
  };
  err.status = status;
  if (opts.code) err.code = opts.code;
  if (opts.isNetworkError !== undefined) err.isNetworkError = opts.isNetworkError;
  return err;
}

// ---------------------------------------------------------------------------
// RouteErrorBoundary — functional error component
// ---------------------------------------------------------------------------

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockNavigate.mockClear();
  });

  // ── Generic / unknown errors ─────────────────────────────────────────

  it('renders generic error heading for unknown errors', () => {
    const error = new Error('Crash');
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('has role=alert for accessibility', () => {
    const error = new Error('Crash');
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders Retry and Reload buttons for generic errors', () => {
    const error = new Error('Crash');
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
  });

  it('calls reset when Retry is clicked', async () => {
    const user = userEvent.setup();
    const resetFn = vi.fn();
    const error = new Error('Crash');
    render(<RouteErrorBoundary error={error} reset={resetFn} />);
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(resetFn).toHaveBeenCalledOnce();
  });

  it('calls window.location.reload when Reload page is clicked', async () => {
    const user = userEvent.setup();
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload: reloadMock },
    });
    const error = new Error('Crash');
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /reload page/i }));
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it('logs the error to console on mount', () => {
    const error = new Error('Kaboom');
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(console.error).toHaveBeenCalledWith('[route error]', error);
  });

  // ── Network errors ───────────────────────────────────────────────────

  it('shows offline message for ApiClientError with isNetworkError', () => {
    const error = makeApiError('Network request failed', 0, { isNetworkError: true });
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByText('You appear to be offline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    // No "Go home" button for network errors
    expect(screen.queryByRole('button', { name: /go home/i })).not.toBeInTheDocument();
  });

  it('shows offline message for TypeError with "Failed to fetch"', () => {
    const error = new TypeError('Failed to fetch');
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByText('You appear to be offline')).toBeInTheDocument();
  });

  it('shows offline message for ApiClientError with status 0', () => {
    const error = makeApiError('Network request failed', 0);
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByText('You appear to be offline')).toBeInTheDocument();
  });

  // ── 404 errors ───────────────────────────────────────────────────────

  it('shows "Page not found" for 404 errors', () => {
    const error = makeApiError('Not Found', 404);
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });

  it('shows Go home button and hides Retry for 404', () => {
    const error = makeApiError('Not Found', 404);
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByRole('button', { name: /go home/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('navigates to / when Go home is clicked on 404', async () => {
    const user = userEvent.setup();
    const error = makeApiError('Not Found', 404);
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /go home/i }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' });
  });

  // ── Server (5xx) errors ──────────────────────────────────────────────

  it('shows server error for 500 status', () => {
    const error = makeApiError('Internal Server Error', 500);
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByText('Server error')).toBeInTheDocument();
    expect(screen.getByText(/something went wrong on our end/i)).toBeInTheDocument();
  });

  it('shows error reference code when available', () => {
    const error = makeApiError('Internal Server Error', 502, { code: 'ERR_GW_TIMEOUT' });
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByText(/ERR_GW_TIMEOUT/)).toBeInTheDocument();
  });

  it('shows retry button for server errors', () => {
    const error = makeApiError('Internal Server Error', 503);
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  // ── Context message ──────────────────────────────────────────────────

  it('renders optional contextMessage', () => {
    const error = new Error('Crash');
    render(
      <RouteErrorBoundary
        error={error}
        reset={vi.fn()}
        contextMessage="Could not load your crew."
      />,
    );
    expect(screen.getByText('Could not load your crew.')).toBeInTheDocument();
  });

  it('does not render contextMessage paragraph when not provided', () => {
    const error = new Error('Crash');
    const { container } = render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    const italicParagraphs = container.querySelectorAll('p.italic');
    expect(italicParagraphs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// withContextMessage factory
// ---------------------------------------------------------------------------

describe('withContextMessage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns a component that renders with context message', () => {
    const ContextualBoundary = withContextMessage('Try switching festivals.');
    const error = new Error('Boom');
    render(<ContextualBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByText('Try switching festivals.')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RenderErrorBoundary — class-based boundary
// ---------------------------------------------------------------------------

describe('RenderErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  function ThrowingChild(): React.ReactNode {
    throw new Error('Render crash');
  }

  it('renders children when no error', () => {
    render(
      <RenderErrorBoundary name="test">
        <div>Normal content</div>
      </RenderErrorBoundary>,
    );
    expect(screen.getByText('Normal content')).toBeInTheDocument();
  });

  it('catches render errors and shows error UI', () => {
    render(
      <RenderErrorBoundary name="timeline">
        <ThrowingChild />
      </RenderErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('includes the boundary name in the aria-label', () => {
    render(
      <RenderErrorBoundary name="timeline">
        <ThrowingChild />
      </RenderErrorBoundary>,
    );
    expect(screen.getByLabelText('timeline view error')).toBeInTheDocument();
  });

  it('recovers when Try again is clicked', async () => {
    let shouldThrow = true;
    function MaybeThrow() {
      if (shouldThrow) throw new Error('Boom');
      return <div>Recovered</div>;
    }

    const user = userEvent.setup();
    render(
      <RenderErrorBoundary name="test">
        <MaybeThrow />
      </RenderErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });
});
