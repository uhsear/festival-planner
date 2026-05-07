import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CardsSkeleton from './CardsSkeleton';

describe('CardsSkeleton', () => {
  it('renders with aria-busy for loading state', () => {
    render(<CardsSkeleton />);
    expect(screen.getByLabelText('Loading sets')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders 8 placeholder cards', () => {
    const { container } = render(<CardsSkeleton />);
    const cards = container.querySelectorAll('.card-enter');
    expect(cards.length).toBe(8);
  });

  it('has role=region for accessibility landmark', () => {
    render(<CardsSkeleton />);
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('applies staggered animation delays', () => {
    const { container } = render(<CardsSkeleton />);
    const cards = container.querySelectorAll('.card-enter');
    const firstDelay = cards[0]?.getAttribute('style');
    const lastDelay = cards[7]?.getAttribute('style');
    expect(firstDelay).toContain('animation-delay: 0ms');
    expect(lastDelay).toContain('animation-delay: 210ms');
  });

  it('renders skeleton placeholders inside each card', () => {
    const { container } = render(<CardsSkeleton />);
    const skeletons = container.querySelectorAll('.skeleton');
    // Each card has: stage pill + artist name + time + 3 priority buttons = 6
    expect(skeletons.length).toBe(8 * 6);
  });
});
