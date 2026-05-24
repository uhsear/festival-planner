import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FestivalModeSkeleton from './FestivalModeSkeleton';

describe('FestivalModeSkeleton', () => {
  it('renders with aria-busy for loading state', () => {
    render(<FestivalModeSkeleton />);
    expect(screen.getByLabelText('Loading festival mode')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a header section', () => {
    const { container } = render(<FestivalModeSkeleton />);
    // Header is the first flex row with justify-between + items-baseline
    const header = container.querySelector('.flex.justify-between');
    expect(header).toBeInTheDocument();
  });

  it('renders NOW and UP NEXT sections', () => {
    render(<FestivalModeSkeleton />);
    expect(screen.getByLabelText('Loading NOW')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading UP NEXT')).toBeInTheDocument();
  });

  it('renders 1 card in NOW section and 2 cards in UP NEXT', () => {
    const { container } = render(<FestivalModeSkeleton />);
    const sections = container.querySelectorAll('section');
    expect(sections.length).toBe(2);

    const nowCards = sections[0]?.querySelectorAll('.fm-card-enter');
    const upNextCards = sections[1]?.querySelectorAll('.fm-card-enter');
    expect(nowCards?.length).toBe(1);
    expect(upNextCards?.length).toBe(2);
  });

  it('renders section titles with emoji indicators', () => {
    render(<FestivalModeSkeleton />);
    expect(screen.getByText('NOW')).toBeInTheDocument();
    expect(screen.getByText('UP NEXT')).toBeInTheDocument();
  });

  it('uses skeleton class for placeholder blocks', () => {
    const { container } = render(<FestivalModeSkeleton />);
    const skeletons = container.querySelectorAll('.skeleton-shimmer');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
