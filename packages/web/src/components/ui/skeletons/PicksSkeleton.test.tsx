import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PicksSkeleton from './PicksSkeleton';

describe('PicksSkeleton', () => {
  it('renders with aria-busy for loading state', () => {
    render(<PicksSkeleton />);
    expect(screen.getByLabelText('Loading picks')).toHaveAttribute('aria-busy', 'true');
  });

  it('has role=region for accessibility landmark', () => {
    render(<PicksSkeleton />);
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('renders three priority sections', () => {
    const { container } = render(<PicksSkeleton />);
    const sections = container.querySelectorAll('.picks-section');
    expect(sections.length).toBe(3);
  });

  it('renders section titles for Must See, Want to See, and Maybe', () => {
    render(<PicksSkeleton />);
    expect(screen.getByText('Must See')).toBeInTheDocument();
    expect(screen.getByText('Want to See')).toBeInTheDocument();
    expect(screen.getByText('Maybe')).toBeInTheDocument();
  });

  it('renders correct number of placeholder pick items (3 + 2 + 2)', () => {
    const { container } = render(<PicksSkeleton />);
    const items = container.querySelectorAll('.pick-item');
    expect(items.length).toBe(7);
  });

  it('uses skeleton class for placeholder blocks', () => {
    const { container } = render(<PicksSkeleton />);
    const skeletons = container.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
