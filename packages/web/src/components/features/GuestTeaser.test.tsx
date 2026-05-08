import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GuestTeaser from './GuestTeaser';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

describe('GuestTeaser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('picks mode', () => {
    it('renders the picks title', () => {
      render(<GuestTeaser mode="picks" />);
      expect(screen.getByText('Save your festival picks')).toBeInTheDocument();
    });

    it('renders the picks description', () => {
      render(<GuestTeaser mode="picks" />);
      expect(screen.getByText(/Must See, Want to See, or Maybe/)).toBeInTheDocument();
    });

    it('renders Sign Up Free CTA', () => {
      render(<GuestTeaser mode="picks" />);
      expect(screen.getByRole('button', { name: 'Sign Up Free' })).toBeInTheDocument();
    });

    it('has correct aria-labelledby linking heading to section', () => {
      render(<GuestTeaser mode="picks" />);
      const section = screen.getByRole('region', { hidden: false }) || document.querySelector('section');
      expect(section).toHaveAttribute('aria-labelledby', 'guest-teaser-picks-heading');
      expect(screen.getByText('Save your festival picks')).toHaveAttribute('id', 'guest-teaser-picks-heading');
    });
  });

  describe('crew mode', () => {
    it('renders the crew title', () => {
      render(<GuestTeaser mode="crew" />);
      expect(screen.getByText('Plan with your crew')).toBeInTheDocument();
    });

    it('renders the crew description', () => {
      render(<GuestTeaser mode="crew" />);
      expect(screen.getByText(/Create a crew, invite friends/)).toBeInTheDocument();
    });
  });

  describe('grid mode', () => {
    it('renders the grid title', () => {
      render(<GuestTeaser mode="grid" />);
      expect(screen.getByText('See the whole schedule at a glance')).toBeInTheDocument();
    });

    it('renders the grid description', () => {
      render(<GuestTeaser mode="grid" />);
      expect(screen.getByText(/Grid view shows every stage/)).toBeInTheDocument();
    });
  });

  it('renders icon with aria-hidden', () => {
    const { container } = render(<GuestTeaser mode="picks" />);
    const icon = container.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<GuestTeaser mode="picks" className="mt-10" />);
    const section = container.querySelector('section');
    expect(section?.className).toContain('mt-10');
  });

  it('navigates to /register when CTA is clicked', async () => {
    const user = userEvent.setup();
    render(<GuestTeaser mode="picks" />);
    await user.click(screen.getByRole('button', { name: 'Sign Up Free' }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/register' });
  });
});
