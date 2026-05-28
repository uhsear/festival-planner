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
  default: ({ user }: { user: { username: string } }) => (
    <div data-testid="user-menu">{user.username}</div>
  ),
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
    localStorage.setItem('fp-theme', 'dark');
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
    it('shows Schedule, Timeline, Grid tabs when not logged in', () => {
      mockAuthStore.mockReturnValue(null);
      render(<Header />);
      expect(screen.getByRole('tab', { name: 'Schedule' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Timeline' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Grid' })).toBeInTheDocument();
    });

    it('does not show My Picks or Crew tabs when not logged in', () => {
      mockAuthStore.mockReturnValue(null);
      render(<Header />);
      expect(screen.queryByRole('tab', { name: 'My Picks' })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Crew' })).not.toBeInTheDocument();
    });
  });

  describe('desktop tabs for logged-in users', () => {
    it('shows all 5 tabs when logged in', () => {
      mockAuthStore.mockReturnValue({ id: '1', username: 'test' });
      render(<Header />);
      expect(screen.getByRole('tab', { name: 'Schedule' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Timeline' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Grid' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'My Picks' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Crew' })).toBeInTheDocument();
    });
  });

  describe('active tab detection', () => {
    it('marks Schedule as active on /cards', () => {
      vi.mocked(useLocation).mockReturnValue({ pathname: '/cards' } as ReturnType<typeof useLocation>);
      render(<Header />);
      expect(screen.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
    });

    it('marks Schedule as active on /', () => {
      vi.mocked(useLocation).mockReturnValue({ pathname: '/' } as ReturnType<typeof useLocation>);
      render(<Header />);
      expect(screen.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
    });

    it('marks Timeline as active on /timeline', () => {
      vi.mocked(useLocation).mockReturnValue({ pathname: '/timeline' } as ReturnType<typeof useLocation>);
      render(<Header />);
      expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'false');
    });
  });

  describe('tab navigation', () => {
    it('navigates when a tab is clicked', async () => {
      const user = userEvent.setup();
      render(<Header />);
      await user.click(screen.getByRole('tab', { name: 'Timeline' }));
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/timeline' });
    });
  });

  describe('theme toggle', () => {
    it('renders theme toggle button', () => {
      render(<Header />);
      expect(screen.getByLabelText('Toggle theme (dark, light, daylight)')).toBeInTheDocument();
    });

    it('cycles theme dark -> light -> daylight -> dark on click', async () => {
      const user = userEvent.setup();
      render(<Header />);
      const toggle = screen.getByLabelText('Toggle theme (dark, light, daylight)');
      await user.click(toggle);
      expect(localStorage.getItem('fp-theme')).toBe('light');
      await user.click(toggle);
      expect(localStorage.getItem('fp-theme')).toBe('daylight');
      await user.click(toggle);
      expect(localStorage.getItem('fp-theme')).toBe('dark');
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
