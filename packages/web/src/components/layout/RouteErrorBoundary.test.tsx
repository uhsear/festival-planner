import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RouteErrorBoundary, { RenderErrorBoundary } from './RouteErrorBoundary';

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders error heading', () => {
    const error = new Error('Crash');
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('has role=alert for accessibility', () => {
    const error = new Error('Crash');
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders try again and reload buttons', () => {
    const error = new Error('Crash');
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  });

  it('calls reset when Try again is clicked', async () => {
    const user = userEvent.setup();
    const resetFn = vi.fn();
    const error = new Error('Crash');
    render(<RouteErrorBoundary error={error} reset={resetFn} />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
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
    await user.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it('logs the error to console on mount', () => {
    const error = new Error('Kaboom');
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(console.error).toHaveBeenCalledWith('[route error]', error);
  });

  it('renders descriptive recovery message', () => {
    const error = new Error('Crash');
    render(<RouteErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByText(/unexpected error/i)).toBeInTheDocument();
  });
});

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
