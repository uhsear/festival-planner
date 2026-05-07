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
    const header = container.querySelector('.fm-header');
    expect(header).toBeInTheDocument();
  });

  it('renders NOW and UP NEXT sections', () => {
    render(<FestivalModeSkeleton />);
    expect(screen.getByLabelText('Loading NOW')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading UP NEXT')).toBeInTheDocument();
  });

  it('renders 1 card in NOW section and 2 cards in UP NEXT', () => {
    const { container } = render(<FestivalModeSkeleton />);
    const sections = container.querySelectorAll('.fm-section');
    expect(sections.length).toBe(2);

    const nowCards = sections[0]?.querySelectorAll('.fm-set-card');
    const upNextCards = sections[1]?.querySelectorAll('.fm-set-card');
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
    const skeletons = container.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
