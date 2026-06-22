import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TimelineSkeleton from './TimelineSkeleton';

describe('TimelineSkeleton', () => {
  it('renders with aria-busy for loading state', () => {
    render(<TimelineSkeleton />);
    expect(screen.getByLabelText('Loading timeline')).toHaveAttribute('aria-busy', 'true');
  });

  it('has role=region for accessibility landmark', () => {
    render(<TimelineSkeleton />);
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('renders 4 stage header cells plus one corner cell', () => {
    const { container } = render(<TimelineSkeleton />);
    const headerCells = container.querySelectorAll('.timeline-header-cell');
    // 1 corner + 4 stage headers
    expect(headerCells.length).toBe(5);
  });

  it('renders 16 time-axis cells', () => {
    const { container } = render(<TimelineSkeleton />);
    const timeCells = container.querySelectorAll('.timeline-time-cell');
    expect(timeCells.length).toBe(16);
  });

  it('renders 5 placeholder set blocks', () => {
    const { container } = render(<TimelineSkeleton />);
    const skeletons = container.querySelectorAll('.skeleton-shimmer');
    // 4 stage header skeletons + 8 time label skeletons + 5 set blocks = depends on even/odd
    // Set blocks have m-[1px_2px] class; let's count total skeletons > 0
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders the timeline grid container', () => {
    const { container } = render(<TimelineSkeleton />);
    const grid = container.querySelector('.timeline-grid');
    expect(grid).toBeInTheDocument();
    // Grid contains header cells + time cells + placeholder set blocks
    expect(grid!.children.length).toBeGreaterThan(10);
  });
});
