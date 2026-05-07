import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import WrapSkeleton from './WrapSkeleton';

describe('WrapSkeleton', () => {
  it('renders with aria-busy for loading state', () => {
    render(<WrapSkeleton />);
    expect(screen.getByLabelText('Loading wrap')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders 4 stats tiles', () => {
    const { container } = render(<WrapSkeleton />);
    const statsTiles = container.querySelectorAll('.grid-cols-2 > .skeleton');
    expect(statsTiles.length).toBe(4);
  });

  it('renders 5 leaderboard rows', () => {
    const { container } = render(<WrapSkeleton />);
    // Each leaderboard row has a flex container with items-center gap-3
    const rows = container.querySelectorAll('.flex.items-center.gap-3');
    expect(rows.length).toBe(5);
  });

  it('renders hero header placeholder', () => {
    const { container } = render(<WrapSkeleton />);
    const heroSkeletons = container.querySelectorAll('.flex.flex-col.items-center > .skeleton');
    expect(heroSkeletons.length).toBe(2);
  });

  it('uses skeleton class for placeholder blocks', () => {
    const { container } = render(<WrapSkeleton />);
    const skeletons = container.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
