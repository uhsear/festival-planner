import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock TanStack Router
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useLocation: vi.fn(() => ({ pathname: '/cards' })),
  useNavigate: vi.fn(() => mockNavigate),
}));

// Mock auth store
const mockAuthStore = vi.fn();
vi.mock('@festie/shared', () => ({
  useAuthStore: (selector: (s: { user: unknown }) => unknown) => selector({ user: mockAuthStore() }),
}));

// Mock UserMenu to avoid complex child rendering
vi.mock('./UserMenu', () => ({
  default: ({ user }: { user: { username: string } }) => <div data-testid="user-menu">{user.username}</div>,
}));

// Mock FestivalModeToggle
vi.mock('../features/FestivalModeToggle', () => ({
  default: () => <div data-testid="festival-mode-toggle" />,
}));

import Header from './Header';
import { useLocation } from '@tanstack/react-router';

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthStore.mockReturnValue(null);
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders the FESTIE logo', () => {
    render(<Header />);
    expect(screen.getByLabelText('FESTIE home')).toBeInTheDocument();
    expect(screen.getByText('FESTIE')).toBeInTheDocument();
  });

  it('renders connection status indicator', () => {
    render(<Header />);
    expect(screen.getByRole('status', { name: 'Connected' })).toBeInTheDocument();
  });

  it('renders main navigation landmark', () => {
    render(<Header />);
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });

  describe('desktop tabs for guest users', () => {
    it('shows a single consolidated Schedule tab when not logged in', () => {
      mockAuthStore.mockReturnValue(null);
      render(<Header />);
      expect(screen.getByRole('button', { name: 'Schedule' })).toBeInTheDocument();
      // Timeline/Grid folded into the in-page ScheduleViewSwitcher.
      expect(screen.queryByRole('button', { name: 'Timeline' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Grid' })).not.toBeInTheDocument();
    });

    it('does not show My Picks or Crew tabs when not logged in', () => {
      mockAuthStore.mockReturnValue(null);
      render(<Header />);
      expect(screen.queryByRole('button', { name: 'My Picks' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Crew' })).not.toBeInTheDocument();
    });
  });

  describe('desktop tabs for logged-in users', () => {
    it('shows Schedule, My Picks, and Crew tabs when logged in', () => {
      mockAuthStore.mockReturnValue({ id: '1', username: 'test' });
      render(<Header />);
      expect(screen.getByRole('button', { name: 'Schedule' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'My Picks' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Crew' })).toBeInTheDocument();
    });
  });

  describe('active tab detection', () => {
    it('marks Schedule as active on /cards', () => {
      vi.mocked(useLocation).mockReturnValue({ pathname: '/cards' } as ReturnType<typeof useLocation>);
      render(<Header />);
      expect(screen.getByRole('button', { name: 'Schedule' })).toHaveAttribute('aria-current', 'page');
    });

    it('marks Schedule as active on /', () => {
      vi.mocked(useLocation).mockReturnValue({ pathname: '/' } as ReturnType<typeof useLocation>);
      render(<Header />);
      expect(screen.getByRole('button', { name: 'Schedule' })).toHaveAttribute('aria-current', 'page');
    });

    it('keeps Schedule active on the timeline and grid views', () => {
      vi.mocked(useLocation).mockReturnValue({ pathname: '/timeline' } as ReturnType<typeof useLocation>);
      render(<Header />);
      expect(screen.getByRole('button', { name: 'Schedule' })).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('tab navigation', () => {
    it('navigates when a tab is clicked', async () => {
      const user = userEvent.setup();
      mockAuthStore.mockReturnValue({ id: '1', username: 'test' });
      render(<Header />);
      await user.click(screen.getByRole('button', { name: 'Crew' }));
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/crew' });
    });
  });

  describe('dark-theme-only', () => {
    it('does not render a theme toggle control', () => {
      render(<Header />);
      expect(screen.queryByLabelText(/toggle theme/i)).not.toBeInTheDocument();
    });

    it('clears any stale persisted theme preference and data-theme attribute', () => {
      localStorage.setItem('fp-theme', 'daylight');
      document.documentElement.setAttribute('data-theme', 'daylight');
      render(<Header />);
      expect(localStorage.getItem('fp-theme')).toBeNull();
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });
  });

  describe('user menu', () => {
    it('renders UserMenu when user is logged in', () => {
      mockAuthStore.mockReturnValue({ id: '1', username: 'alice' });
      render(<Header />);
      expect(screen.getByTestId('user-menu')).toBeInTheDocument();
      expect(screen.getByText('alice')).toBeInTheDocument();
    });

    it('does not render UserMenu when user is not logged in', () => {
      mockAuthStore.mockReturnValue(null);
      render(<Header />);
      expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument();
    });
  });

  it('renders Install App button', () => {
    render(<Header />);
    expect(screen.getByTestId('install-app-btn')).toBeInTheDocument();
  });

  it('renders Support Me link', () => {
    render(<Header />);
    const link = screen.getByText(/Support Me/);
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', 'https://paypal.me/uhsear');
  });

  it('renders FestivalModeToggle', () => {
    render(<Header />);
    expect(screen.getByTestId('festival-mode-toggle')).toBeInTheDocument();
  });
});
