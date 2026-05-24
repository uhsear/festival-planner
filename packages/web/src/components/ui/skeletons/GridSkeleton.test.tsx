import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GridSkeleton from './GridSkeleton';

describe('GridSkeleton', () => {
  it('renders with aria-busy for loading state', () => {
    render(<GridSkeleton />);
    expect(screen.getByLabelText('Loading grid')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders 4 column headers', () => {
    const { container } = render(<GridSkeleton />);
    const colHeads = container.querySelectorAll('[data-grid-col-head]');
    expect(colHeads.length).toBe(4);
  });

  it('renders hour labels in the gutter', () => {
    const { container } = render(<GridSkeleton />);
    const hourLabels = container.querySelectorAll('[data-grid-hour-label]');
    expect(hourLabels.length).toBe(7);
  });

  it('renders 4 grid columns in the body', () => {
    const { container } = render(<GridSkeleton />);
    const cols = container.querySelectorAll('[data-grid-col]');
    expect(cols.length).toBe(4);
  });

  it('marks hour labels as aria-hidden', () => {
    const { container } = render(<GridSkeleton />);
    const hourLabels = container.querySelectorAll('[data-grid-hour-label]');
    hourLabels.forEach((label) => {
      expect(label).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('uses skeleton class for placeholder blocks', () => {
    const { container } = render(<GridSkeleton />);
    const skeletons = container.querySelectorAll('.skeleton-shimmer');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
