import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmptyState from './EmptyState';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No picks yet" />);
    expect(screen.getByText('No picks yet')).toBeInTheDocument();
  });

  it('renders title as h3', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Empty');
  });

  it('renders description when provided', () => {
    render(
      <EmptyState title="Empty" description="Start by browsing the schedule" />,
    );
    expect(screen.getByText('Start by browsing the schedule')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(0);
  });

  it('renders icon when provided', () => {
    render(
      <EmptyState
        title="Empty"
        icon={<span data-testid="empty-icon">star</span>}
      />,
    );
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
  });

  it('does not render icon section when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector('.text-text-muted')).not.toBeInTheDocument();
  });

  it('renders CTA button when provided', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        cta={{ label: 'Browse Schedule', onClick }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Browse Schedule' })).toBeInTheDocument();
  });

  it('fires CTA onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        cta={{ label: 'Go', onClick }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not render CTA button when not provided', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<EmptyState title="Empty" className="mt-8" />);
    expect(container.firstElementChild?.className).toContain('mt-8');
  });

  it('centers content', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const el = container.firstElementChild;
    expect(el?.className).toContain('items-center');
    expect(el?.className).toContain('text-center');
  });
});
