import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AccountSkeleton from './AccountSkeleton';

describe('AccountSkeleton', () => {
  it('renders with aria-busy for loading state', () => {
    render(<AccountSkeleton />);
    expect(screen.getByLabelText('Loading account')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders an avatar placeholder circle', () => {
    const { container } = render(<AccountSkeleton />);
    const avatarCircle = container.querySelector('.skeleton.h-16.w-16.rounded-full');
    expect(avatarCircle).toBeInTheDocument();
  });

  it('renders 3 form card sections', () => {
    const { container } = render(<AccountSkeleton />);
    // The outer container has 1 avatar row + 3 form cards = 4 direct children
    // Form cards use flex-col gap-2.5 pattern
    const formCards = container.querySelectorAll('.flex.flex-col.gap-2\\.5');
    expect(formCards.length).toBe(3);
  });

  it('uses skeleton class for placeholder blocks', () => {
    const { container } = render(<AccountSkeleton />);
    const skeletons = container.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
