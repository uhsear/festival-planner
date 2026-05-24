import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CrewSkeleton from './CrewSkeleton';

describe('CrewSkeleton', () => {
  it('renders with aria-busy for loading state', () => {
    render(<CrewSkeleton />);
    expect(screen.getByLabelText('Loading crew')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a crew selector placeholder', () => {
    const { container } = render(<CrewSkeleton />);
    const selectorSkeleton = container.querySelector('.skeleton-shimmer.h-10.w-full.rounded-lg');
    expect(selectorSkeleton).toBeInTheDocument();
  });

  it('renders a home-base card placeholder', () => {
    const { container } = render(<CrewSkeleton />);
    const homeBase = container.querySelector('.skeleton-shimmer.h-24');
    expect(homeBase).toBeInTheDocument();
  });

  it('renders 5 tab placeholders in the tab row', () => {
    const { container } = render(<CrewSkeleton />);
    // The tab row contains 5 skeleton children with min-w-16 and flex-1
    const tabSkeletons = container.querySelectorAll('.skeleton-shimmer.min-w-16');
    expect(tabSkeletons.length).toBe(5);
  });

  it('renders 3 member row placeholders', () => {
    const { container } = render(<CrewSkeleton />);
    // Member rows have avatar circles (h-10 w-10 rounded-full)
    const memberAvatars = container.querySelectorAll('.skeleton-shimmer.h-10.w-10.rounded-full');
    expect(memberAvatars.length).toBe(3);
  });

  it('uses skeleton class for placeholder blocks', () => {
    const { container } = render(<CrewSkeleton />);
    const skeletons = container.querySelectorAll('.skeleton-shimmer');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
